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

// Os aliases fixos (gemini-2.x-flash) vão sendo descontinuados e, pior, a API às
// vezes LISTA um modelo que depois recusa a chamada (404 "not available to new
// users"). Por isso: listamos os modelos da chave, ordenamos por preferência, e
// tentamos um a um até um responder — marcando os que dão 404 como "mortos".
let candidatosCache: string[] | null = null;
const modelosMortos = new Set<string>();

async function listarCandidatos(key: string): Promise<string[]> {
  if (process.env.GEMINI_MODEL) return [process.env.GEMINI_MODEL];
  if (candidatosCache) return candidatosCache;
  try {
    const res = await fetch(`${API}/models?key=${key}&pageSize=200`);
    if (!res.ok) {
      console.error("Gemini ListModels", res.status, (await res.text()).slice(0, 400));
      return [];
    }
    const json = await res.json();
    const models: { name: string; supportedGenerationMethods?: string[] }[] = json?.models ?? [];
    const nomes = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
    // Ordena por preferência (menor = tentar primeiro): flash-latest → flash
    // versionado (…-002) → flash estável → outro flash → resto. Evita 'pro' e
    // variantes especiais/caras a não ser em último recurso.
    const especial = (n: string) => /(lite|exp|thinking|preview|vision|8b|live|tts|image|audio|pro)/i.test(n);
    const score = (n: string) => {
      if (/flash-latest/i.test(n)) return 0;
      if (/flash.*\d{3}$/i.test(n)) return 1;
      if (/flash/i.test(n) && !especial(n)) return 2;
      if (/flash/i.test(n)) return 3;
      return especial(n) ? 5 : 4;
    };
    candidatosCache = nomes.sort((a, b) => score(a) - score(b));
    console.log("Gemini candidatos:", candidatosCache.slice(0, 10).join(", ") || "(nenhum)");
    return candidatosCache;
  } catch (err) {
    console.error("listarCandidatos falhou:", err);
    return [];
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

  const parts = [
    { text: PROMPT },
    ...imagens.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })),
  ];
  const corpo = JSON.stringify({
    contents: [{ parts }],
    safetySettings: SEM_BLOQUEIOS,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  const candidatos = (await listarCandidatos(key)).filter((m) => !modelosMortos.has(m)).slice(0, 10);
  if (!candidatos.length) {
    console.error("Gemini: sem modelos utilizáveis para esta chave.");
    return null;
  }

  for (const modelo of candidatos) {
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 25000);
    try {
      const res = await fetch(`${API}/models/${modelo}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: corpo,
      });
      if (res.status === 404) {
        console.warn("Gemini modelo indisponível, a tentar o próximo:", modelo);
        modelosMortos.add(modelo);
        continue;
      }
      if (!res.ok) {
        // Erro não-404 (quota, chave, etc.): não adianta tentar outro modelo.
        console.error("Gemini HTTP", res.status, (await res.text()).slice(0, 800));
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
      console.log("Gemini OK com modelo:", modelo);
      const limpo = texto.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      return JSON.parse(limpo) as CamposDocumento;
    } catch (err) {
      console.error("lerDocumentoGemini falhou:", err);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error("Gemini: todos os modelos candidatos deram 404.");
  return null;
}

export { mimeDoCaminho };
