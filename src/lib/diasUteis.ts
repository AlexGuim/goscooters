/**
 * Dias úteis em Portugal: sem sábados, domingos e feriados nacionais
 * obrigatórios (Código do Trabalho, art. 234.º).
 *
 * Os feriados municipais e a tolerância de ponto NÃO entram: o prazo que daqui
 * sai é uma estimativa que o gestor confirma pela notificação. Nunca pode ser
 * mais longo do que o real — por isso não se descontam dias que talvez fossem
 * úteis para a entidade.
 */

/** Domingo de Páscoa (algoritmo gregoriano de Meeus/Jones/Butcher). */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const utc = (dataISO: string) => new Date(`${dataISO.slice(0, 10)}T00:00:00Z`);

const cache = new Map<number, Set<string>>();

export function feriadosNacionais(ano: number): Set<string> {
  const guardado = cache.get(ano);
  if (guardado) return guardado;
  const p = pascoa(ano);
  const fixos = ["01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"];
  const dias = new Set([
    ...fixos.map((md) => `${ano}-${md}`),
    iso(somarDias(p, -2)), // Sexta-feira Santa
    iso(p), // Domingo de Páscoa
    iso(somarDias(p, 60)), // Corpo de Deus
  ]);
  cache.set(ano, dias);
  return dias;
}

export function ehDiaUtil(dataISO: string): boolean {
  const d = utc(dataISO);
  const diaSemana = d.getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  return !feriadosNacionais(d.getUTCFullYear()).has(iso(d));
}

/** Soma `n` dias úteis a uma data. O próprio dia não conta; o resultado é sempre um dia útil. */
export function somarDiasUteis(dataISO: string, n: number): string {
  let d = utc(dataISO);
  let faltam = n;
  while (faltam > 0) {
    d = somarDias(d, 1);
    if (ehDiaUtil(iso(d))) faltam--;
  }
  return iso(d);
}

/**
 * Dias úteis que faltam de `hojeISO` (exclusive) até `prazoISO` (inclusive).
 * 0 = o prazo é hoje; negativo = já passou (conta os dias úteis em atraso).
 */
export function diasUteisAte(hojeISO: string, prazoISO: string): number {
  const hoje = iso(utc(hojeISO));
  const prazo = iso(utc(prazoISO));
  if (prazo === hoje) return 0;
  const sinal = prazo > hoje ? 1 : -1;
  let d = utc(hoje);
  let conta = 0;
  while (iso(d) !== prazo) {
    d = somarDias(d, sinal);
    if (ehDiaUtil(iso(d))) conta += sinal;
  }
  return conta;
}

/** A data de hoje em Portugal continental (YYYY-MM-DD) — não a de UTC, que à meia-noite ainda é ontem. */
export function hojeEmLisboa(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(agora);
}

/** O resultado de diasUteisAte em texto: "faltam 5 dias úteis", "acaba hoje", "passou há 1 dia útil". */
export function textoDiasUteis(dias: number): string {
  if (dias === 0) return "acaba hoje";
  const n = Math.abs(dias);
  const unidade = n === 1 ? "dia útil" : "dias úteis";
  return dias > 0 ? `${n === 1 ? "falta" : "faltam"} ${n} ${unidade}` : `passou há ${n} ${unidade}`;
}
