/**
 * Um documento carregado pelo intake (Despesas e Documentos) ou pelo importar
 * fatura, enquanto ainda não é de ninguém: o que sai do bucket público logo na
 * análise, e o que sai do storage quando o gestor o abandona.
 *
 * Os dois ecrãs carregam primeiro para o bucket PÚBLICO (`motas/faturas/…`) e só
 * sabem o que o ficheiro é depois de o lerem — até lá pode ser um cartão de
 * cidadão. Tudo o que o gestor abandona (cancelar, descartar o lote, mudar de ecrã
 * a meio da leitura) tem de sair, menos:
 *  - o documento que está "a gravar": o servidor pode estar a pô-lo numa linha;
 *  - o que já é o documento de uma linha: uma gravação que ficou a meio (a despesa
 *    gravou, o seguro falhou) volta à revisão com ele já referido.
 *
 * Funções puras, sem Supabase nem React — testadas em limpezaCarregamentos.test.mjs.
 * Quem apaga são os ecrãs (apagarDocumentoPublico, apagarDocumentosPrivados), e
 * quem move na análise é intakeActions.ts: as operações de storage vêm de fora,
 * como em documentoDespesa.ts. Que os ecrãs e a análise chamam estas funções em
 * cada saída verifica-o limpezaCarregamentosLigacao.test.mjs.
 */

/** Onde os dois ecrãs carregam, no bucket público. É a única pasta de onde se apaga. */
export const PASTA_CARREGAMENTOS = "faturas/";
/** Pasta do bucket privado das coimas e portagens (a de documentoDespesa.ts). */
const PASTA_INFRACOES = "infracoes/";
/** Pasta do bucket privado dos comprovativos de pagamento (a de moverDocumentoParaPrivado). */
const PASTA_COMPROVATIVOS = "comprovativos/";

