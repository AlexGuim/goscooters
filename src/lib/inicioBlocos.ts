/**
 * Os blocos do Início: quais existem, por que ordem aparecem e que largura ocupam.
 *
 * O Início deixou de ser um ecrã só e passou a ser uma pilha de blocos, cada um
 * com as suas consultas e o seu tempo de carregamento. Esta é a lista ÚNICA
 * deles: a página percorre-a para desenhar a grelha, e o painel «Personalizar o
 * Início» percorre-a para oferecer uma linha por bloco.
 *
 * `toda` ocupa a largura inteira; `meia` ocupa metade no computador e a largura
 * toda no telemóvel. Por omissão a Cobrança e o Resultado são meias — é assim
 * que ficam lado a lado no computador.
 *
 * Pura, sem Supabase nem Next — testada em inicioBlocos.test.mjs.
 */

export type IdBloco = "numeros" | "cobranca" | "resultado" | "acao";
export type LarguraBloco = "meia" | "toda";

export interface BlocoDoInicio {
  id: IdBloco;
  /** Como o bloco se chama no ecrã e no painel de personalização. */
  rotulo: string;
  largura: LarguraBloco;
  visivel: boolean;
}

/** O catálogo, pela ordem de fábrica: Números → Cobrança → Resultado → Caixa. */
export const BLOCOS_INICIO: readonly { id: IdBloco; rotulo: string; largura: LarguraBloco }[] = [
  { id: "numeros", rotulo: "Números", largura: "toda" },
  { id: "cobranca", rotulo: "Cobrança", largura: "meia" },
  { id: "resultado", rotulo: "Resultado", largura: "meia" },
  { id: "acao", rotulo: "Caixa de próxima ação", largura: "toda" },
];

/** Quantos blocos o Início aceita guardar. O catálogo é bem mais curto: isto é folga. */
export const MAX_BLOCOS = 12;

/** Quanto pode ocupar a escolha guardada. Cabe muito mais do que alguma vez será preciso. */
export const MAX_BYTES = 512;

/** O Início de fábrica: todos os blocos visíveis, na ordem e largura do catálogo. */
export function blocosPorOmissao(): BlocoDoInicio[] {
  return BLOCOS_INICIO.map((b) => ({ ...b, visivel: true }));
}

// ── A escolha do gestor ─────────────────────────────────────────────────────

/**
 * O que se guarda na conta do gestor (`user_metadata.inicio`): a versão do
 * formato e uma lista de fichas, uma por bloco, pela ordem em que aparecem.
 *
 * Cada ficha é «id:largura», com um «-» à frente quando o bloco está escondido:
 *   ["numeros:t", "cobranca:m", "resultado:m", "-acao:t"]
 *
 * Só ids — nenhum rótulo, nenhum número, nenhum dado do negócio. Isto é uma
 * preferência de ecrã: NUNCA serve para autorizar o que quer que seja. Quem
 * decide o que o gestor pode ver continua a ser a sessão, do lado do servidor.
 */
export interface InicioGuardado {
  /** Versão do formato. Uma versão que não se conheça lê-se como "não há escolha". */
  v: number;
  blocos: string[];
}

const VERSAO = 1;

const LETRA: Record<LarguraBloco, string> = { meia: "m", toda: "t" };

function idConhecido(id: string): IdBloco | null {
  return BLOCOS_INICIO.find((b) => b.id === id)?.id ?? null;
}

/** «-cobranca:m» → escondido, meia. Null quando a ficha não se percebe. */
function lerFicha(ficha: unknown): { id: IdBloco; visivel: boolean; largura: LarguraBloco | null } | null {
  if (typeof ficha !== "string") return null;
  const visivel = !ficha.startsWith("-");
  const [id, letra] = (visivel ? ficha : ficha.slice(1)).split(":");
  const conhecido = id ? idConhecido(id) : null;
  if (!conhecido) return null;
  return { id: conhecido, visivel, largura: letra === "m" ? "meia" : letra === "t" ? "toda" : null };
}

