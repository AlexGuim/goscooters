import { PERIODOS, ROTULOS } from "@/lib/precos";

export interface FiltrosAtivos {
  periodo?: string;
  cilindrada?: string;
  precoMax?: string;
}

export const CILINDRADAS = [
  { valor: "ate125", rotulo: "Até 125 cc" },
  { valor: "126a250", rotulo: "126 – 250 cc" },
  { valor: "mais250", rotulo: "Mais de 250 cc" },
];

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

/**
 * Filtros do catálogo.
 *
 * Um simples formulário GET: o estado vive no URL, portanto o resultado é
 * partilhável, indexável e funciona mesmo sem JavaScript. A filtragem
 * acontece no servidor, em src/app/(site)/page.tsx.
 */
export default function FiltrosCatalogo({
  ativos,
  total,
}: {
  ativos: FiltrosAtivos;
  total: number;
}) {
  const temFiltros = Boolean(
    ativos.periodo || ativos.cilindrada || ativos.precoMax,
  );

  return (
    <form
      method="GET"
      action="/"
      className="rounded-3xl bg-white p-5 shadow-sm sm:p-6"
      id="filtros"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Período</span>
          <select className={campo} name="periodo" defaultValue={ativos.periodo ?? ""}>
            <option value="">Qualquer</option>
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {ROTULOS[p].nome}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Cilindrada</span>
          <select
            className={campo}
            name="cilindrada"
            defaultValue={ativos.cilindrada ?? ""}
          >
            <option value="">Todas</option>
            {CILINDRADAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Preço máximo (€)</span>
          <input
            className={campo}
            name="precoMax"
            type="number"
            min="0"
            step="1"
            defaultValue={ativos.precoMax ?? ""}
            placeholder="Sem limite"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          type="submit"
        >
          Filtrar
        </button>

        {temFiltros && (
          <a
            className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            href="/"
          >
            Limpar
          </a>
        )}

        <span className="text-sm text-slate-500">
          {total === 1 ? "1 mota encontrada" : `${total} motas encontradas`}
        </span>
      </div>

      {ativos.precoMax && !ativos.periodo && (
        <p className="mt-3 text-xs text-slate-500">
          Sem período escolhido, o preço máximo aplica-se a qualquer um dos períodos
          oferecidos.
        </p>
      )}
    </form>
  );
}
