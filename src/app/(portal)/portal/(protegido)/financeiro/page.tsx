import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { financeiroDoParceiro } from "@/lib/portal/queries";
import { formatarPreco } from "@/lib/precos";

export default async function PortalFinanceiro() {
  const { proprietarioId } = await requirePartner();
  const f = await financeiroDoParceiro(proprietarioId);

  const eur = (n: number) => formatarPreco(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Financeiro</h1>
        <p className="mt-1 text-sm text-slate-500">
          Receita cobrada e despesas suas, acumuladas por moto. Regime de caixa.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile rotulo="Receita paga" valor={eur(f.receita)} cor="text-slate-950" />
        <Tile rotulo="Despesas suas" valor={eur(f.custo)} cor="text-red-600" />
        <Tile
          rotulo="Por pagar"
          valor={eur(f.despesas_por_pagar)}
          cor={f.despesas_por_pagar > 0 ? "text-amber-700" : "text-slate-700"}
          nota={f.n_despesas_por_pagar > 0 ? `${f.n_despesas_por_pagar} despesa(s)` : undefined}
        />
        <Tile
          rotulo="Resultado"
          valor={eur(f.resultado)}
          cor={f.resultado >= 0 ? "text-emerald-700" : "text-red-600"}
        />
      </div>

      <p className="text-xs text-slate-400">
        O «Resultado» é receita menos despesas suas e <strong>não inclui a comissão</strong> da
        GoScooters. O líquido efetivo a receber/pagar de cada mês está nos{" "}
        <Link href="/portal/acertos" className="font-medium text-emerald-600 hover:text-emerald-700">
          Acertos
        </Link>
        .
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Por moto</h2>
        {f.motos.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
            Ainda não há motas associadas a ti.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-3xl border border-slate-200 bg-white shadow-sm">
            {f.motos.map((m) => (
              <Link
                key={m.moto_id}
                href={`/portal/motos/${m.moto_id}`}
                className="group flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition first:rounded-t-3xl last:rounded-b-3xl hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold tabular-nums text-slate-950">
                    {m.matricula ?? "—"}
                  </p>
                  <p className="truncate text-xs text-slate-500">{m.modelo}</p>
                </div>
                <div className="flex items-center gap-4 text-sm tabular-nums">
                  <span className="text-slate-500">
                    Receita <span className="font-semibold text-slate-950">{eur(m.receita)}</span>
                  </span>
                  <span className="text-slate-500">
                    Custos <span className="font-semibold text-red-600">{eur(m.custo)}</span>
                  </span>
                  <span
                    className={`font-semibold ${m.resultado >= 0 ? "text-emerald-700" : "text-red-600"}`}
                  >
                    {eur(m.resultado)}
                  </span>
                  <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Link
        href="/portal/acertos"
        className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      >
        <div>
          <p className="font-semibold text-slate-950">Acertos mensais</p>
          <p className="text-sm text-slate-500">
            O fecho de cada mês com a comissão aplicada e o líquido a receber.
          </p>
        </div>
        <span className="shrink-0 text-slate-300">→</span>
      </Link>
    </div>
  );
}

function Tile({
  rotulo,
  valor,
  cor,
  nota,
}: {
  rotulo: string;
  valor: string;
  cor: string;
  nota?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-slate-400">{nota}</p>}
    </div>
  );
}
