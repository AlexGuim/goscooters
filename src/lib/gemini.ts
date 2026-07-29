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
  nif: string | null; // NIF/nº de contribuinte (9 dígitos), se visível no documento
  doc_id_tipo: "cc" | "passaporte" | "titulo_residencia" | "aima" | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null; // ISO AAAA-MM-DD
  data_nascimento: string | null; // ISO AAAA-MM-DD
  nacionalidade_iso2: string | null; // ISO-2 (ex.: PT)
  carta_numero: string | null;
  carta_categoria: string | null; // ex.: A1, A, B
  carta_pais: string | null; // ISO-2
  carta_validade: string | null; // ISO
  // Morada — quando visível no documento (título de residência, comprovativo de
  // morada, cartas de condução/IDs estrangeiros). O CC português não a mostra.
  morada_linha1: string | null; // rua e número
  codigo_postal: string | null; // ex.: 1000-001
  localidade: string | null; // cidade/localidade
}

/**
 * Documento genérico classificado pela IA (intake inteligente). A IA decide o
 * `tipo` e extrai os campos relevantes desse tipo; o servidor decide o que usar.
 * Superset deliberado — cada campo é opcional e só faz sentido para alguns tipos.
 */
export type DocTipo =
  | "fatura"
  | "apolice_seguro"
  | "manutencao"
  | "portagem"
  | "coima"
  | "documento_id"
  | "comprovativo_morada"
  | "outro";

