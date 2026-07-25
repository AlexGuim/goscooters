"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Notificacao } from "@/types/db";
import { marcarNotificacaoFeita, marcarTodasLidas } from "@/actions/notificacaoActions";

// Cor do ponto por tipo de evento (urgência/natureza).
const COR: Record<string, string> = {
  novo_pedido: "bg-blue-500",
  pre_contrato_sem_mota: "bg-indigo-500",
  contrato_pronto: "bg-emerald-500",
  kyc_por_validar: "bg-amber-500",
  coima_reembolso: "bg-purple-500",
  dano_recolha: "bg-red-500",
  acerto_por_pagar: "bg-emerald-600",
};

function relativo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

export default function NotificacoesList({ inicial }: { inicial: Notificacao[] }) {
  const [itens, setItens] = useState(inicial);
  const [aProcessar, setAProcessar] = useState<string | null>(null);
  // O tempo relativo só se calcula após montar, para o SSR e o cliente baterem certo.
  const [montado, setMontado] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMontado(true);
  }, []);

  const feita = async (id: string) => {
    setAProcessar(id);
    const r = await marcarNotificacaoFeita(id);
    setAProcessar(null);
    if (r.success) setItens((a) => a.filter((n) => n.id !== id));
  };

  const todasLidas = async () => {
    await marcarTodasLidas();
    setItens((a) => a.map((n) => (n.estado === "nova" ? { ...n, estado: "lida" } : n)));
  };

  const novas = itens.filter((n) => n.estado === "nova").length;

  if (itens.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
        <p className="text-slate-600">Tudo tratado. Sem notificações por resolver 🎉</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {novas > 0 && (
        <div className="flex justify-end">
          <button onClick={todasLidas} className="text-xs font-semibold text-slate-500 transition hover:text-slate-800">
            Marcar todas como lidas
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm divide-y divide-slate-100">
        {itens.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${COR[n.tipo] ?? "bg-slate-400"} ${n.estado === "nova" ? "" : "opacity-40"}`} />
              <div className="min-w-0">
                <p className={`text-sm ${n.estado === "nova" ? "font-semibold text-slate-950" : "font-medium text-slate-700"}`}>
                  {n.titulo}
                </p>
                {n.detalhe && <p className="text-sm text-slate-500">{n.detalhe}</p>}
                <p className="mt-0.5 text-xs text-slate-400" suppressHydrationWarning>{montado ? relativo(n.created_at) : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {n.href && (
                <Link
                  href={n.href}
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  Abrir
                </Link>
              )}
              <button
                onClick={() => feita(n.id)}
                disabled={aProcessar === n.id}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {aProcessar === n.id ? "..." : "Feito"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
