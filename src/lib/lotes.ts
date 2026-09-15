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

/**
 * As linhas da página `indice` (a primeira é a 0), para o `.range(de, ate)` do
 * Supabase — `ate` é inclusivo, como lá.
 *
 * Existe porque o PostgREST devolve no máximo 1000 linhas por pedido e corta o
 * resto SEM erro: um ano de rendas de uma frota grande passava a aparecer a
 * menos, com ar de certo. Quem lê uma tabela que cresce com o negócio lê-a
 * página a página até vir uma página incompleta.
 */
export function intervaloDaPagina(indice: number, tamanho: number): { de: number; ate: number } {
  if (!Number.isInteger(tamanho) || tamanho < 1) {
    throw new RangeError(`Tamanho de página inválido: ${tamanho}`);
  }
  if (!Number.isInteger(indice) || indice < 0) {
    throw new RangeError(`Número de página inválido: ${indice}`);
  }
  const de = indice * tamanho;
  return { de, ate: de + tamanho - 1 };
}
