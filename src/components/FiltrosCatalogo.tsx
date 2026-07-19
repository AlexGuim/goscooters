import { PERIODOS } from "@/lib/precos";
import { preencher, type Dicionario, type Locale } from "@/lib/i18n";

export interface FiltrosAtivos {
  periodo?: string;
  cilindrada?: string;
  precoMax?: string;
}

export const CILINDRADAS = ["ate125", "126a250", "mais250"] as const;

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

/**
 * Filtros do catálogo.
 *
 * Um simples formulário GET: o estado vive no URL, portanto o resultado é
 * partilhável, indexável e funciona mesmo sem JavaScript. A filtragem
 * acontece no servidor.
 */
export default function FiltrosCatalogo({
  locale,
  dic,
  ativos,
  total,
}: {
  locale: Locale;
  dic: Dicionario;
  ativos: FiltrosAtivos;
  total: number;
}) {
  const temFiltros = Boolean(ativos.periodo || ativos.cilindrada || ativos.precoMax);

  const rotuloCilindrada: Record<(typeof CILINDRADAS)[number], string> = {
    ate125: dic.filtros.ate125,
    "126a250": dic.filtros.de126a250,
    mais250: dic.filtros.mais250,
  };

  return (
    <form
      method="GET"
      action={`/${locale}`}
      className="rounded-3xl bg-white p-5 shadow-sm sm:p-6"
      id="filtros"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">
            {dic.filtros.periodo}
          </span>
          <select className={campo} name="periodo" defaultValue={ativos.periodo ?? ""}>
            <option value="">{dic.filtros.periodoQualquer}</option>
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {dic.periodos[p].nome}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">
            {dic.filtros.cilindrada}
          </span>
          <select
            className={campo}
            name="cilindrada"
            defaultValue={ativos.cilindrada ?? ""}
          >
            <option value="">{dic.filtros.cilindradaTodas}</option>
            {CILINDRADAS.map((c) => (
              <option key={c} value={c}>
                {rotuloCilindrada[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">
            {dic.filtros.precoMax}
          </span>
          <input
            className={campo}
            name="precoMax"
            type="number"
            min="0"
            step="1"
            defaultValue={ativos.precoMax ?? ""}
            placeholder={dic.filtros.semLimite}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          type="submit"
        >
          {dic.filtros.filtrar}
        </button>

        {temFiltros && (
          <a
            className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            href={`/${locale}`}
          >
            {dic.filtros.limpar}
          </a>
        )}

        <span className="text-sm text-slate-500">
          {total === 1
            ? dic.filtros.umaEncontrada
            : preencher(dic.filtros.varias, { n: total })}
        </span>
      </div>

      {ativos.precoMax && !ativos.periodo && (
        <p className="mt-3 text-xs text-slate-500">
          {dic.filtros.notaPrecoSemPeriodo}
        </p>
      )}
    </form>
  );
}
