import "server-only";

/**
 * Leitura de documentos com o Gemini 2.5 Flash (visão). Recebe uma ou mais
 * imagens (documento de identidade frente/verso, carta de condução) e devolve
 * os campos já estruturados. Muito mais fiável que o OCR/MRZ do browser.
 *
 * Só funciona se GEMINI_API_KEY estiver definido; caso contrário devolve null e
 * o chamador recorre ao Tesseract. Não treina com os dados (API paga do Google).
 */

export interface CamposDocumento {
  nome: string | null;
  doc_id_tipo: "cc" | "passaporte" | "titulo_residencia" | "aima" | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null; // ISO AAAA-MM-DD
  data_nascimento: string | null; // ISO AAAA-MM-DD
  nacionalidade_iso2: string | null; // ISO-2 (ex.: PT)
  carta_numero: string | null;
  carta_categoria: string | null; // ex.: A1, A, B
  carta_pais: string | null; // ISO-2
  carta_validade: string | null; // ISO
}

export function geminiConfigurado(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

const MODELO = "gemini-2.5-flash";

const PROMPT = `És um assistente que lê documentos de identidade e cartas de condução a partir de fotografias (podem estar em várias línguas; a zona MRZ do cartão de cidadão está no verso).
Extrai APENAS o que conseguires ler com confiança e devolve um objeto JSON com EXATAMENTE estas chaves (usa null quando não souberes):
{
  "nome": string|null,                 // nome completo da pessoa
  "doc_id_tipo": "cc"|"passaporte"|"titulo_residencia"|"aima"|null,
  "doc_id_numero": string|null,        // nº do documento de identidade
  "doc_id_validade": string|null,      // validade do documento, formato AAAA-MM-DD
  "data_nascimento": string|null,      // AAAA-MM-DD
  "nacionalidade_iso2": string|null,   // código do país em ISO-2, ex.: PT, BR, IN
  "carta_numero": string|null,         // nº da carta de condução
  "carta_categoria": string|null,      // categorias, ex.: A1, A, B
  "carta_pais": string|null,           // país emissor da carta em ISO-2
  "carta_validade": string|null        // AAAA-MM-DD
}
Datas SEMPRE em AAAA-MM-DD. Países SEMPRE em ISO-2. Responde só com o JSON, sem texto à volta.`;

function mimeDoCaminho(path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

export async function lerDocumentoGemini(
  imagens: { mime: string; base64: string }[],
): Promise<CamposDocumento | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || imagens.length === 0) return null;

  const parts = [
    { text: PROMPT },
    ...imagens.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })),
  ];

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 25000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini erro:", res.status, (await res.text()).slice(0, 500));
      return null;
    }
    const json = await res.json();
    const texto: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) return null;
    const limpo = texto.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(limpo) as CamposDocumento;
  } catch (err) {
    console.error("lerDocumentoGemini falhou:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export { mimeDoCaminho };
