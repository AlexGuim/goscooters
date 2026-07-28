"use client";

import { useState } from "react";
import type {
  Procedimento,
  ProcedimentoGatilho,
  ProcedimentoAcao,
  ProcedimentoModo,
} from "@/types/db";
import {
  criarProcedimento,
  atualizarProcedimento,
  apagarProcedimento,
} from "@/actions/procedimentoActions";

const campo =
  "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

const GATILHO: Record<ProcedimentoGatilho, string> = {
  coima_registada: "Coima registada",
  portagem_registada: "Portagem registada",
  seguro_registado: "Carta verde / seguro registado",
  seguro_a_expirar: "Seguro a expirar",
  manutencao_a_vencer: "Manutenção a vencer",
  doc_motorista_a_expirar: "Documento do motorista a expirar",
};
const ACAO: Record<ProcedimentoAcao, string> = {
  comunicar_motorista: "Comunicar ao motorista",
  alertar_gestor: "Alertar o gestor",
};
const MODO: Record<ProcedimentoModo, string> = {
  manual: "Manual (confirmo antes)",
  auto: "Automático (envia sozinho)",
};

export default function ProcedimentosList({ inicial }: { inicial: Procedimento[] }) {
  const [procs, setProcs] = useState<Procedimento[]>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [aCriar, setACriar] = useState(false);

  const patch = (id: string, campos: Partial<Procedimento>) =>
    setProcs((ps) => ps.map((p) => (p.id === id ? { ...p, ...campos } : p)));

  const editar = async (id: string, campos: Partial<Procedimento>) => {
    patch(id, campos); // otimista
    const r = await atualizarProcedimento(id, campos);
    if (!r.success) setErro(r.error ?? "Erro ao gravar.");
  };

  const apagar = async (p: Procedimento) => {
    if (!window.confirm(`Apagar o procedimento "${p.nome}"?`)) return;
    const r = await apagarProcedimento(p.id);
    if (r.success) setProcs((ps) => ps.filter((x) => x.id !== p.id));
    else setErro(r.error ?? "Erro ao apagar.");
  };

  const criar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErro(null);
    const r = await criarProcedimento({
      nome: String(f.get("nome") ?? "").trim(),
      gatilho: String(f.get("gatilho") ?? "coima_registada") as ProcedimentoGatilho,
      acao: String(f.get("acao") ?? "comunicar_motorista") as ProcedimentoAcao,
      modo: String(f.get("modo") ?? "manual") as ProcedimentoModo,
      canal: "preparar",
    });
    if (!r.success || !r.procedimento) return setErro(r.error ?? "Erro ao criar.");
    setProcs((ps) => [...ps, r.procedimento!]);
    form.reset();
    setACriar(false);
  };

  return (
    <div className="space-y-4">
      {erro && <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{erro}</p>}

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        {procs.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            Sem procedimentos. Corre o <code>sql/fase7_procedimentos.sql</code> para os defaults, ou cria um.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {procs.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-950">{p.nome}</p>
                  <p className="text-xs text-slate-500">
                    Quando: <strong>{GATILHO[p.gatilho]}</strong> → {ACAO[p.acao]}
                    {p.condicoes?.valor_min != null ? ` · só se ≥ ${p.condicoes.valor_min} €` : ""}
                  </p>
                </div>
                <input
                  className={`${campo} w-24`}
                  inputMode="decimal"
                  placeholder="valor mín."
                  defaultValue={p.condicoes?.valor_min ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    editar(p.id, { condicoes: v ? { ...(p.condicoes ?? {}), valor_min: Number(v) } : null });
                  }}
                  title="Só aplica se o valor for ≥ a isto (opcional)"
                />
                <select
                  className={`${campo} w-56`}
                  value={p.modo}
                  onChange={(e) => editar(p.id, { modo: e.target.value as ProcedimentoModo })}
                >
                  {(Object.keys(MODO) as ProcedimentoModo[]).map((m) => (
                    <option key={m} value={m}>{MODO[m]}</option>
                  ))}
                </select>
                <button
                  onClick={() => editar(p.id, { ativo: !p.ativo })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    p.ativo ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {p.ativo ? "Ativo" : "Inativo"}
                </button>
                <button onClick={() => apagar(p)} className="px-2 text-slate-400 transition hover:text-red-600" aria-label="Apagar">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {aCriar ? (
        <form onSubmit={criar} className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs font-medium text-slate-600 sm:col-span-2">
              <span>Nome</span>
              <input className={`${campo} w-full`} name="nome" placeholder="Ex.: Avisar motorista de coima acima de 60€" required />
            </label>
            <label className="block space-y-1 text-xs font-medium text-slate-600">
              <span>Quando (gatilho)</span>
              <select className={`${campo} w-full`} name="gatilho" defaultValue="coima_registada">
                {(Object.keys(GATILHO) as ProcedimentoGatilho[]).map((g) => <option key={g} value={g}>{GATILHO[g]}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-slate-600">
              <span>Ação</span>
              <select className={`${campo} w-full`} name="acao" defaultValue="comunicar_motorista">
                {(Object.keys(ACAO) as ProcedimentoAcao[]).map((a) => <option key={a} value={a}>{ACAO[a]}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs font-medium text-slate-600 sm:col-span-2">
              <span>Modo</span>
              <select className={`${campo} w-full`} name="modo" defaultValue="manual">
                {(Object.keys(MODO) as ProcedimentoModo[]).map((m) => <option key={m} value={m}>{MODO[m]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">Criar</button>
            <button type="button" onClick={() => setACriar(false)} className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancelar</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setACriar(true)} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
          + Novo procedimento
        </button>
      )}

      <p className="text-xs text-slate-400">
        Modo <strong>automático</strong> envia sem confirmação (WhatsApp/SMS via Twilio para o motorista; Telegram para o gestor) — usa com cuidado.
        Modo <strong>manual</strong> prepara a mensagem e tu envias com 1 clique.
      </p>
    </div>
  );
}