/** Caminho de storage aceitável: relativo, sem `..`, `.` nem segmentos vazios. */
function caminhoSeguro(caminho: string): boolean {
  if (!caminho || caminho.startsWith("/") || caminho.includes("\\")) return false;
  return caminho.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/**
 * Para onde vai um documento LOGO NA ANÁLISE — antes da revisão e de um lote
 * inteiro à espera na fila:
 *  - "infracoes": coima e portagem — matrícula, local e a quem foi notificada;
 *  - "comprovativos": comprovativo de pagamento — nomes, IBAN e valores de terceiros;
 *  - null: fica em `motas/faturas/` até à revisão (faturas, apólices, manutenção, e
 *    os documentos de identidade, que o ecrã lê em conjunto e passa para `kyc/`).
 */
export function pastaPrivadaNaAnalise(tipo: string | null | undefined): "infracoes" | "comprovativos" | null {
  if (tipo === "coima" || tipo === "portagem") return "infracoes";
  if (tipo === "comprovativo_pagamento") return "comprovativos";
  return null;
}

/**
 * As operações de storage da análise. Vêm de fora (intakeActions.ts): assim a
 * decisão e o falhar fechado testam-se sem rede.
 */
export interface OperacoesNaAnalise {
  /** Coima/portagem: guardarInfracaoEmPrivado — cópia para `privado/infracoes/`; o erro já diz se o público ficou. */
  guardarInfracao: (path: string) => Promise<{ ok: true; caminho: string } | { ok: false; error: string }>;
  /** Comprovativo: moverDocumentoParaPrivado(path, "comprovativos") — o público sai sempre, mesmo que a cópia falhe. */
  moverComprovativo: (path: string) => Promise<{ ok: boolean; path?: string; publicoFicou?: boolean }>;
}

/** O comprovativo não chegou a `privado/comprovativos/`: o gestor volta a carregá-lo (tem-no à mão). */
export const FALHA_COMPROVATIVO_NA_ANALISE =
  "Não consegui passar o comprovativo de pagamento para privado — carrega-o outra vez.";

/**
 * Logo a seguir a classificar, tira do bucket público o que não pode esperar pela
 * revisão (pastaPrivadaNaAnalise) e devolve o `documento` com que o ecrã segue: o
 * URL público, ou o caminho em privado. Falha fechado — nunca devolve um caminho
 * privado com o carregamento ainda legível por URL:
 *  - coima/portagem: o erro de guardarInfracao, tal como vem;
 *  - comprovativo fora da pasta dos carregamentos: não se mexe (nada de outro sítio
 *    sai do público por engano);
 *  - comprovativo que não ficou em `comprovativos/`, ou cujo público não saiu: erro,
 *    e `ficouNoPublico` diz a quem chama que tem de juntar o aviso. O ecrã tenta
 *    apagar o carregamento outra vez.
 */
export async function tirarDoPublicoNaAnalise(
  tipo: string | null | undefined,
  carregamento: { path: string; url: string },
  op: OperacoesNaAnalise,
): Promise<
  | { ok: true; documento: string }
  | {
      ok: false;
      error: string;
      /** Só no comprovativo: o público não saiu, e o erro ainda não o diz. */
      ficouNoPublico?: boolean;
    }
> {
  const pasta = pastaPrivadaNaAnalise(tipo);
  if (pasta === "infracoes") {
    const g = await op.guardarInfracao(carregamento.path);
    return g.ok ? { ok: true, documento: g.caminho } : { ok: false, error: g.error };
  }
  if (pasta === "comprovativos") {
    const { path } = carregamento;
    if (!path.startsWith(PASTA_CARREGAMENTOS) || !caminhoSeguro(path)) {
      return { ok: false, error: "Caminho de comprovativo inválido." };
    }
    const m = await op.moverComprovativo(path);
    if (
      m.ok &&
      !m.publicoFicou &&
      typeof m.path === "string" &&
      m.path.startsWith(PASTA_COMPROVATIVOS) &&
      caminhoSeguro(m.path)
    ) {
      return { ok: true, documento: m.path };
    }
    return { ok: false, error: FALHA_COMPROVATIVO_NA_ANALISE, ficouNoPublico: !!m.publicoFicou };
  }
  return { ok: true, documento: carregamento.url };
}

/** Um ficheiro carregado e ainda sem linha. */
export interface Carregado {
  /** O carregamento no bucket público (`faturas/…`). */
  path: string | null | undefined;
  /**
   * O que a leitura devolveu para gravar: o URL público, ou o caminho em privado
   * para onde a análise o passou (`infracoes/…`, `comprovativos/…`).
   */
  documento: string | null | undefined;
}

/**
 * O que se apaga de cada bucket: `publicos` (caminhos `faturas/…`, para
 * apagarDocumentoPublico) e `privados` (`infracoes/…`, para
 * apagarDocumentosPrivados, que ainda recusa os que alguma linha use). Um
 * comprovativo de pagamento já em `privado/comprovativos/` não entra: não expõe
 * nada, e nenhum ecrã o apaga (fica como fica o de um "Ler comprovativo" cancelado).
 */
export function caminhosDe(docs: readonly Carregado[]): { publicos: string[]; privados: string[] } {
  const publicos = new Set<string>();
  const privados = new Set<string>();
  for (const { path, documento } of docs) {
    if (typeof path === "string" && path.startsWith(PASTA_CARREGAMENTOS) && caminhoSeguro(path)) publicos.add(path);
    if (typeof documento === "string" && documento.startsWith(PASTA_INFRACOES) && caminhoSeguro(documento)) {
      privados.add(documento);
    }
  }
  return { publicos: [...publicos], privados: [...privados] };
}

/** Como o gestor sai de um documento que não chegou a gravar. */
export type SaidaDoEcra =
  /** "Cancelar" ou "Apagar" na revisão: sai o documento em revisão; a fila espera. */
  | "cancelar"
  /** "Descartar os restantes", ou "Cancelar" no painel de pagamento: a revisão e a fila. */
  | "descartar_lote"
  /** O ecrã desmonta (o gestor foi para outro ecrã): tudo, incluindo o lote a meio da leitura. */
  | "sair";

export interface EstadoDoCarregamento {
  /** A fase do ecrã: "inicio", "a-processar", "rever", "a-gravar" ou "comunicar". */
  fase: string;
  /** O documento em revisão (ou a ser encaminhado para um painel), se há. */
  emRevisao: Carregado | null;
  /** O documento em revisão já é — ou, na dúvida, pode já ser — o documento de uma linha. */
  emRevisaoGravado: boolean;
  /** Os do lote que esperam pela revisão. */
  fila: readonly Carregado[];
  /** Os do lote que já subiram mas ainda não chegaram à fila nem à revisão. */
  emLeitura: readonly Carregado[];
}

/**
 * Fases em que o documento em revisão fica, saia o gestor como sair: "a-gravar" (o
 * servidor pode estar a gravá-lo numa linha nesse instante) e "comunicar" (já está
 * gravado; falta só a mensagem ao motorista).
 */
const FASES_COM_DOCUMENTO_OCUPADO: ReadonlySet<string> = new Set(["a-gravar", "comunicar"]);

/**
 * O que sai do storage numa saída do ecrã:
 *  - "cancelar": o documento em revisão;
 *  - "descartar_lote": o documento em revisão e a fila;
 *  - "sair": o documento em revisão, a fila e o lote a meio da leitura.
 * O documento em revisão ocupado ou já gravado nunca sai — nem quando aparece
 * também na fila ou no lote em leitura.
 */
export function aDescartar(
  estado: EstadoDoCarregamento,
  saida: SaidaDoEcra,
): { publicos: string[]; privados: string[] } {
  const { emRevisao } = estado;
  const protegido = !!emRevisao && (estado.emRevisaoGravado || FASES_COM_DOCUMENTO_OCUPADO.has(estado.fase));
  const docs: Carregado[] = [];
  if (emRevisao && !protegido) docs.push(emRevisao);
  if (saida !== "cancelar") docs.push(...estado.fila);
  if (saida === "sair") docs.push(...estado.emLeitura);
  const { publicos, privados } = caminhosDe(docs);
  if (!protegido || !emRevisao) return { publicos, privados };
  return {
    publicos: publicos.filter((p) => p !== emRevisao.path),
    privados: privados.filter((p) => p !== emRevisao.documento),
  };
}

/**
 * Espera por uma gravação (despesa, seguro, manutenção) e chama `gravado()` logo
 * que o documento passa a ser de uma linha: quando a gravação fica feita e, na
 * dúvida, quando o pedido rebenta (a resposta perdeu-se, mas o servidor pode ter
 * gravado). Só uma recusa explícita do servidor (`success: false`) o deixa sem
 * dono. É esta marca (`emRevisaoGravado`) que impede aDescartar de o apagar — o
 * servidor não recusa apagar um carregamento do público que uma linha já use.
 */
export async function aguardarGravacao<T extends { success: boolean }>(
  pedido: Promise<T>,
  gravado: () => void,
): Promise<T> {
  let r: T;
  try {
    r = await pedido;
  } catch (e) {
    gravado();
    throw e;
  }
  if (r.success) gravado();
  return r;
}
