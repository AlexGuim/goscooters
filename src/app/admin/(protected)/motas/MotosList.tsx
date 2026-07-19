"use client";

import { useState } from "react";
import type { Moto } from "@/types/db";
import { updateMoto } from "@/actions/motoActions";

interface MotosListProps {
  initialMotas: Moto[];
}

export default function MotosList({ initialMotas }: MotosListProps) {
  const [motas, setMotas] = useState(initialMotas);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleEstadoChange = async (motoId: string, novoEstado: string) => {
    const result = await updateMoto(motoId, {
      estado: novoEstado as "disponivel" | "alugada" | "manutencao",
    });

    if (result.success) {
      setMotas(
        motas.map((m) =>
          m.id === motoId ? { ...m, estado: novoEstado as any } : m,
        ),
      );
    } else {
      alert(result.error);
    }
  };

  const handleAtivoChange = async (motoId: string, novoAtivo: boolean) => {
    const result = await updateMoto(motoId, { ativo: novoAtivo });

    if (result.success) {
      setMotas(motas.map((m) => (m.id === motoId ? { ...m, ativo: novoAtivo } : m)));
    } else {
      alert(result.error);
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Modelo</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Cilindrada</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Preço/mês</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Estado</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Disponível em</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Ativo</th>
              <th className="px-6 py-4 text-left font-semibold text-slate-950">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {motas.map((moto) => (
              <tr key={moto.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-950">{moto.modelo}</td>
                <td className="px-6 py-4 text-slate-600">{moto.cilindrada ?? "—"} cc</td>
                <td className="px-6 py-4 text-slate-600">€{moto.preco_mes}</td>
                <td className="px-6 py-4">
                  <select
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                    value={moto.estado}
                    onChange={(e) => handleEstadoChange(moto.id, e.target.value)}
                  >
                    <option value="disponivel">Disponível</option>
                    <option value="alugada">Alugada</option>
                    <option value="manutencao">Manutenção</option>
                  </select>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  <input
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                    type="date"
                    value={moto.disponivel_em ?? ""}
                    onChange={async (e) => {
                      const result = await updateMoto(moto.id, {
                        disponivel_em: e.target.value || null,
                      });
                      if (result.success) {
                        setMotas(
                          motas.map((m) =>
                            m.id === moto.id
                              ? { ...m, disponivel_em: e.target.value || null }
                              : m,
                          ),
                        );
                      }
                    }}
                  />
                </td>
                <td className="px-6 py-4">
                  <button
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      moto.ativo
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                    onClick={() => handleAtivoChange(moto.id, !moto.ativo)}
                  >
                    {moto.ativo ? "Ativo" : "Inativo"}
                  </button>
                </td>
                <td className="px-6 py-4">
                  <button className="text-xs text-emerald-600 hover:text-emerald-700">
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {motas.length === 0 && (
        <div className="px-6 py-12 text-center">
          <p className="text-slate-600">Nenhuma mota registada.</p>
        </div>
      )}
    </div>
  );
}