export interface DocClassificado {
  tipo: DocTipo;
  confianca: "alta" | "media" | "baixa";
  matricula: string | null;
  data: string | null; // ISO AAAA-MM-DD (documento/serviço/infração)
  data_vencimento: string | null; // ISO
  data_fim: string | null; // ISO — validade da apólice (só seguro)
  valor: string | null; // total, ponto decimal, ex.: "123.45"
  fornecedor: string | null; // seguradora/oficina/entidade
  referencia: string | null; // nº fatura/apólice/auto
  descricao: string | null;
  km: number | null;
  seguro_apolice: string | null; // só seguro
  manutencao_tipo:
    | "revisao" | "oleo" | "pneu_frente" | "pneu_tras" | "pneus"
    | "travoes" | "corrente" | "inspecao" | "outro" | null; // só manutenção
  proxima_km: number | null; // só manutenção
  proxima_data: string | null; // só manutenção
  notas: string | null;
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
  "nif": string|null,                  // NIF / nº de contribuinte (9 dígitos). No Cartão de Cidadão está no VERSO ("Nº de Identificação Fiscal"). Só se estiver visível.
  "doc_id_tipo": "cc"|"passaporte"|"titulo_residencia"|"aima"|null,
  "doc_id_numero": string|null,        // nº do documento de identidade
  "doc_id_validade": string|null,      // validade do documento, formato AAAA-MM-DD
  "data_nascimento": string|null,      // AAAA-MM-DD
  "nacionalidade_iso2": string|null,   // código do país em ISO-2, ex.: PT, BR, IN
  "carta_numero": string|null,         // nº da carta de condução
  "carta_categoria": string|null,      // categorias, ex.: A1, A, B
  "carta_pais": string|null,           // país emissor da carta em ISO-2
  "carta_validade": string|null,       // AAAA-MM-DD
  "morada_linha1": string|null,        // morada (rua e número), SE estiver visível no documento
  "codigo_postal": string|null,        // código postal, ex.: 1000-001
  "localidade": string|null            // localidade/cidade
}
Extrai a MORADA quando aparecer (título de residência, comprovativo de morada, cartas/IDs estrangeiros); o Cartão de Cidadão português NÃO mostra a morada — deixa null nesse caso.
Datas SEMPRE em AAAA-MM-DD. Países SEMPRE em ISO-2. Responde só com o JSON, sem texto à volta.`;

const PROMPT_CLASSIFICAR = `És um assistente de uma empresa de aluguer de scooters. Lês documentos (faturas, apólices de seguro, faturas de oficina/manutenção, portagens/Via Verde, coimas, documentos de identidade) a partir de fotografias ou PDFs.
Primeiro CLASSIFICA o tipo do documento, depois EXTRAI os campos. Devolve um objeto JSON com EXATAMENTE estas chaves (usa null quando não souberes ou não se aplicar ao tipo):
{
  "tipo": "fatura"|"apolice_seguro"|"manutencao"|"portagem"|"coima"|"documento_id"|"comprovativo_morada"|"outro",
  "confianca": "alta"|"media"|"baixa",
  "matricula": string|null,          // matrícula do veículo como está escrita, ex.: "63-XV-18"
  "data": string|null,               // data do documento/serviço/infração, AAAA-MM-DD
  "data_vencimento": string|null,    // data-limite de pagamento, AAAA-MM-DD
  "data_fim": string|null,           // SÓ seguro: fim da validade da cobertura, AAAA-MM-DD
  "valor": string|null,              // total a pagar, número com PONTO decimal e sem €, ex.: "123.45"
  "fornecedor": string|null,         // entidade emissora (seguradora, oficina, Via Verde, ANSR...)
  "referencia": string|null,         // nº do documento/fatura/apólice/auto de contraordenação
  "descricao": string|null,          // resumo curto (serviços, cobertura...)
  "km": number|null,                 // quilómetros do veículo, se aparecer
  "seguro_apolice": string|null,     // SÓ seguro: nº da apólice
  "manutencao_tipo": "revisao"|"oleo"|"pneu_frente"|"pneu_tras"|"pneus"|"travoes"|"corrente"|"inspecao"|"outro"|null,
  "proxima_km": number|null,         // SÓ manutenção: km da próxima intervenção prevista
  "proxima_data": string|null,       // SÓ manutenção: data da próxima prevista, AAAA-MM-DD
  "notas": string|null
}
Guia de classificação:
- "apolice_seguro": apólice/seguro automóvel (tem seguradora e validade da cobertura).
- "manutencao": fatura de oficina (óleo, revisão, pneus, travões, corrente...). Preenche manutencao_tipo.
- "portagem": Via Verde / portagens.
- "coima": coima / multa / contraordenação de trânsito.
- "documento_id": cartão de cidadão, passaporte, título de residência ou carta de condução.
- "comprovativo_morada": fatura de água/luz/gás ou extrato no nome de alguém (prova de morada).
- "fatura": outra fatura de custo do veículo não coberta acima.
- "outro": não encaixa em nada disto.
Datas SEMPRE AAAA-MM-DD. Valor com ponto decimal e sem símbolo. Responde só com o JSON, sem texto à volta.`;

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

/**
 * Núcleo partilhado: faz o POST a generateContent com descoberta/fallback de
 * modelo, timeout e tratamento de 404, e devolve o TEXTO bruto da resposta.
 * Os wrappers abaixo constroem o corpo (JSON ou texto livre) e interpretam-no.
 */
async function chamarGemini(corpo: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

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
          }).slice(0, 800),
        );
        return null;
      }
      console.log("Gemini OK com modelo:", modelo);
      return texto;
    } catch (err) {
      console.error("chamarGemini falhou:", err);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error("Gemini: todos os modelos candidatos deram 404.");
  return null;
}

/** Envia imagens + prompt e devolve o JSON parseado (ou null). */
async function gerarJson(
  imagens: { mime: string; base64: string }[],
  prompt: string,
): Promise<unknown | null> {
  if (!geminiConfigurado() || imagens.length === 0) return null;
  const parts = [
    { text: prompt },
    ...imagens.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })),
  ];
  const corpo = JSON.stringify({
    contents: [{ parts }],
    safetySettings: SEM_BLOQUEIOS,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const texto = await chamarGemini(corpo);
  if (!texto) return null;
  try {
    const limpo = texto.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(limpo);
  } catch (e) {
    console.error("gerarJson parse falhou:", e);
    return null;
  }
}

/**
 * Gera TEXTO livre (sem JSON) — para redigir mensagens ao motorista. temperature
 * mais alta para uma escrita natural. Devolve null se a IA não estiver disponível
 * (o chamador recorre a um template).
 */
export async function gerarTextoGemini(prompt: string): Promise<string | null> {
  if (!geminiConfigurado()) return null;
  const corpo = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    safetySettings: SEM_BLOQUEIOS,
    generationConfig: { temperature: 0.4 },
  });
  const texto = await chamarGemini(corpo);
  return texto ? texto.trim() : null;
}

/** JSON a partir de um prompt de TEXTO (sem imagens) — para o planeador do chat. */
export async function gerarJsonTexto(prompt: string): Promise<unknown | null> {
  if (!geminiConfigurado()) return null;
  const corpo = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    safetySettings: SEM_BLOQUEIOS,
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const texto = await chamarGemini(corpo);
  if (!texto) return null;
  try {
    const limpo = texto.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    return JSON.parse(limpo);
  } catch (e) {
    console.error("gerarJsonTexto parse falhou:", e);
    return null;
  }
}

/** Lê um documento de identidade / carta e devolve os campos KYC. */
export async function lerDocumentoGemini(
  imagens: { mime: string; base64: string }[],
): Promise<CamposDocumento | null> {
  const r = await gerarJson(imagens, PROMPT);
  return r && typeof r === "object" ? (r as CamposDocumento) : null;
}

/**
 * Classifica um documento qualquer (fatura, seguro, manutenção, portagem, coima,
 * KYC…) e extrai os campos relevantes. Base do intake inteligente.
 */
export async function classificarDocumentoGemini(
  imagens: { mime: string; base64: string }[],
): Promise<DocClassificado | null> {
  const r = await gerarJson(imagens, PROMPT_CLASSIFICAR);
  return r && typeof r === "object" ? (r as DocClassificado) : null;
}

export { mimeDoCaminho };
