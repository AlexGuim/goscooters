"use client";

import { useState } from "react";
import type { PedidoAluguer, PedidoEstado } from "@/types/db";
import { updatePedidoEstado } from "@/actions/pedidoActions";
import { duracaoPorExtenso } from "@/lib/precos";

interface PedidosListProps {
  initialPedidos: PedidoAluguer[];
}

const estadoColors: Record<PedidoEstado, string> = {
  novo: "bg-blue-100 text-blue-700",
  contactado: "bg-amber-100 text-amber-700",
  fechado: "bg-emerald-100 text-emerald-700",
  perdido: "bg-red-100 text-red-700",
};

export default function PedidosList({ initialPedidos }: PedidosListProps) {
  const [pedidos, setPedidos] = useState(initialPedidos);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleEstadoChange = async (pedidoId: string, novoEstado: PedidoEstado) => {
    const result = await updatePedidoEstado(pedidoId, novoEstado);

    if (result.success) {
      setPedidos(
        pedidos.map((p) => (p.id === pedidoId ? { ...p, estado: novoEstado } : p)),
      );
    } else {
      alert(result.error);
    }
  };

  return (
    <div className="space-y-4">
      {pedidos.map((pedido) => (
        <div
          key={pedido.id}
          className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
        >
          <button
            className="w-full px-6 py-4 text-left transition hover:bg-slate-50"
            onClick={() => setExpandedId(expandedId === pedido.id ? null : pedido.id)}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-slate-950">{pedido.nome}</h3>
                <p className="mt-1 text-sm text-slate-600">{pedido.telefone}</p>
              </div>
              <div className="flex items-center gap-4">
                <select
                  className={`rounded-full px-3 py-1 text-xs font-semibold outline-none transition focus:ring-2 focus:ring-emerald-500 ${
                    estadoColors[pedido.estado]
                  }`}
                  value={pedido.estado}
                  onChange={(e) => {
                    handleEstadoChange(pedido.id, e.target.value as PedidoEstado);
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="novo">Novo</option>
                  <option value="contactado">Contactado</option>
                  <option value="fechado">Fechado</option>
                  <option value="perdido">Perdido</option>
                </select>
                <span className="text-lg text-slate-400">
                  {expandedId === pedido.id ? "−" : "+"}
                </span>
              </div>
            </div>
          </button>

          {expandedId === pedido.id && (
            <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Email</p>
                  <p className="mt-1 text-sm text-slate-900">{pedido.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Plataforma</p>
                  <p className="mt-1 text-sm text-slate-900">{pedido.plataforma || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Data início</p>
                  <p className="mt-1 text-sm text-slate-900">{pedido.data_inicio || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Duração</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {pedido.duracao && pedido.periodo
                      ? duracaoPorExtenso(pedido.duracao, pedido.periodo)
                      : "—"}
                  </p>
                </div>
                {pedido.mensagem && (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-[0.1em] text-slate-500">Mensagem</p>
                    <p className="mt-1 text-sm text-slate-900">{pedido.mensagem}</p>
                  </div>
                )}
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-200 pt-4">
                <a
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={`https://wa.me/${pedido.telefone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
                {pedido.email && (
                  <a
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:border-slate-400 hover:bg-slate-50"
                    href={`mailto:${pedido.email}`}
                  >
                    Email
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      ))}

      {pedidos.length === 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-slate-600">Nenhum pedido registado.</p>
        </div>
      )}
    </div>
  );
}
