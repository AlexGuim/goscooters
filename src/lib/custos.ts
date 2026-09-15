/**
 * Custos da empresa: o que a GoScooters paga e não é de nenhuma mota.
 *
 * A regra é uma só: uma despesa da casa SEM mota é custo da empresa (a
 * contabilidade, o advogado, o site…); COM mota é custo da frota. Os custos da
 * empresa não entram nos acertos nem no portal dos parceiros, que só leem o que
 * se imputou ao proprietário.
 *
 * Esta é a lista ÚNICA das rubricas: o Resultado agrupa por ela, e o formulário
 * da despesa e a leitura das faturas vão usá-la quando passarem a escolher a
 * rubrica (hoje ainda nenhuma despesa a tem). São fixas: não se criam pelo ecrã.
 * Até haver coluna na base, a rubrica guarda-se em `detalhe.rubrica`, com o `id`
 * daqui.
 *
 * Pura, sem Supabase nem Next — testada em custos.test.mjs.
 */

export const RUBRICAS_EMPRESA = [
  { id: "contabilidade", rotulo: "Contabilidade" },
  { id: "advogados", rotulo: "Advogados e notários" },
  { id: "marketing", rotulo: "Marketing e publicidade" },
  { id: "software", rotulo: "Software e comunicações" },
  { id: "seguros_empresa", rotulo: "Seguros da empresa" },
  { id: "taxas", rotulo: "Taxas e licenças" },
  { id: "outros", rotulo: "Outros da empresa" },
] as const;

export type RubricaEmpresa = (typeof RUBRICAS_EMPRESA)[number];
export type RubricaEmpresaId = RubricaEmpresa["id"];

/**
 * A rubrica com este id, ou null quando o valor não é uma das rubricas (vazio,
 * outro tipo, o rótulo em vez do id, uma rubrica que não existe). Quem recebe
 * null usa a categoria da despesa.
 */
export function rubricaEmpresa(valor: unknown): RubricaEmpresa | null {
  if (typeof valor !== "string") return null;
  return RUBRICAS_EMPRESA.find((r) => r.id === valor) ?? null;
}

/**
 * A rubrica guardada no detalhe de uma despesa (`detalhe.rubrica`), se existir e
 * for válida. Um detalhe vazio, que não seja um objeto ou sem rubrica dá null.
 */
export function rubricaDoDetalhe(detalhe: unknown): RubricaEmpresa | null {
  if (!detalhe || typeof detalhe !== "object" || Array.isArray(detalhe)) return null;
  return rubricaEmpresa((detalhe as { rubrica?: unknown }).rubrica);
}
