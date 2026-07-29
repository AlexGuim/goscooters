import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import {
  historicoAtivoDoParceiro,
  despesasDaMotoDoParceiro,
  motoristaAtualDasMotos,
  type DespesaPortal,
} from "@/lib/portal/queries";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { Badge } from "@/components/ui";
import { CAT_ROTULO, CAT_COR, ESTADO_PAG_TOM } from "@/lib/despesasMeta";
import type { DespesaCategoria } from "@/types/db";

export default async function PortalMotoHistorico({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { proprietarioId } = await requirePartner();

  // Posse validada na query; uma moto de outro parceiro devolve null → 404.
  const [h, despesas, motoristas] = await Promise.all([
    historicoAtivoDoParceiro(proprietarioId, id),
    despesasDaMotoDoParceiro(proprietarioId, id),
    motoristaAtualDasMotos(proprietarioId, [id]),
  ]);
  if (!h) notFound();

  const eur = (n: number | null) => (n == null ? "—" : formatarPreco(n));
  const porRecuperar =
    h.valor_aquisicao != null ? Math.round((h.valor_aquisicao - h.resultado) * 100) / 100 : null;
  const mot = motoristas.get(id);
  const linhas = despesas ?? [];

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

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Motorista atual</p>
        {mot ? (
          <p className="mt-1 text-slate-950">
            <span className="font-semibold">{mot.primeiroNome}</span>
            {mot.desde ? <span className="text-slate-500"> · desde {dataBR(mot.desde)}</span> : null}
          </p>
        ) : (
          <p className="mt-1 text-slate-500">Sem motorista de momento.</p>
        )}
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

      <p className="text-xs text-slate-400">
        Os «Custos» são os que suporta enquanto proprietário. A comissão da GoScooters é aplicada no
        fecho mensal — veja os{" "}
        <Link href="/portal/acertos" className="font-medium text-emerald-600 hover:text-emerald-700">
          Acertos
        </Link>
        .
      </p>

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

      <Despesas linhas={linhas} />

      <p className="text-xs text-slate-400">
        {h.n_rendas_pagas} renda(s) paga(s) · {linhas.length} despesa(s) sua(s) nesta moto.
      </p>
    </div>
  );
}

function Despesas({ linhas }: { linhas: DespesaPortal[] }) {
  const total = linhas.reduce((s, d) => s + Number(d.valor_total), 0);

  // Breakdown por categoria (só as que têm valor), ordenado do maior para o menor.
  const porCat = new Map<DespesaCategoria, number>();
  for (const d of linhas) porCat.set(d.categoria, (porCat.get(d.categoria) ?? 0) + Number(d.valor_total));
  const breakdown = [...porCat.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Despesas</h2>
        {linhas.length > 0 && (
          <span className="text-sm text-slate-600">
            {linhas.length} · total {formatarPreco(total)}
          </span>
        )}
      </div>

      {linhas.length === 0 ? (
        <div className="rounded-3xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          Sem despesas suas registadas nesta moto.
        </div>
      ) : (
        <>
          {breakdown.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {breakdown.map(([cat, v]) => (
                <span
                  key={cat}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CAT_COR[cat]}`}
                >
                  {CAT_ROTULO[cat]} · {formatarPreco(v)}
                </span>
              ))}
            </div>
          )}

          <div className="divide-y divide-slate-100 rounded-3xl border border-slate-200 bg-white shadow-sm">
            {linhas.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CAT_COR[d.categoria]}`}>
                      {CAT_ROTULO[d.categoria]}
                    </span>
                    {d.estado_pagamento !== "paga" && (
                      <Badge tom={ESTADO_PAG_TOM[d.estado_pagamento]}>{d.estado_pagamento}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {dataBR(d.data_despesa)}
                    {d.descricao ? ` · ${d.descricao}` : ""}
                    {d.fornecedor ? ` · ${d.fornecedor}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-slate-950">
                    {formatarPreco(d.valor_total)}
                  </span>
                  {d.documento_url && (
                    <a
                      href={d.documento_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
                    >
                      Documento
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
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
