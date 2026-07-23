"use client";

import { useState } from "react";
import type { Acerto, AcertoEstado, AcertoLinha, Proprietario } from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import {
  calcularAcerto,
  fecharAcerto,
  marcarAcertoPago,
  type AcertoPreview,
} from "@/actions/acertoActions";

export interface AcertoComLinhas extends Acerto {
  proprietario_nome: string;
  linhas: AcertoLinha[];
}

const ESTADO_COR: Record<AcertoEstado, string> = {
  rascunho: "bg-slate-100 text-slate-600",
  fechado: "bg-amber-100 text-amber-800",
  pago: "bg-emerald-100 text-emerald-700",
  parcial: "bg-blue-100 text-blue-700",
};

const mesAnterior = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const nomeMes = (competencia: string) => {
  const [ano, mes] = competencia.slice(0, 7).split("-");
  const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(mes)]} ${ano}`;
};

export default function AcertosList({
  inicial,
  proprietarios,
}: {
  inicial: AcertoComLinhas[];
  proprietarios: Pick<Proprietario, "id" | "nome" | "comissao_valor">[];
}) {
  const [acertos, setAcertos] = useState(inicial);
  const [donoId, setDonoId] = useState(proprietarios[0]?.id ?? "");
  const [mes, setMes] = useState(() => mesAnterior());
  const [preview, setPreview] = useState<AcertoPreview | null>(null);
  const [aCalcular, setACalcular] = useState(false);
  const [aFechar, setAFechar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  const handleCalcular = async () => {
    setErro(null);
    setPreview(null);
    setACalcular(true);
    const r = await calcularAcerto(donoId, mes);
    setACalcular(false);
    if (!r.success || !r.preview) {
      setErro(r.error ?? "Erro ao calcular.");
      return;
    }
    setPreview(r.preview);
  };

  const handleFechar = async () => {
    if (!preview) return;
    if (!window.confirm(`Fechar o acerto de ${preview.proprietario_nome} para ${nomeMes(mes)}? Fica congelado.`))
      return;
    setAFechar(true);
    const r = await fecharAcerto(donoId, mes);
    setAFechar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao fechar.");
      return;
    }
    // Recarrega a página para trazer o acerto fechado com as linhas.
    window.location.reload();
  };

  const handlePago = async (a: AcertoComLinhas) => {
    const r = await marcarAcertoPago(a.id);
    if (r.success) {
      setAcertos((atuais) => atuais.map((x) => (x.id === a.id ? { ...x, estado: "pago" } : x)));
    } else alert(r.error);
  };

  return (
    <div className="space-y-8">
      {/* Novo acerto */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Novo acerto</h2>
        <p className="mt-1 text-xs text-slate-500">
          Fórmula: receita cobrada − comissão (por veículo) − despesas do parceiro
          = líquido a transferir. Confirma os valores antes de fechar.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Parceiro</span>
            <select
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              value={donoId}
              onChange={(e) => { setDonoId(e.target.value); setPreview(null); }}
            >
              {proprietarios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}{p.comissao_valor != null ? ` (${p.comissao_valor}%)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Mês</span>
            <input
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              type="month"
              value={mes}
              onChange={(e) => { setMes(e.target.value); setPreview(null); }}
            />
          </label>
          <button
            onClick={handleCalcular}
            disabled={aCalcular || !donoId}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {aCalcular ? "A calcular..." : "Calcular"}
          </button>
        </div>

        {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

        {preview && (
          <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile rotulo="Receita" valor={preview.receita_total} cor="text-slate-950" />
              <Tile rotulo="Comissão" valor={-preview.comissao_total} cor="text-amber-700" />
              <Tile rotulo="Despesas" valor={-preview.despesa_total} cor="text-red-600" />
              <Tile rotulo="Líquido a transferir" valor={preview.liquido} cor="text-emerald-700" forte />
            </div>

            {preview.linhas.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-slate-700">
                  Detalhe ({preview.linhas.length} linhas)
                </summary>
                <ul className="mt-2 space-y-1">
                  {preview.linhas.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-slate-600">
                        {l.matricula ? `${l.matricula} · ` : ""}{l.descricao}
                      </span>
                      <span className={l.valor < 0 ? "text-red-600" : "text-slate-900"}>
                        {formatarPreco(l.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <button
              onClick={handleFechar}
              disabled={aFechar}
              className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {aFechar ? "A fechar..." : "Fechar acerto (congelar)"}
            </button>
          </div>
        )}
      </div>

      {/* Acertos fechados */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">Acertos fechados</h2>
        {acertos.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
            Ainda não há acertos fechados.
          </div>
        ) : (
          acertos.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <button
                className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                onClick={() => setExpandido(expandido === a.id ? null : a.id)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-950">{a.proprietario_nome}</p>
                    <span className="text-sm text-slate-500">{nomeMes(a.competencia_mes)}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_COR[a.estado]}`}>
                      {a.estado}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Receita {formatarPreco(a.receita_total)} · Comissão {formatarPreco(a.comissao_total)} · Despesas {formatarPreco(a.despesa_total)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Líquido</p>
                    <p className="text-lg font-bold text-emerald-700">{formatarPreco(a.liquido)}</p>
                  </div>
                  {a.estado === "fechado" && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); handlePago(a); }}
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      Marcar pago
                    </span>
                  )}
                </div>
              </button>
              {expandido === a.id && a.linhas.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                  <ul className="space-y-1 text-sm">
                    {a.linhas.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span className="text-slate-600">
                          {l.matricula_snapshot ? `${l.matricula_snapshot} · ` : ""}{l.descricao}
                        </span>
                        <span className={Number(l.valor) < 0 ? "text-red-600" : "text-slate-900"}>
                          {formatarPreco(l.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({ rotulo, valor, cor, forte }: { rotulo: string; valor: number; cor: string; forte?: boolean }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ${forte ? "ring-1 ring-emerald-200" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 ${forte ? "text-2xl" : "text-xl"} font-bold ${cor}`}>{formatarPreco(valor)}</p>
    </div>
  );
}
