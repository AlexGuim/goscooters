/**
 * Partir uma lista em lotes de tamanho fixo.
 *
 * Existe por causa dos filtros `.in()` do Supabase: os ids viajam no URL do
 * pedido, e o gateway recusa-o a partir de umas centenas de UUIDs (há relatos de
 * recusa perto dos 250). Quem consulta por uma lista de ids que cresce com o
 * negócio — as cobranças de um ano, por exemplo — envia-a aos bocados.
 *
 * Pura, sem Supabase nem Next — testada em lotes.test.mjs.
 */
export function partirEmLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) {
    throw new RangeError(`Tamanho de lote inválido: ${tamanho}`);
  }
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}
