import type { Moto } from "@/types/db";

/**
 * O que o site público lê da tabela `moto` e, depois de
 * sql/fase14_colunas_publicas_moto.sql, tudo o que a chave anónima PODE ler.
 *
 * A anon key vai no bundle do browser: com ela, qualquer pessoa pede ao
 * /rest/v1/moto as colunas que o papel `anon` tiver permissão de ler, e não só
 * as que o site mostra. A RLS escolhe as LINHAS (motas ativas); as COLUNAS
 * ficam limitadas pelo GRANT a estas listas. Dono, matrícula, km, valor de
 * aquisição e comissão ficam de fora.
 *
 * Cada leitura pública pede só o que usa. Acrescentar aqui uma coluna (ou um
 * filtro/ordenação a uma leitura pública) obriga a acrescentá-la ao GRANT da
 * fase14. Senão, em produção, o PostgREST responde "permission denied for
 * table moto" e o catálogo fica vazio. O motoPublica.test.mjs apanha a
 * divergência.
 *
 * As listas são literais escritos por extenso: é a partir do literal que o
 * supabase-js infere o tipo da linha, e daí saem também os tipos abaixo.
 */

/** "a, b, c" -> "a" | "b" | "c" */
type ColunasDe<S extends string> = S extends `${infer Coluna}, ${infer Resto}`
  ? Coluna | ColunasDe<Resto>
  : S;

/** Cartões do catálogo e filtros (cilindrada, período, preço máximo). */
export const COLUNAS_CATALOGO =
  "id, modelo, cilindrada, preco_dia, preco_semana, preco_mes, estado, disponivel_em, foto_urls, video_url";
export type MotoCatalogo = Pick<Moto, ColunasDe<typeof COLUNAS_CATALOGO>>;

/** Página da mota: o mesmo do cartão mais a descrição (também vai para a metadata). */
export const COLUNAS_DETALHE =
  "id, modelo, cilindrada, preco_dia, preco_semana, preco_mes, estado, disponivel_em, foto_urls, video_url, descricao";
export type MotoDetalhe = Pick<Moto, ColunasDe<typeof COLUNAS_DETALHE>>;

/**
 * Formulário de pedido. O PedidoForm é um Client Component: o que lhe chega
 * segue no HTML da página, por isso vai o mínimo.
 */
export const COLUNAS_PEDIDO = "id, modelo, preco_dia, preco_semana, preco_mes";
export type MotoPedido = Pick<Moto, ColunasDe<typeof COLUNAS_PEDIDO>>;

/** Sitemap: o link de cada mota e a data de lastModified. */
export const COLUNAS_SITEMAP = "id, created_at";

/**
 * Colunas usadas em filtros e ordenação das leituras públicas (eq, neq, order).
 * Não vêm na resposta, mas o Postgres exige SELECT nelas na mesma. `ativo` só
 * aparece aqui e tem de estar no GRANT.
 */
export const COLUNAS_EM_FILTROS = [
  "id",
  "ativo",
  "estado",
  "created_at",
] as const satisfies readonly (keyof Moto)[];
