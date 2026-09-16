/**
 * Erro de coluna ou tabela que a BD ainda não tem (PostgREST ou Postgres). Serve
 * para tolerar a falta de uma migração, e só isso: qualquer outro erro é real.
 */
export function faltaColunaOuTabela(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (["PGRST204", "PGRST205", "42703", "42P01"].includes(error.code ?? "")) return true;
  return /column .* does not exist|could not find the .* column|relation .* does not exist|could not find the table/i.test(
    error.message ?? "",
  );
}
