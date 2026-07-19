"use client";

import { useState } from "react";
import type { Moto, MotoEstado } from "@/types/db";
import { updateMoto, deleteMoto } from "@/actions/motoActions";
import { precosDisponiveis, formatarPreco } from "@/lib/precos";
import MotoForm from "./MotoForm";

interface MotosListProps {
  initialMotas: Moto[];
}

type Modal = { tipo: "criar" } | { tipo: "editar"; moto: Moto } | null;

export default function MotosList({ initialMotas }: MotosListProps) {
  const [motas, setMotas] = useState(initialMotas);
  const [modal, setModal] = useState<Modal>(null);
  const [aEliminar, setAEliminar] = useState<string | null>(null);

  const aplicar = (motoId: string, alteracoes: Partial<Moto>) =>
    setMotas((atuais) =>
      atuais.map((m) => (m.id === motoId ? { ...m, ...alteracoes } : m)),
    );

  const handleEstadoChange = async (motoId: string, novoEstado: MotoEstado) => {
    const resultado = await updateMoto(motoId, { estado: novoEstado });
    if (resultado.success) {
      aplicar(motoId, { estado: novoEstado });
    } else {
      alert(resultado.error);
    }
  };

  const handleAtivoChange = async (motoId: string, novoAtivo: boolean) => {
    const resultado = await updateMoto(motoId, { ativo: novoAtivo });
    if (resultado.success) {
      aplicar(motoId, { ativo: novoAtivo });
    } else {
      alert(resultado.error);
    }
  };

  const handleDisponivelEmChange = async (motoId: string, valor: string) => {
    const disponivel_em = valor || null;
    const resultado = await updateMoto(motoId, { disponivel_em });
    if (resultado.success) {
      aplicar(motoId, { disponivel_em });
    } else {
      alert(resultado.error);
    }
  };

  const handleEliminar = async (moto: Moto) => {
    const confirmado = window.confirm(
      `Eliminar "${moto.modelo}" definitivamente?\n\nEsta ação não pode ser anulada. Se só a queres esconder do site, usa antes o botão "Ativo".`,
    );
    if (!confirmado) return;

    setAEliminar(moto.id);
    const resultado = await deleteMoto(moto.id);
    setAEliminar(null);

    if (resultado.success) {
      setMotas((atuais) => atuais.filter((m) => m.id !== moto.id));
    } else {
      alert(resultado.error);
    }
  };

  const handleSaved = (moto: Moto) => {
    setMotas((atuais) => {
      const existe = atuais.some((m) => m.id === moto.id);
      return existe
        ? atuais.map((m) => (m.id === moto.id ? moto : m))
        : [moto, ...atuais];
    });
    setModal(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          {motas.length} {motas.length === 1 ? "mota registada" : "motas registadas"}
        </p>
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setModal({ tipo: "criar" })}
        >
          + Nova mota
        </button>
      </div>

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Mota</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Cilindrada</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Preços</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Estado</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Disponível em</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Ativo</th>
                <th className="px-6 py-4 text-right font-semibold text-slate-950">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {motas.map((moto) => (
                <tr key={moto.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-16 flex-none overflow-hidden rounded-xl bg-slate-100">
                        {moto.foto_urls?.[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={moto.foto_urls[0]}
                            alt={moto.modelo}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
                            sem foto
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-slate-950">{moto.modelo}</p>
                        {moto.matricula && (
                          <p className="text-xs text-slate-500">{moto.matricula}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{moto.cilindrada ?? "—"} cc</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {precosDisponiveis(moto).map((preco) => (
                        <span key={preco.periodo} className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-950">
                            {formatarPreco(preco.valor)}
                          </span>{" "}
                          / {preco.rotulos.unidade}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
                      value={moto.estado}
                      onChange={(e) =>
                        handleEstadoChange(moto.id, e.target.value as MotoEstado)
                      }
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
                      onChange={(e) => handleDisponivelEmChange(moto.id, e.target.value)}
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
                    <div className="flex justify-end gap-3">
                      <button
                        className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
                        onClick={() => setModal({ tipo: "editar", moto })}
                      >
                        Editar
                      </button>
                      <button
                        className="text-xs font-semibold text-red-600 transition hover:text-red-700 disabled:opacity-50"
                        onClick={() => handleEliminar(moto)}
                        disabled={aEliminar === moto.id}
                      >
                        {aEliminar === moto.id ? "A eliminar..." : "Eliminar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {motas.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-600">Nenhuma mota registada.</p>
            <button
              className="mt-4 rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              onClick={() => setModal({ tipo: "criar" })}
            >
              + Criar a primeira mota
            </button>
          </div>
        )}
      </div>

      {modal && (
        <MotoForm
          moto={modal.tipo === "editar" ? modal.moto : undefined}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