/**
 * A escolha do gestor, lida com desconfiança.
 *
 * Sem escolha, ou com uma escolha que não se perceba, devolve o Início de
 * fábrica. Ids que já não existem são ignorados (um bloco pode ser retirado do
 * produto), ids repetidos contam uma vez, e os blocos NOVOS — que ainda não
 * estavam lá quando o gestor gravou — aparecem visíveis no fim, para nunca
 * nascerem escondidos e passarem despercebidos.
 */
export function lerEscolhaDoInicio(guardado: unknown): BlocoDoInicio[] {
  if (!guardado || typeof guardado !== "object" || Array.isArray(guardado)) return blocosPorOmissao();
  const { v, blocos } = guardado as { v?: unknown; blocos?: unknown };
  if (v !== VERSAO || !Array.isArray(blocos) || blocos.length > MAX_BLOCOS) return blocosPorOmissao();

  const lista: BlocoDoInicio[] = [];
  const vistos = new Set<IdBloco>();
  for (const ficha of blocos) {
    const lido = lerFicha(ficha);
    if (!lido || vistos.has(lido.id)) continue;
    vistos.add(lido.id);
    const doCatalogo = BLOCOS_INICIO.find((b) => b.id === lido.id)!;
    lista.push({
      id: lido.id,
      rotulo: doCatalogo.rotulo,
      largura: lido.largura ?? doCatalogo.largura,
      visivel: lido.visivel,
    });
  }

  for (const b of BLOCOS_INICIO) {
    if (!vistos.has(b.id)) lista.push({ ...b, visivel: true });
  }

  return lista.length ? lista : blocosPorOmissao();
}

/** A escolha no formato que vai para a conta do gestor. */
export function compactarEscolha(blocos: readonly BlocoDoInicio[]): InicioGuardado {
  return {
    v: VERSAO,
    blocos: blocos.map((b) => `${b.visivel ? "" : "-"}${b.id}:${LETRA[b.largura]}`),
  };
}

/** Quanto ocupa a escolha guardada, em bytes. */
export function tamanhoEmBytes(guardado: InicioGuardado): number {
  return new TextEncoder().encode(JSON.stringify(guardado)).length;
}

export type EscolhaValidada =
  | { ok: true; guardado: InicioGuardado }
  | { ok: false; erro: string };

/**
 * A escolha que chega do painel, antes de se gravar.
 *
 * Vem do browser, logo não se acredita em nada: aceita-se uma lista de blocos
 * do catálogo, sem repetições, com uma largura conhecida, dentro do limite de
 * blocos e de bytes. Tudo o resto é recusado — não se grava «o melhor que se
 * conseguiu perceber» na conta de ninguém.
 */
export function validarEscolha(escolha: unknown): EscolhaValidada {
  if (!Array.isArray(escolha)) return { ok: false, erro: "Escolha inválida." };
  if (escolha.length === 0) return { ok: false, erro: "Escolha inválida." };
  if (escolha.length > MAX_BLOCOS) return { ok: false, erro: `São de mais: o Início aceita ${MAX_BLOCOS} blocos.` };

  const blocos: BlocoDoInicio[] = [];
  const vistos = new Set<string>();
  for (const item of escolha) {
    if (!item || typeof item !== "object") return { ok: false, erro: "Escolha inválida." };
    const { id, largura, visivel } = item as { id?: unknown; largura?: unknown; visivel?: unknown };
    if (typeof id !== "string") return { ok: false, erro: "Escolha inválida." };
    const conhecido = idConhecido(id);
    if (!conhecido) return { ok: false, erro: "Escolha inválida." };
    if (vistos.has(conhecido)) return { ok: false, erro: "Escolha inválida." };
    if (largura !== "meia" && largura !== "toda") return { ok: false, erro: "Escolha inválida." };
    if (typeof visivel !== "boolean") return { ok: false, erro: "Escolha inválida." };
    vistos.add(conhecido);
    const doCatalogo = BLOCOS_INICIO.find((b) => b.id === conhecido)!;
    blocos.push({ id: conhecido, rotulo: doCatalogo.rotulo, largura, visivel });
  }

  const guardado = compactarEscolha(blocos);
  if (tamanhoEmBytes(guardado) > MAX_BYTES) {
    return { ok: false, erro: `A escolha é grande de mais (máximo ${MAX_BYTES} bytes).` };
  }
  return { ok: true, guardado };
}
