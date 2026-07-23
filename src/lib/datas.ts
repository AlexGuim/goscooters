/**
 * Formatação de datas em português de Portugal / Brasil: dia antes do mês.
 * Recebe ISO (AAAA-MM-DD) e devolve DD/MM/AAAA ou DD/MM.
 */
export function dataBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [ano, mes, dia] = s.split("-");
  if (!ano || !mes || !dia) return s;
  return `${dia}/${mes}/${ano}`;
}

export function dataCurtaBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [, mes, dia] = s.split("-");
  if (!mes || !dia) return s;
  return `${dia}/${mes}`;
}
