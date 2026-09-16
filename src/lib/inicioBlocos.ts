/**
 * Os blocos do Início: quais existem, por que ordem aparecem e que largura ocupam.
 *
 * O Início deixou de ser um ecrã só e passou a ser uma pilha de blocos, cada um
 * com as suas consultas e o seu tempo de carregamento. Esta é a lista ÚNICA
 * deles: a página percorre-a para desenhar a grelha, e o painel «Personalizar o
 * Início» percorre-a para oferecer uma linha por bloco.
 *
 * `toda` ocupa a largura inteira; `meia` ocupa metade no computador e a largura
 * toda no telemóvel — dois blocos meios ficam lado a lado.
 *
 * Pura, sem Supabase nem Next — testada em inicioBlocos.test.mjs.
 */

export type IdBloco = "numeros" | "acao";
export type LarguraBloco = "meia" | "toda";

export interface BlocoDoInicio {
  id: IdBloco;
  /** Como o bloco se chama no ecrã e no painel de personalização. */
  rotulo: string;
  largura: LarguraBloco;
  visivel: boolean;
}

/** O catálogo, pela ordem de fábrica. */
export const BLOCOS_INICIO: readonly { id: IdBloco; rotulo: string; largura: LarguraBloco }[] = [
  { id: "numeros", rotulo: "Números", largura: "toda" },
  { id: "acao", rotulo: "Caixa de próxima ação", largura: "toda" },
];

/** Quantos blocos o Início aceita guardar. O catálogo é bem mais curto: isto é folga. */
export const MAX_BLOCOS = 12;

/** O Início de fábrica: todos os blocos visíveis, na ordem e largura do catálogo. */
export function blocosPorOmissao(): BlocoDoInicio[] {
  return BLOCOS_INICIO.map((b) => ({ ...b, visivel: true }));
}
