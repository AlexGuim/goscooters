"use client";

import { useMemo, useState } from "react";
import type {
  Despesa,
  DespesaCategoria,
  EstadoPagamentoDespesa,
  ImputarA,
  Moto,
  Proprietario,
} from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import {
  criarDespesa,
  atualizarDespesa,
  eliminarDespesa,
} from "@/actions/despesaActions";

export interface DespesaComNomes extends Despesa {
  veiculo_matricula: string | null;
  proprietario_nome: string | null;
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const CATEGORIAS: { valor: DespesaCategoria; rotulo: string }[] = [
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "portagem", rotulo: "Portagem" },
  { valor: "coima", rotulo: "Coima" },
  { valor: "seguro", rotulo: "Seguro" },
  { valor: "gps", rotulo: "GPS" },
  { valor: "outro", rotulo: "Outro" },
];
const CAT_ROTULO: Record<DespesaCategoria, string> = {
  manutencao: "Manutenção", portagem: "Portagem", coima: "Coima",
  seguro: "Seguro", gps: "GPS", comissao: "Comissão", outro: "Outro",
};
const CAT_COR: Record<DespesaCategoria, string> = {
  manutencao: "bg-blue-100 text-blue-700",
  portagem: "bg-purple-100 text-purple-700",
  coima: "bg-red-100 text-red-700",
  seguro: "bg-emerald-100 text-emerald-700",
  gps: "bg-slate-100 text-slate-700",
  comissao: "bg-amber-100 text-amber-800",
  outro: "bg-slate-100 text-slate-600",
};
const IMPUTAR_ROTULO: Record<ImputarA, string> = {
  goscooters: "GoScooters", proprietario: "Proprietário", motorista: "Motorista",
};
// Quem costuma suportar cada tipo de custo (default; sempre editável).
const IMPUTAR_PADRAO: Record<DespesaCategoria, ImputarA> = {
  manutencao: "proprietario",
  seguro: "proprietario",
  gps: "proprietario",
  portagem: "motorista",
  coima: "motorista",
  comissao: "goscooters",
  outro: "goscooters",
};

const hoje = () => new Date().toISOString().slice(0, 10);

