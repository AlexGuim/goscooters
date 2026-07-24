"use client";

import { useState } from "react";
import { registarDanoRecolha } from "@/actions/vistoriaActions";

const campo = "rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

export default function DanoForm({ contratoId }: { contratoId: string }) {
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    const r = await registarDanoRecolha(contratoId, valor, descricao);
    setAGravar(false);
    if (!r.success) return setErro(r.error ?? "Erro.");
    window.location.reload();
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input className={`${campo} w-24`} inputMode="decimal" placeholder="€" value={valor} onChange={(e) => setValor(e.target.value)} />
      <input className={`${campo} min-w-[12rem] flex-1`} placeholder="Descrição do dano novo" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      <button
        onClick={gravar}
        disabled={aGravar}
        className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
      >
        {aGravar ? "..." : "Imputar à caução"}
      </button>
      {erro && <span className="w-full text-sm text-red-700">{erro}</span>}
    </div>
  );
}
