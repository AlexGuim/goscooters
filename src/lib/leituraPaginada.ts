/**
 * Ler uma tabela inteira, página a página.
 *
 * O caminho mais silencioso para um número errado com ar de certo: o PostgREST
 * devolve no máximo 1000 linhas por pedido e deita o resto fora SEM erro. Com a
 * frota de hoje não se chega lá; numa instância com ~60 motas, um ano de rendas
 * passa das 3000 e a receita do ano aparecia a menos, calada. Aqui pede-se
 * página a página — e cada página verifica o seu erro.
 *
 * Avança pelo que VEIO, não pelo tamanho que se pediu, e só pára numa página
 * vazia. O limite de linhas por pedido é uma definição do projeto Supabase e
 * pode ser baixada sem ninguém tocar no código: a parar na primeira página
 * incompleta, um limite de 500 devolvia as primeiras 500 linhas e calava-se —
 * outra vez números a menos com ar de certo. Custa um pedido vazio no fim.
 *
 * Cada consulta tem de trazer uma ordem FIXA (o `id` chega), senão a base pode
 * devolver a mesma linha em duas páginas e saltar outra.
 *
 * Vive aqui, e não no Resultado, porque o Início lê as mesmas cobranças e tinha
 * o mesmo problema: o bloco da Cobrança parava nas 1000 linhas enquanto o
 * cartão dos Números contava todas, e o mesmo ecrã mostrava dois números com o
 * mesmo nome.
 *
 * Puro, sem Supabase nem Next — testado em leituraPaginada.test.mjs.
 */

/** Um erro da base como o supabase-js o devolve: mensagem e, quando há, o código. */
export interface ErroDaBase {
  message: string;
  code?: string;
}

/** Linhas que se pedem de cada vez. O PostgREST pode devolver menos, se o projeto tiver um limite mais baixo. */
export const PAGINA = 1000;

/**
 * Travão de segurança: 100 páginas são 100 000 linhas. Uma leitura maior do que
 * isto não é um mês grande, é um filtro que se perdeu pelo caminho — mais vale
 * dar erro do que ficar a ler para sempre.
 */
export const PAGINAS_MAX = 100;

/**
 * Uma consulta que falha NÃO pode virar zeros. O supabase-js não lança: devolve
 * `{ data: null, error }`, e com `data ?? []` o ecrã mostrava 0 € como se fosse
 * verdade. Quem chama diz de que ecrã fala (`contexto`) e o que estava a ler
 * (`oQue`), para a mensagem servir para alguma coisa no registo.
 */
export function erroDeLeitura(contexto: string, oQue: string, error: ErroDaBase): Error {
  return new Error(`${contexto}: não foi possível ler ${oQue}: ${error.message}`);
}

export async function lerPaginado<T>(
  contexto: string,
  oQue: string,
  pedir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: ErroDaBase | null }>,
): Promise<T[]> {
  const linhas: T[] = [];
  let de = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const { data, error } = await pedir(de, de + PAGINA - 1);
    if (error) {
      // Pedir um intervalo já fora da tabela é o fim da leitura, não uma avaria:
      // há instalações que respondem 416 (PGRST103) em vez de uma lista vazia.
      if (de > 0 && error.code === "PGRST103") return linhas;
      throw erroDeLeitura(contexto, oQue, error);
    }
    const desta = data ?? [];
    linhas.push(...desta);
    if (desta.length === 0) return linhas;
    de += desta.length;
  }
  throw new Error(`${contexto}: ${oQue} não acabou ao fim de ${PAGINAS_MAX} páginas — a leitura foi interrompida.`);
}
