import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { financeiroAno } from "@/lib/financeiro";
import { formatarPreco } from "@/lib/precos";
import { mesDeHojeEmLisboa } from "@/lib/datas";
import { Badge } from "@/components/ui";

const MESES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  // O mês de hoje em Lisboa (o servidor corre em UTC): é o que leva «em curso».
  const [anoAtual, mesAtual] = mesDeHojeEmLisboa().split("-").map(Number);
  const ano = Number(sp.ano) || anoAtual;

  const { meses, total } = await financeiroAno(ano);
  const temMovimento = meses.filter((m) => m.turnover > 0 || m.despesas_gs > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">Resultado</h1>
          <p className="mt-1 text-slate-600">
            A receita real da GoScooters (comissão + frota própria) − custos da frota − custos da
            empresa. Fecho de gestão: receita das semanas do mês e custos pela data da fatura.{" "}
            <strong>Clica num mês</strong> para ver de onde veio cada euro.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/financeiro?ano=${ano - 1}`}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← {ano - 1}
          </Link>
          <span className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">{ano}</span>
          <Link
            href={`/admin/financeiro?ano=${ano + 1}`}
            className={`rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold ${
              ano >= anoAtual ? "pointer-events-none text-slate-300" : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            {ano + 1} →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-5">
        <Kpi rotulo="Receita GoScooters" valor={total.receita_gs} cor="text-emerald-700" forte />
        <Kpi rotulo="Entrou em caixa" valor={total.receita_em_caixa} cor="text-slate-900" />
        <Kpi rotulo="Custos da frota e da empresa" valor={-total.despesas_gs} cor="text-red-600" />
        <Kpi rotulo="Resultado" valor={total.resultado} cor={total.resultado >= 0 ? "text-emerald-700" : "text-red-600"} forte />
        <Kpi rotulo="Turnover (renda cobrada)" valor={total.turnover} cor="text-slate-500" />
      </div>
      <p className="text-xs text-slate-500">
        <strong>Turnover</strong> é a renda bruta que passou pela operação (memorando) — não é
        receita da casa. A <strong>Receita GoScooters</strong> é só a comissão + a renda da frota própria.
      </p>

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Mês</th>
              <th className="px-5 py-3 text-right font-semibold">Receita</th>
              <th className="px-5 py-3 text-right font-semibold">Custos da frota</th>
              <th className="px-5 py-3 text-right font-semibold">Margem da frota</th>
              <th className="px-5 py-3 text-right font-semibold">Custos da empresa</th>
              <th className="px-5 py-3 text-right font-semibold">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {temMovimento.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  Sem movimento em {ano}.
                </td>
              </tr>
            ) : (
              temMovimento.map((m) => (
                <tr key={m.mes} className="tabular-nums transition hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">
                    {/* Clicar abre o mês por dentro: que motos, que parceiros, que despesas. */}
                    <Link
                      href={`/admin/financeiro/${ano}-${String(m.mes).padStart(2, "0")}`}
                      className="underline decoration-dotted underline-offset-4 hover:text-emerald-700"
                    >
                      {MESES[m.mes]}
                    </Link>
                    {ano === anoAtual && m.mes === mesAtual && (
                      <Badge tom="warning" className="ml-2">
                        em curso
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right text-emerald-700">{formatarPreco(m.receita_gs)}</td>
                  <td className="px-5 py-3 text-right text-red-600">
                    {m.custos_frota > 0 ? `−${formatarPreco(m.custos_frota)}` : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right ${m.margem_frota >= 0 ? "text-slate-700" : "text-red-600"}`}>
                    {formatarPreco(m.margem_frota)}
                  </td>
                  <td className="px-5 py-3 text-right text-red-600">
                    {m.custos_empresa > 0 ? `−${formatarPreco(m.custos_empresa)}` : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right font-semibold ${m.resultado >= 0 ? "text-slate-900" : "text-red-600"}`}>
                    {formatarPreco(m.resultado)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {temMovimento.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold tabular-nums">
              <tr>
                <td className="px-5 py-3 text-slate-900">Total {ano}</td>
                <td className="px-5 py-3 text-right text-emerald-700">{formatarPreco(total.receita_gs)}</td>
                <td className="px-5 py-3 text-right text-red-600">−{formatarPreco(total.custos_frota)}</td>
                <td className="px-5 py-3 text-right text-slate-700">{formatarPreco(total.margem_frota)}</td>
                <td className="px-5 py-3 text-right text-red-600">−{formatarPreco(total.custos_empresa)}</td>
                <td className="px-5 py-3 text-right text-slate-900">{formatarPreco(total.resultado)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, cor, forte }: { rotulo: string; valor: number; cor: string; forte?: boolean }) {
  return (
    <div className={`rounded-3xl bg-white p-5 shadow-sm ${forte ? "ring-1 ring-emerald-100" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 ${forte ? "text-2xl" : "text-xl"} font-bold ${cor}`}>{formatarPreco(valor)}</p>
    </div>
  );
}
