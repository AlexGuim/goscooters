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

const API = "https://generativelanguage.googleapis.com/v1beta";

// Os aliases fixos (gemini-2.5-flash, gemini-2.0-flash) vão sendo descontinuados.
// Em vez de adivinhar, perguntamos à API que modelos a chave tem e escolhemos um
// (preferimos um "flash" estável). Fica em cache no processo. GEMINI_MODEL força
// um nome específico e salta a descoberta.
let modeloCache: string | null = null;

async function descobrirModelo(key: string): Promise<string | null> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (modeloCache) return modeloCache;
  try {
    const res = await fetch(`${API}/models?key=${key}&pageSize=200`);
    if (!res.ok) {
      console.error("Gemini ListModels", res.status, (await res.text()).slice(0, 400));
      return null;
    }
    const json = await res.json();
    const models: { name: string; supportedGenerationMethods?: string[] }[] = json?.models ?? [];
    const geram = models.filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"));
    const limpo = (m: { name: string }) => m.name.replace(/^models\//, "");
    // Preferência: flash estável → qualquer flash → qualquer modelo com generateContent.
    const escolhido =
      geram.find((m) => /flash/i.test(m.name) && !/(lite|exp|thinking|preview|vision|8b|live|tts|image)/i.test(m.name)) ||
      geram.find((m) => /flash/i.test(m.name)) ||
      geram[0];
    if (!escolhido) {
      console.error("Gemini: nenhum modelo com generateContent disponível para esta chave.");
      return null;
    }
    modeloCache = limpo(escolhido);
    console.log("Gemini modelo escolhido:", modeloCache);
    return modeloCache;
  } catch (err) {
    console.error("descobrirModelo falhou:", err);
    return null;
  }
}

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

// Evita que o filtro de segurança bloqueie fotos de documentos (têm rostos e
// dados pessoais). É um uso legítimo — desligamos os bloqueios.
const SEM_BLOQUEIOS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export async function lerDocumentoGemini(
  imagens: { mime: string; base64: string }[],
): Promise<CamposDocumento | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || imagens.length === 0) return null;

  const modelo = await descobrirModelo(key);
  if (!modelo) return null;

  const parts = [
    { text: PROMPT },
    ...imagens.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })),
  ];

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), 25000);
  try {
    const res = await fetch(
      `${API}/models/${modelo}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: JSON.stringify({
          contents: [{ parts }],
          safetySettings: SEM_BLOQUEIOS,
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini HTTP", res.status, (await res.text()).slice(0, 800));
      if (res.status === 404) modeloCache = null; // modelo em cache inválido — redescobrir
      return null;
    }
    const json = await res.json();
    const cand = json?.candidates?.[0];
    const texto: string | undefined = cand?.content?.parts?.[0]?.text;
    if (!texto) {
      console.error(
        "Gemini sem texto:",
        JSON.stringify({
          finishReason: cand?.finishReason,
          blockReason: json?.promptFeedback?.blockReason,
          safety: cand?.safetyRatings,
        }).slice(0, 800),
      );
      return null;
    }
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
