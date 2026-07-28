import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { historicoAtivoDoParceiro } from "@/lib/portal/queries";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";

export default async function PortalMotoHistorico({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { proprietarioId } = await requirePartner();

  // Posse validada na query; uma moto de outro parceiro devolve null → 404.
  const h = await historicoAtivoDoParceiro(proprietarioId, id);
  if (!h) notFound();

  const eur = (n: number | null) => (n == null ? "—" : formatarPreco(n));
  const porRecuperar =
    h.valor_aquisicao != null ? Math.round((h.valor_aquisicao - h.resultado) * 100) / 100 : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/portal" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
          ← Início
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">
          {h.matricula ?? "—"} · {h.modelo}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Histórico desde a aquisição
          {h.data_aquisicao ? ` (${dataBR(h.data_aquisicao)})` : ""}
          {h.valor_aquisicao != null ? ` · valor ${eur(h.valor_aquisicao)}` : ""}. Regime de caixa.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi rotulo="Receita acumulada" valor={eur(h.receita)} cor="text-slate-950" />
        <Kpi rotulo="Custos" valor={eur(h.custo)} cor="text-red-600" />
        <Kpi
          rotulo="Resultado"
          valor={eur(h.resultado)}
          cor={h.resultado >= 0 ? "text-emerald-700" : "text-red-600"}
        />
        <Kpi rotulo="ROI" valor={h.roi == null ? "—" : `${h.roi}%`} cor="text-slate-950" />
        <Kpi rotulo="Custo / km" valor={eur(h.custo_km)} cor="text-slate-700" />
        <Kpi
          rotulo="km percorridos"
          valor={h.km_percorridos == null ? "—" : h.km_percorridos.toLocaleString("pt-PT")}
          cor="text-slate-700"
        />
      </div>

      {h.valor_aquisicao != null && (
        <p
          className={`rounded-3xl px-5 py-4 text-sm font-semibold ${
            h.recuperado ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {h.recuperado
            ? "✓ Esta moto já cobriu o valor de aquisição."
            : `Ainda por recuperar ${eur(porRecuperar)} do valor de aquisição.`}
        </p>
      )}

      <p className="text-xs text-slate-400">
        {h.n_rendas_pagas} renda(s) paga(s) · {h.n_despesas} despesa(s) registada(s).
      </p>
    </div>
  );
}

function Kpi({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}
