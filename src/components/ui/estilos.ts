/**
 * Estilos canónicos partilhados — fonte única de verdade para os primitivos de
 * UI. Acaba com o copy-paste de `campo`/`etiqueta` (16×/10× espalhados) e o drift
 * que já era bug (ex.: MotoForm sem text-sm).
 */

/** Input/select/textarea padrão. */
export const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500";

/** Rótulo de campo (label + espaçamento até ao input). */
export const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

/** Superfície de página (cartão). */
export const cartaoSuperficie = "rounded-3xl bg-white p-6 shadow-sm";

/** Painel encaixado (secção interna). */
export const painelEncaixe = "rounded-2xl border border-slate-200 bg-slate-50 p-4";

/** Junta classes, ignorando falsy. */
export function cx(...cls: (string | false | null | undefined)[]): string {
  return cls.filter(Boolean).join(" ");
}
