"use client";

import { useState } from "react";
import type { Proprietario } from "@/types/db";
import {
  criarProprietario,
  atualizarProprietario,
  eliminarProprietario,
} from "@/actions/proprietarioActions";

export interface ProprietarioComContagem extends Proprietario {
  num_veiculos: number;
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

export default function ProprietariosList({
  inicial,
}: {
  inicial: ProprietarioComContagem[];
}) {
  const [donos, setDonos] = useState(inicial);
  const [modal, setModal] = useState<ProprietarioComContagem | "novo" | null>(null);

  const handleSaved = (d: ProprietarioComContagem) => {
    setDonos((atuais) => {
      const existe = atuais.some((x) => x.id === d.id);
      return existe ? atuais.map((x) => (x.id === d.id ? d : x)) : [...atuais, d];
    });
    setModal(null);
  };

  const handleEliminar = async (d: ProprietarioComContagem) => {
    if (!window.confirm(`Eliminar o proprietário "${d.nome}"?`)) return;
    const r = await eliminarProprietario(d.id);
    if (r.success) setDonos((atuais) => atuais.filter((x) => x.id !== d.id));
    else alert(r.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setModal("novo")}
        >
          + Novo proprietário
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {donos.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">{d.nome}</p>
                <p className="text-sm text-slate-500">
                  {d.num_veiculos} {d.num_veiculos === 1 ? "veículo" : "veículos"}
                </p>
              </div>
              {d.eh_goscooters ? (
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                  Frota própria
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {d.comissao_valor != null ? `${d.comissao_valor}%` : "comissão ?"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{d.tipo_parceiro === "anunciante" ? "Anunciante" : "Gerido"}</span>
              {d.email && <span>{d.email}</span>}
              {d.telefone && <span>{d.telefone}</span>}
            </div>

            <div className="mt-1 flex gap-3 border-t border-slate-100 pt-3">
              <button
                className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
                onClick={() => setModal(d)}
              >
                Editar
              </button>
              {d.num_veiculos === 0 && (
                <button
                  className="text-xs font-semibold text-red-600 transition hover:text-red-700"
                  onClick={() => handleEliminar(d)}
                >
                  Eliminar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <FormProprietario
          dono={modal === "novo" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function FormProprietario({
  dono,
  onClose,
  onSaved,
}: {
  dono: ProprietarioComContagem | null;
  onClose: () => void;
  onSaved: (d: ProprietarioComContagem) => void;
}) {
  const aEditar = Boolean(dono);
  const [ehGo, setEhGo] = useState(dono?.eh_goscooters ?? false);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);
    const comissaoBruta = String(dados.get("comissao_valor") ?? "").replace(",", ".");
    // numeric no Postgres → string (como os preços).
    const comissao = comissaoBruta ? String(Number(comissaoBruta)) : null;
    const campos = {
      nome: String(dados.get("nome") ?? "").trim(),
      email: String(dados.get("email") ?? "").trim() || null,
      telefone: String(dados.get("telefone") ?? "").trim() || null,
      nif: String(dados.get("nif") ?? "").trim() || null,
      iban: String(dados.get("iban") ?? "").trim() || null,
      comissao_valor: ehGo ? null : comissao,
      eh_goscooters: ehGo,
      tipo_parceiro: String(dados.get("tipo_parceiro") ?? "gerido") as
        | "gerido"
        | "anunciante",
    };

    if (!campos.nome) {
      setErro("Nome é obrigatório.");
      setAGravar(false);
      return;
    }

    const r = aEditar
      ? await atualizarProprietario(dono!.id, campos)
      : await criarProprietario(campos);
    setAGravar(false);

    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }

    onSaved({
      ...(dono ?? ({ num_veiculos: 0 } as ProprietarioComContagem)),
      ...(campos as Partial<Proprietario>),
      id: aEditar ? dono!.id : (r as { id?: string }).id ?? "",
      comissao_modelo: "percentagem",
    } as ProprietarioComContagem);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-lg rounded-3xl bg-white p-6 shadow-lg sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold text-slate-950">
            {aEditar ? "Editar proprietário" : "Novo proprietário"}
          </h2>
          <button
            className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 transition hover:bg-slate-100"
            onClick={onClose}
            type="button"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className={etiqueta}>
            <span>
              Nome <span className="text-red-600">*</span>
            </span>
            <input className={campo} name="nome" required defaultValue={dono?.nome} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Email</span>
              <input className={campo} type="email" name="email" defaultValue={dono?.email ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>Telefone</span>
              <input className={campo} name="telefone" defaultValue={dono?.telefone ?? ""} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>NIF</span>
              <input className={campo} name="nif" defaultValue={dono?.nif ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>IBAN (para transferências)</span>
              <input className={campo} name="iban" defaultValue={dono?.iban ?? ""} />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              className="h-4 w-4 accent-emerald-600"
              type="checkbox"
              checked={ehGo}
              onChange={(e) => setEhGo(e.target.checked)}
            />
            <span className="text-sm text-slate-700">
              Frota própria do GoScooters (não gera acerto nem comissão)
            </span>
          </label>

          {!ehGo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={etiqueta}>
                <span>Comissão (% da receita)</span>
                <input
                  className={campo}
                  name="comissao_valor"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={dono?.comissao_valor ?? ""}
                  placeholder="25"
                />
              </label>
              <label className={etiqueta}>
                <span>Tipo de parceiro</span>
                <select
                  className={campo}
                  name="tipo_parceiro"
                  defaultValue={dono?.tipo_parceiro ?? "gerido"}
                >
                  <option value="gerido">Gerido (GoScooters gere)</option>
                  <option value="anunciante">Anunciante (só divulga)</option>
                </select>
              </label>
            </div>
          )}

          <p className="text-xs text-slate-500">
            A comissão base aplica-se a todos os veículos deste parceiro. Um veículo
            pode ter uma comissão diferente (ex.: as motos pioneiras a 20%), definida
            na ficha do veículo.
          </p>

          {erro && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={aGravar}
              className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {aGravar ? "A gravar..." : aEditar ? "Guardar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
