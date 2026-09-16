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

      {/* A tabela em baixo já traz a receita, os custos e o resultado, com o Total no
          rodapé: os cartões que estavam aqui repetiam-nos e somavam os dois custos
          num número que a tabela nunca mostra. Ficam os dois números que só existem
          aqui, em texto. */}
      <p className="text-xs text-slate-500">
        Em {ano}, <strong>{formatarPreco(total.receita_em_caixa)}</strong> da receita entraram mesmo
        na conta da GoScooters (frota própria e renda que a casa cobrou); o resto está ganho, mas só
        chega pelos acertos com os parceiros. O <strong>turnover</strong> — a renda bruta que passou
        pela operação, {formatarPreco(total.turnover)} — é memorando: não é receita da casa.
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
                    {m.custos_frota > 0 ? formatarPreco(m.custos_frota) : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right ${m.margem_frota >= 0 ? "text-slate-700" : "text-red-600"}`}>
                    {formatarPreco(m.margem_frota)}
                  </td>
                  <td className="px-5 py-3 text-right text-red-600">
                    {m.custos_empresa > 0 ? formatarPreco(m.custos_empresa) : "—"}
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
                <td className="px-5 py-3 text-right text-red-600">
                  {total.custos_frota > 0 ? formatarPreco(total.custos_frota) : "—"}
                </td>
                <td className="px-5 py-3 text-right text-slate-700">{formatarPreco(total.margem_frota)}</td>
                <td className="px-5 py-3 text-right text-red-600">
                  {total.custos_empresa > 0 ? formatarPreco(total.custos_empresa) : "—"}
                </td>
                <td className="px-5 py-3 text-right text-slate-900">{formatarPreco(total.resultado)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
