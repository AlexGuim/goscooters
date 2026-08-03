"use client";

import { useMemo, useState } from "react";
import type { DespesaParceiro } from "@/lib/portal/queries";
import type { DespesaCategoria } from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { Badge } from "@/components/ui";
import { CAT_ROTULO, CAT_COR, ESTADO_PAG_TOM } from "@/lib/despesasMeta";

const MESES = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const rotuloMes = (ym: string) => {
  const [ano, mes] = ym.split("-");
  return `${MESES[Number(mes)]} de ${ano}`;
};

type Modo = "mes" | "ano" | "tudo";

export default function DespesasParceiroLista({ despesas }: { despesas: DespesaParceiro[] }) {
  // Períodos disponíveis (a partir das datas das despesas), do mais recente ao antigo.
  const { meses, anos } = useMemo(() => {
    const ms = new Set<string>();
    const as = new Set<string>();
    for (const d of despesas) {
      ms.add(d.data_despesa.slice(0, 7));
      as.add(d.data_despesa.slice(0, 4));
    }
    return {
      meses: [...ms].sort().reverse(),
      anos: [...as].sort().reverse(),
    };
  }, [despesas]);

  const [modo, setModo] = useState<Modo>(meses.length > 0 ? "mes" : "tudo");
  const [mes, setMes] = useState(meses[0] ?? "");
  const [ano, setAno] = useState(anos[0] ?? "");

  const filtradas = useMemo(() => {
    if (modo === "tudo") return despesas;
    if (modo === "ano") return despesas.filter((d) => d.data_despesa.slice(0, 4) === ano);
    return despesas.filter((d) => d.data_despesa.slice(0, 7) === mes);
  }, [despesas, modo, mes, ano]);

  const total = filtradas.reduce((s, d) => s + Number(d.valor_total), 0);
  const porPagar = filtradas
    .filter((d) => d.estado_pagamento === "pendente" || d.estado_pagamento === "parcial")
    .reduce((s, d) => s + Number(d.valor_total), 0);

  // Breakdown por categoria (do maior para o menor).
  const breakdown = useMemo(() => {
    const m = new Map<DespesaCategoria, number>();
    for (const d of filtradas) m.set(d.categoria, (m.get(d.categoria) ?? 0) + Number(d.valor_total));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtradas]);

  const selBase = "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500";

  return (
    <div className="space-y-4">
      {/* Seletor de período */}
      <div className="flex flex-wrap items-center gap-2">
        {(["mes", "ano", "tudo"] as Modo[]).map((m) => (
          <button
            key={m}
            onClick={() => setModo(m)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              modo === m ? "bg-slate-950 text-slate-50" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {m === "mes" ? "Mês a mês" : m === "ano" ? "Anual" : "Tudo"}
          </button>
        ))}
        {modo === "mes" && meses.length > 0 && (
          <select className={selBase} value={mes} onChange={(e) => setMes(e.target.value)}>
            {meses.map((ym) => (
              <option key={ym} value={ym}>{rotuloMes(ym)}</option>
            ))}
          </select>
        )}
        {modo === "ano" && anos.length > 0 && (
          <select className={selBase} value={ano} onChange={(e) => setAno(e.target.value)}>
            {anos.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      {/* Totais do período */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile rotulo="Total no período" valor={formatarPreco(total)} cor="text-slate-950" />
        <Tile
          rotulo="Por pagar"
          valor={formatarPreco(porPagar)}
          cor={porPagar > 0 ? "text-amber-700" : "text-slate-700"}
        />
        <Tile rotulo="Nº de despesas" valor={String(filtradas.length)} cor="text-slate-700" />
      </div>

      {/* Breakdown por categoria */}
      {breakdown.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {breakdown.map(([cat, v]) => (
            <span key={cat} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CAT_COR[cat]}`}>
              {CAT_ROTULO[cat]} · {formatarPreco(v)}
            </span>
          ))}
        </div>
      )}

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Sem despesas neste período.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-3xl border border-slate-200 bg-white shadow-sm">
          {filtradas.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CAT_COR[d.categoria]}`}>
                    {CAT_ROTULO[d.categoria]}
                  </span>
                  {d.matricula && (
                    <span className="font-mono text-sm font-medium text-slate-950">{d.matricula}</span>
                  )}
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
                <span className="font-semibold tabular-nums text-slate-950">{formatarPreco(d.valor_total)}</span>
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
      )}
    </div>
  );
}

function Tile({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
    </div>
  );
}