export default function DespesasList({
  inicial,
  motos,
  proprietarios,
}: {
  inicial: DespesaComNomes[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}) {
  const [despesas, setDespesas] = useState(inicial);
  const [filtroCat, setFiltroCat] = useState<DespesaCategoria | "">("");
  const [filtroVeiculo, setFiltroVeiculo] = useState("");
  const [filtroDono, setFiltroDono] = useState("");
  const [modal, setModal] = useState<DespesaComNomes | "novo" | null>(null);

  const filtradas = despesas.filter(
    (d) =>
      (!filtroCat || d.categoria === filtroCat) &&
      (!filtroVeiculo || d.veiculo_id === filtroVeiculo) &&
      (!filtroDono ||
        (filtroDono === "__sem__" ? !d.proprietario_id : d.proprietario_id === filtroDono)),
  );

  const total = useMemo(
    () => filtradas.reduce((s, d) => s + Number(d.valor_total), 0),
    [filtradas],
  );

  const handleSaved = (d: DespesaComNomes) => {
    setDespesas((atuais) => {
      const existe = atuais.some((x) => x.id === d.id);
      return existe ? atuais.map((x) => (x.id === d.id ? d : x)) : [d, ...atuais];
    });
    setModal(null);
  };

  const handleEliminar = async (d: DespesaComNomes) => {
    if (!window.confirm("Eliminar esta despesa?")) return;
    const r = await eliminarDespesa(d.id);
    if (r.success) setDespesas((atuais) => atuais.filter((x) => x.id !== d.id));
    else alert(r.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroCat}
            onChange={(e) => setFiltroCat(e.target.value as DespesaCategoria | "")}
          >
            <option value="">Todas as categorias</option>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>{c.rotulo}</option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroVeiculo}
            onChange={(e) => setFiltroVeiculo(e.target.value)}
          >
            <option value="">Todos os veículos</option>
            {motos.map((m) => (
              <option key={m.id} value={m.id}>{m.matricula ?? m.modelo}</option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroDono}
            onChange={(e) => setFiltroDono(e.target.value)}
          >
            <option value="">Todos os proprietários</option>
            {proprietarios.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
            <option value="__sem__">— sem proprietário —</option>
          </select>
          <span className="text-sm text-slate-600">
            {filtradas.length} · total {formatarPreco(total)}
          </span>
        </div>
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setModal("novo")}
        >
          + Nova despesa
        </button>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">Nenhuma despesa neste filtro.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {filtradas.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CAT_COR[d.categoria]}`}>
                      {CAT_ROTULO[d.categoria]}
                    </span>
                    <span className="text-sm font-medium text-slate-950">
                      {d.veiculo_matricula ?? "estrutura"}
                    </span>
                    {d.estado_pagamento !== "paga" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        {d.estado_pagamento}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    {dataBR(d.data_despesa)}
                    {d.descricao ? ` · ${d.descricao}` : ""}
                    {` · suporta: ${IMPUTAR_ROTULO[d.imputar_a]}`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-slate-950">{formatarPreco(d.valor_total)}</span>
                  <button
                    className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
                    onClick={() => setModal(d)}
                  >
                    Editar
                  </button>
                  <button
                    className="text-xs font-semibold text-red-600 transition hover:text-red-700"
                    onClick={() => handleEliminar(d)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <FormDespesa
          despesa={modal === "novo" ? null : modal}
          motos={motos}
          proprietarios={proprietarios}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function FormDespesa({
  despesa,
  motos,
  proprietarios,
  onClose,
  onSaved,
}: {
  despesa: DespesaComNomes | null;
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
  onClose: () => void;
  onSaved: (d: DespesaComNomes) => void;
}) {
  const aEditar = Boolean(despesa);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<DespesaCategoria>(despesa?.categoria ?? "manutencao");
  const [imputarA, setImputarA] = useState<ImputarA>(
    despesa?.imputar_a ?? IMPUTAR_PADRAO["manutencao"],
  );

  // Ao mudar a categoria, ajusta o "quem suporta" para o default dessa categoria.
  const trocarCategoria = (c: DespesaCategoria) => {
    setCategoria(c);
    setImputarA(IMPUTAR_PADRAO[c]);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro(null);
    setAGravar(true);

    const veiculoId = String(dados.get("veiculo_id") ?? "") || null;
    const base = {
      veiculo_id: veiculoId,
      categoria: String(dados.get("categoria") ?? "outro") as DespesaCategoria,
      descricao: String(dados.get("descricao") ?? "").trim() || null,
      valor: String(dados.get("valor") ?? "").replace(",", "."),
      iva: String(dados.get("iva") ?? "").replace(",", ".") || null,
      data_despesa: String(dados.get("data_despesa") ?? ""),
      data_vencimento: String(dados.get("data_vencimento") ?? "") || null,
      estado_pagamento: String(dados.get("estado_pagamento") ?? "pendente") as EstadoPagamentoDespesa,
      imputar_a: String(dados.get("imputar_a") ?? "goscooters") as ImputarA,
      fornecedor: String(dados.get("fornecedor") ?? "").trim() || null,
      referencia_externa: String(dados.get("referencia_externa") ?? "").trim() || null,
      recorrente: dados.get("recorrente") === "on",
    };

    if (!base.valor || Number.isNaN(Number(base.valor)) || Number(base.valor) < 0) {
      setErro("Indica um valor válido.");
      setAGravar(false);
      return;
    }

    try {
      const r = aEditar
        ? await atualizarDespesa(despesa!.id, base)
        : await criarDespesa(base);
      setAGravar(false);
      if (!r.success) {
        setErro(r.error ?? "Erro ao gravar.");
        return;
      }
      const dono = veiculoId
        ? motos.find((m) => m.id === veiculoId)?.proprietario_id ?? null
        : null;
      onSaved({
        ...(despesa ?? ({ created_at: new Date().toISOString() } as DespesaComNomes)),
        ...(base as Partial<Despesa>),
        valor_total: String(Number(base.valor) + Number(base.iva ?? 0)),
        proprietario_id: dono,
        id: aEditar ? despesa!.id : (r as { id?: string }).id ?? "",
        veiculo_matricula: veiculoId ? motos.find((m) => m.id === veiculoId)?.matricula ?? "—" : null,
        proprietario_nome: proprietarios.find((p) => p.id === dono)?.nome ?? null,
      } as DespesaComNomes);
    } catch (err) {
      console.error(err);
      setErro("Erro inesperado. Tenta novamente.");
      setAGravar(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div className="my-8 w-full max-w-lg rounded-3xl bg-white p-6 shadow-lg sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold text-slate-950">
            {aEditar ? "Editar despesa" : "Nova despesa"}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Categoria</span>
              <select
                className={campo}
                name="categoria"
                value={categoria}
                onChange={(e) => trocarCategoria(e.target.value as DespesaCategoria)}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>{c.rotulo}</option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              <span>Veículo</span>
              <select className={campo} name="veiculo_id" defaultValue={despesa?.veiculo_id ?? ""}>
                <option value="">— custo de estrutura —</option>
                {motos.map((m) => (
                  <option key={m.id} value={m.id}>{m.matricula ?? m.modelo}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>Valor (€) <span className="text-red-600">*</span></span>
              <input className={campo} name="valor" type="number" step="0.01" min="0" defaultValue={despesa?.valor ?? ""} required />
            </label>
            <label className={etiqueta}>
              <span>IVA (€)</span>
              <input className={campo} name="iva" type="number" step="0.01" min="0" defaultValue={despesa?.iva ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>Data <span className="text-red-600">*</span></span>
              <input className={campo} name="data_despesa" type="date" defaultValue={despesa?.data_despesa ?? hoje()} required />
            </label>
          </div>

          <label className={etiqueta}>
            <span>Descrição</span>
            <input className={campo} name="descricao" defaultValue={despesa?.descricao ?? ""} placeholder="Ex.: mudança de óleo e travões" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Quem suporta o custo</span>
              <select
                className={campo}
                name="imputar_a"
                value={imputarA}
                onChange={(e) => setImputarA(e.target.value as ImputarA)}
              >
                <option value="goscooters">GoScooters</option>
                <option value="proprietario">Proprietário</option>
                <option value="motorista">Motorista</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Estado do pagamento</span>
              <select className={campo} name="estado_pagamento" defaultValue={despesa?.estado_pagamento ?? "pendente"}>
                <option value="pendente">Pendente</option>
                <option value="parcial">Parcial</option>
                <option value="paga">Paga</option>
                <option value="isenta">Isenta</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Fornecedor</span>
              <input className={campo} name="fornecedor" defaultValue={despesa?.fornecedor ?? ""} placeholder="Oficina, Via Verde..." />
            </label>
            <label className={etiqueta}>
              <span>Referência (nº fatura/auto)</span>
              <input className={campo} name="referencia_externa" defaultValue={despesa?.referencia_externa ?? ""} />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="recorrente" defaultChecked={despesa?.recorrente ?? false} />
            <span className="text-sm text-slate-700">Despesa recorrente (ex.: GPS, seguro mensal)</span>
          </label>

          {erro && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={aGravar} className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
              {aGravar ? "A gravar..." : aEditar ? "Guardar" : "Criar despesa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
