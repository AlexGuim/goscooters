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
  /** Print do MB WAY / transferência / conversa: dinheiro que o motorista pagou. */
  | "comprovativo_pagamento"
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
  /** Só comprovativo de pagamento: nome de quem enviou o dinheiro. */
  pagador: string | null;
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

// Última razão de falha da IA (ex.: "HTTP 429 — quota"), para diagnóstico. Os
// wrappers devolvem null (para os fallbacks funcionarem); quem quer explicar ao
// utilizador porque falhou lê isto. Best-effort — serve para mensagens de erro.
let ultimoErroGemini: string | null = null;
export function ultimoErroDaIA(): string | null {
  return ultimoErroGemini;
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

const PROMPT = `És um assistente que lê documentos de identificação a partir de fotografias.

AS IMAGENS SÃO DA MESMA PESSOA. Podem ser faces/páginas do mesmo documento OU documentos
diferentes (ex.: título de residência + frente e verso da carta de condução). Lê TODAS e
devolve UM único objeto com o melhor valor de cada campo, venha ele de que imagem vier.
Se o mesmo campo aparecer em duas imagens, fica com o mais legível e específico.

Devolve um objeto JSON com EXATAMENTE estas chaves (null quando não conseguires ler):
{
  "nome": string|null,                 // nome completo, na ordem natural (nomes próprios + apelidos)
  "nif": string|null,                  // NIF português: EXATAMENTE 9 dígitos
  "doc_id_tipo": "cc"|"passaporte"|"titulo_residencia"|"aima"|null,
  "doc_id_numero": string|null,
  "doc_id_validade": string|null,      // AAAA-MM-DD
  "data_nascimento": string|null,      // AAAA-MM-DD
  "nacionalidade_iso2": string|null,   // ISO-2 (2 letras)
  "carta_numero": string|null,
  "carta_categoria": string|null,
  "carta_pais": string|null,           // ISO-2
  "carta_validade": string|null,       // AAAA-MM-DD
  "morada_linha1": string|null,        // rua e número
  "codigo_postal": string|null,
  "localidade": string|null
}

CARTA DE CONDUÇÃO (modelo da União Europeia — os campos são NUMERADOS; usa os números,
não a posição na imagem):
  1 = apelidos · 2 = nomes próprios → junta os dois em "nome", nomes próprios primeiro
  3 = data e local de nascimento → só a data vai para "data_nascimento"
  4a = data de EMISSÃO — NUNCA é a validade
  4b = data de validade do documento. Muitas cartas trazem "-" aqui: nesse caso a validade
       é a MAIOR data da coluna 11 no verso.
  4c = entidade emissora · 4d = nº de identificação do condutor (NÃO é o nº da carta)
  5  = NÚMERO DA CARTA → é este que vai para "carta_numero"
  9  = lista de categorias (AM, A1, A2, A, B1, B, C…), impressa SEMPRE INTEIRA no verso
  10 = data de obtenção de cada categoria · 11 = validade de cada categoria
  REGRA CRÍTICA: em "carta_categoria" põe APENAS as categorias que têm datas preenchidas
  nas colunas 10/11. As que têm tracinhos ("------") NÃO foram obtidas — não as incluas.
  Ex.: se só B1 e B têm datas, a resposta é "B1, B" — nunca "AM, A1, A2, A, B1, B".
  "carta_validade" = a maior data da coluna 11 entre as categorias obtidas.

TÍTULO DE RESIDÊNCIA / AIMA: o número está em grande no topo e repetido à esquerda.
  "VALIDADE DO CARTÃO / CARD EXPIRY" → doc_id_validade. "DATA NASC." → data_nascimento.
  Apelidos e nomes vêm em duas linhas ("SURNAMES Forenames") — junta na ordem natural.

NIF (9 dígitos): está no VERSO do título de residência e do Cartão de Cidadão, sob o
  rótulo "Nº IDENT. FISCAL" ou "Nº de Identificação Fiscal".
  CUIDADO: no verso do título de residência aparecem TRÊS números lado a lado, sob
  "NÚMEROS DE IDENTIFICAÇÃO / PERSONAL NUMBERS":
    "Nº IDENT. FISCAL"      → é ESTE o NIF
    "Nº SEGURANÇA SOCIAL"   → 11 dígitos, NÃO é o NIF
    "Nº UTENTE DE SAÚDE"    → também 9 dígitos, NÃO é o NIF
  Lê o rótulo que está POR CIMA de cada número; não escolhas pelo número de dígitos.
  A carta de condução não tem NIF. Nunca uses o nº do documento nem inventes → null.

MORADA: o VERSO do título de residência TEM morada, sob "MORADA / ADDRESS": rua e número
  na primeira linha e o código postal (0000-000) na linha seguinte. A localidade costuma
  vir no fim da linha da morada ou a seguir ao código postal — separa-a de morada_linha1.
  Extrai também de comprovativos de morada e de IDs estrangeiros.
  O Cartão de Cidadão português NÃO mostra morada → null.

ZONA MRZ (as 3 linhas de "<<<<" no fundo dos títulos de residência e passaportes): é
  legível por máquina e mais fiável do que o texto impresso — usa-a para CONFIRMAR.
  Linha 1: tipo + país + nº do documento (o último dígito antes dos "<" é de controlo,
  não faz parte do número). Linha 2: AAMMDD de nascimento + dígito, sexo, AAMMDD de
  validade + dígito, e o país em ISO-3. Linha 3: APELIDOS<<NOMES.
  Ex.: "7903281M2702283EGY" → nascimento 1979-03-28, validade 2027-02-28, EGY→EG.

FORMATOS:
  Datas SEMPRE AAAA-MM-DD. Datas escritas dd.mm.aa (dois dígitos no ano) são do século XXI:
  27.03.39 → 2039-03-27; 17.02.16 → 2016-02-17.
  Países SEMPRE ISO-2, convertendo de ISO-3 quando o documento usa 3 letras
  (EGY→EG, BRA→BR, IND→IN, PRT→PT, NPL→NP, BGD→BD, PAK→PK).

Responde só com o JSON, sem texto à volta.`;


const PROMPT_CLASSIFICAR = `És um assistente de uma empresa de aluguer de scooters. Lês documentos (faturas, apólices de seguro, faturas de oficina/manutenção, portagens/Via Verde, coimas, documentos de identidade) a partir de fotografias ou PDFs.
Usa "comprovativo_pagamento" quando for um print de MB WAY, de transferência bancária, de uma conversa de WhatsApp ou foto de talão a mostrar dinheiro que UM MOTORISTA PAGOU — e não uma fatura que a empresa tem a pagar. Aí o "valor" é a quantia transferida e o "pagador" é quem a enviou.
Primeiro CLASSIFICA o tipo do documento, depois EXTRAI os campos. Devolve um objeto JSON com EXATAMENTE estas chaves (usa null quando não souberes ou não se aplicar ao tipo):
{
  "tipo": "fatura"|"apolice_seguro"|"manutencao"|"portagem"|"coima"|"documento_id"|"comprovativo_morada"|"comprovativo_pagamento"|"outro",
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
  "pagador": string|null,            // SÓ comprovativo_pagamento: nome de QUEM ENVIOU o dinheiro
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
- "documento_id": cartão de cidadão, passaporte, título de residência, AIMA ou carta de condução —
  A FRENTE OU O VERSO. Os versos não trazem título e enganam: classifica como "documento_id"
  qualquer imagem com (a) as linhas de "<<<<" da zona MRZ; (b) "NÚMEROS DE IDENTIFICAÇÃO",
  "Nº IDENT. FISCAL" ou "Nº SEGURANÇA SOCIAL"; ou (c) a tabela de categorias de carta
  (AM, A1, A2, A, B1, B, C, D, BE… em coluna, com datas ou tracinhos ao lado).
  Na dúvida entre "documento_id" e "outro" num documento SEM valor a pagar, escolhe
  "documento_id": um papel de identificação nunca é uma despesa.
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
    ultimoErroGemini = "sem modelos utilizáveis para esta chave Gemini";
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
        const corpoErro = (await res.text()).slice(0, 800);
        ultimoErroGemini =
          res.status === 429
            ? "quota do Gemini esgotada (HTTP 429)"
            : res.status === 400 || res.status === 403
              ? `chave Gemini rejeitada (HTTP ${res.status})`
              : `Gemini HTTP ${res.status}`;
        console.error("Gemini HTTP", res.status, corpoErro);
        return null;
      }
      const json = await res.json();
      const cand = json?.candidates?.[0];
      const texto: string | undefined = cand?.content?.parts?.[0]?.text;
      if (!texto) {
        ultimoErroGemini = `resposta vazia do Gemini (${cand?.finishReason ?? json?.promptFeedback?.blockReason ?? "sem motivo"})`;
        console.error(
          "Gemini sem texto:",
          JSON.stringify({
            finishReason: cand?.finishReason,
            blockReason: json?.promptFeedback?.blockReason,
          }).slice(0, 800),
        );
        return null;
      }
      ultimoErroGemini = null;
      console.log("Gemini OK com modelo:", modelo);
      return texto;
    } catch (err) {
      ultimoErroGemini = err instanceof Error && err.name === "AbortError" ? "Gemini demorou demais (timeout)" : "falha de rede a contactar o Gemini";
      console.error("chamarGemini falhou:", err);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  ultimoErroGemini = "todos os modelos Gemini indisponíveis (404)";
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

/**
 * Comprovativo de PAGAMENTO enviado pelo motorista: print do MB WAY, do
 * homebanking, de uma conversa de WhatsApp, ou foto de um talão.
 *
 * Prompt separado do PROMPT_CLASSIFICAR de propósito: aqui a pergunta é outra —
 * não interessa que documento é, interessa quanto entrou, quando e de quem. E o
 * caso mais comum (print de conversa) traz o valor no meio de texto conversado,
 * onde um classificador de faturas se perde.
 */
const PROMPT_COMPROVATIVO = `És um assistente de uma empresa de aluguer de scooters em Lisboa. Lês COMPROVATIVOS DE PAGAMENTO enviados por motoristas: capturas de ecrã do MB WAY, de transferências bancárias, de conversas de WhatsApp, ou fotografias de talões.
Extrai o que a imagem mostra. Devolve SÓ um objeto JSON com EXATAMENTE estas chaves (null quando não souberes — nunca inventes):
{
  "valor": string|null,        // quantia paga, número com PONTO decimal e sem simbolo, ex.: "55.00"
  "moeda": string|null,        // "EUR", "BRL"... se visivel
  "data": string|null,         // data do pagamento, AAAA-MM-DD. Se o print so disser "hoje"/"ontem" ou uma hora, devolve null
  "metodo": "transferencia"|"mbway"|"numerario"|"multibanco"|"outro"|null,
  "pagador": string|null,      // nome de QUEM ENVIOU o dinheiro, tal como aparece
  "destinatario": string|null, // nome de quem RECEBEU, se aparecer
  "referencia": string|null,   // referencia, ID da operacao, ou os ultimos digitos do IBAN
  "confianca": "alta"|"media"|"baixa",
  "notas": string|null         // qualquer coisa relevante que nao coube acima
}
REGRAS:
- O valor e o do PAGAMENTO, nunca um saldo de conta nem um total acumulado.
- Num print de conversa, o pagamento e o que a mensagem confirma ter sido enviado.
- Se houver varios valores, escolhe o que foi efetivamente transferido.
- Datas em formato português (DD/MM/AAAA) convertem-se para AAAA-MM-DD.
- Se a imagem nao for um comprovativo de pagamento, devolve tudo a null e confianca "baixa".`;

/** Campos lidos de um comprovativo de pagamento (ver PROMPT_COMPROVATIVO). */
export interface CamposComprovativo {
  valor: string | null;
  moeda: string | null;
  data: string | null;
  metodo: "transferencia" | "mbway" | "numerario" | "multibanco" | "outro" | null;
  pagador: string | null;
  destinatario: string | null;
  referencia: string | null;
  confianca: "alta" | "media" | "baixa" | null;
  notas: string | null;
}

/** Lê um comprovativo de pagamento (print/foto) e devolve os campos. */
export async function lerComprovativoGemini(
  imagens: { mime: string; base64: string }[],
): Promise<CamposComprovativo | null> {
  const r = await gerarJson(imagens, PROMPT_COMPROVATIVO);
  return r && typeof r === "object" ? (r as CamposComprovativo) : null;
}

export { mimeDoCaminho };
