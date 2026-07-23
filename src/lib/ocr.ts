/**
 * OCR no browser (grátis, sem servidor nem IA paga).
 *
 * Faturas digitalizadas são imagens, por isso o texto tem de ser reconhecido:
 *  - PDF  → rasteriza a(s) página(s) com o pdf.js e faz OCR de cada imagem.
 *  - Foto → OCR directo do ficheiro.
 *
 * Tudo corre no browser do admin (offload da Vercel). As bibliotecas são
 * carregadas dinamicamente para não pesarem no bundle inicial.
 */

import type { PDFPageProxy } from "pdfjs-dist";

export type ProgressoOCR = (fase: string, pct: number) => void;

const MAX_PAGINAS = 3; // faturas costumam ter 1 página; limita o tempo.

/** Rasteriza uma página de PDF para um canvas (escala alta = melhor OCR). */
async function paginaParaCanvas(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1.5, 2000 / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Converte um PDF (ArrayBuffer) numa lista de imagens (canvas), uma por página. */
async function pdfParaImagens(buf: ArrayBuffer, progresso?: ProgressoOCR): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  // O worker é servido de um CDN, na versão exacta instalada (evita problemas
  // de bundling do worker). Sem CSP a bloquear, carrega normalmente.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const total = Math.min(pdf.numPages, MAX_PAGINAS);
  const imagens: HTMLCanvasElement[] = [];
  for (let i = 1; i <= total; i++) {
    progresso?.("A preparar a página", Math.round(((i - 1) / total) * 20));
    const page = await pdf.getPage(i);
    imagens.push(await paginaParaCanvas(page));
  }
  return imagens;
}

/** Lê o texto de uma fatura (PDF digitalizado ou foto) por OCR no browser. */
export async function ocrFicheiro(ficheiro: File, progresso?: ProgressoOCR): Promise<string> {
  const { createWorker } = await import("tesseract.js");

  // Imagens a processar: as páginas do PDF, ou a própria foto.
  let imagens: (HTMLCanvasElement | File)[];
  if (ficheiro.type === "application/pdf") {
    imagens = await pdfParaImagens(await ficheiro.arrayBuffer(), progresso);
  } else {
    imagens = [ficheiro];
  }
  if (imagens.length === 0) return "";

  const worker = await createWorker("por+eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") {
        progresso?.("A ler o texto", 20 + Math.round(m.progress * 75));
      } else if (m.status.startsWith("loading") || m.status.startsWith("initial")) {
        // 1.ª utilização: descarrega o motor e o dicionário (~10 MB).
        progresso?.("A carregar o motor de OCR", Math.max(5, Math.round(m.progress * 18)));
      }
    },
  });

  try {
    const partes: string[] = [];
    for (const img of imagens) {
      const { data } = await worker.recognize(img);
      partes.push(data.text);
    }
    progresso?.("Concluído", 100);
    return partes.join("\n");
  } finally {
    await worker.terminate();
  }
}
