"use client";

import { useState } from "react";
import type {
  ContratoAluguer,
  ContratoEstado,
  Moto,
  Motorista,
  Periodicidade,
  Proprietario,
} from "@/types/db";
import {
  criarContrato,
  atualizarContrato,
  gerarCobrancas,
} from "@/actions/contratoActions";

export interface ContratoComNomes extends ContratoAluguer {
  motorista_nome: string;
  veiculo_matricula: string;
  veiculo_modelo: string;
  proprietario_nome: string | null;
  num_cobrancas: number;
}

interface Props {
  inicial: ContratoComNomes[];
  motoristas: Pick<Motorista, "id" | "nome" | "telefone">[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const ESTADO_INFO: Record<ContratoEstado, { rotulo: string; cor: string }> = {
  rascunho: { rotulo: "Rascunho", cor: "bg-slate-100 text-slate-600" },
  ativo: { rotulo: "Ativo", cor: "bg-emerald-100 text-emerald-700" },
  pendente_fecho: { rotulo: "Pendente de fecho", cor: "bg-amber-100 text-amber-800" },
  suspenso: { rotulo: "Suspenso", cor: "bg-slate-200 text-slate-700" },
  concluido: { rotulo: "Concluído", cor: "bg-slate-100 text-slate-500" },
  cancelado: { rotulo: "Cancelado", cor: "bg-red-100 text-red-700" },
};

const DIAS = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const PERIODICIDADE_ROTULO: Record<Periodicidade, string> = {
  semanal: "semana",
  quinzenal: "quinzena",
  mensal: "mês",
  diaria: "dia",
};

// Horizonte por omissão ao gerar cobranças: 8 períodos à frente (semanas).
function horizontePadrao(): string {
  const d = new Date();
  d.setDate(d.getDate() + 56);
  return d.toISOString().slice(0, 10);
}

export default function ContratosList({
  inicial,
  motoristas,
  motos,
  proprietarios,
}: Props) {
  const [contratos, setContratos] = useState(inicial);
  const [filtro, setFiltro] = useState<ContratoEstado | "abertos" | "">("abertos");
  const [modal, setModal] = useState<ContratoComNomes | "novo" | null>(null);
  const [aGerar, setAGerar] = useState<string | null>(null);

  const filtrados = contratos.filter((c) => {
    if (filtro === "") return true;
    if (filtro === "abertos") return c.estado === "ativo" || c.estado === "pendente_fecho";
    return c.estado === filtro;
  });

  const handleSaved = (c: ContratoComNomes) => {
    setContratos((atuais) => {
      const existe = atuais.some((x) => x.id === c.id);
      return existe ? atuais.map((x) => (x.id === c.id ? c : x)) : [c, ...atuais];
    });
    setModal(null);
  };

  const handleGerar = async (c: ContratoComNomes) => {
    if (!c.ancora_vencimento) {
      alert(
        "Define primeiro a data de início da faturação (Editar → Início da faturação).",
      );
      return;
    }
    const ate = window.prompt(
      "Gerar cobranças até que data? (AAAA-MM-DD)",
      horizontePadrao(),
    );
    if (!ate) return;

    setAGerar(c.id);
    const r = await gerarCobrancas(c.id, ate);
    setAGerar(null);

    if (r.success) {
      setContratos((atuais) =>
        atuais.map((x) =>
          x.id === c.id ? { ...x, num_cobrancas: x.num_cobrancas + (r.geradas ?? 0) } : x,
        ),
      );
      alert(`${r.geradas ?? 0} cobrança(s) nova(s) gerada(s).`);
    } else {
      alert(r.error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <select
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-500"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as ContratoEstado | "abertos" | "")}
        >
          <option value="abertos">Abertos (ativos + pendentes)</option>
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="pendente_fecho">Pendentes de fecho</option>
          <option value="concluido">Concluídos</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setModal("novo")}
        >
          + Novo contrato
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">Nenhum contrato neste filtro.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtrados.map((c) => {
            const info = ESTADO_INFO[c.estado];
            const aberto = c.estado === "ativo" || c.estado === "pendente_fecho";
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{c.numero}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${info.cor}`}>
                      {info.rotulo}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold text-slate-950">{c.motorista_nome}</p>
                  <p className="text-sm text-slate-600">
                    {c.veiculo_matricula}
                    {c.veiculo_modelo ? ` · ${c.veiculo_modelo}` : ""}
                    {c.proprietario_nome ? ` · ${c.proprietario_nome}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right text-sm">
                    <p className="font-semibold text-slate-950">
                      €{c.preco_periodo}/{PERIODICIDADE_ROTULO[c.periodicidade]}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.dia_vencimento ? DIAS[c.dia_vencimento] : "sem dia"}
                      {" · "}
                      {c.ancora_vencimento
                        ? `${c.num_cobrancas} cobrança(s)`
                        : "faturação por iniciar"}
                    </p>
                  </div>

                  {aberto && (
                    <button
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                      onClick={() => handleGerar(c)}
                      disabled={aGerar === c.id}
                    >
                      {aGerar === c.id ? "A gerar..." : "Gerar cobranças"}
                    </button>
                  )}
                  <button
                    className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
                    onClick={() => setModal(c)}
                  >
                    Editar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <ContratoForm
          contrato={modal === "novo" ? null : modal}
          motoristas={motoristas}
          motos={motos}
          proprietarios={proprietarios}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function ContratoForm({
  contrato,
  motoristas,
  motos,
  proprietarios,
  onClose,
  onSaved,
}: {
  contrato: ContratoComNomes | null;
  motoristas: Pick<Motorista, "id" | "nome" | "telefone">[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
  onClose: () => void;
  onSaved: (c: ContratoComNomes) => void;
}) {
  const aEditar = Boolean(contrato);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro(null);
    setAGravar(true);

    const veiculoId = String(dados.get("veiculo_id") ?? "");
    const motoSel = motos.find((m) => m.id === veiculoId);
    const donoSel = String(dados.get("proprietario_id") ?? "") || motoSel?.proprietario_id || null;

    const base = {
      motorista_id: String(dados.get("motorista_id") ?? ""),
      veiculo_id: veiculoId,
      proprietario_id: donoSel,
      periodicidade: String(dados.get("periodicidade") ?? "semanal") as Periodicidade,
      dia_vencimento: dados.get("dia_vencimento")
        ? Number(dados.get("dia_vencimento"))
        : null,
      preco_periodo: String(dados.get("preco_periodo") ?? "").replace(",", "."),
      caucao: String(dados.get("caucao") ?? "").replace(",", ".") || null,
      data_inicio: String(dados.get("data_inicio") ?? ""),
      ancora_vencimento: String(dados.get("ancora_vencimento") ?? "") || null,
      estado: String(dados.get("estado") ?? "ativo") as ContratoEstado,
      observacoes: String(dados.get("observacoes") ?? "").trim() || null,
    };

    if (!base.motorista_id || !base.veiculo_id || !base.data_inicio) {
      setErro("Cliente, veículo e data de início são obrigatórios.");
      setAGravar(false);
      return;
    }

    try {
      const r = aEditar
        ? await atualizarContrato(contrato!.id, base)
        : await criarContrato(base);
      setAGravar(false);
      if (!r.success) {
        setErro(r.error ?? "Erro ao gravar.");
        return;
      }
      const id = aEditar ? contrato!.id : (r as { id?: string }).id ?? "";
      const numero = aEditar ? contrato!.numero : (r as { numero?: string }).numero ?? "";
      onSaved({
        ...(contrato ?? ({ num_cobrancas: 0, created_at: new Date().toISOString() } as ContratoComNomes)),
        ...(base as Partial<ContratoAluguer>),
        id,
        numero,
        motorista_nome: motoristas.find((m) => m.id === base.motorista_id)?.nome ?? "—",
        veiculo_matricula: motoSel?.matricula ?? "—",
        veiculo_modelo: motoSel?.modelo ?? "",
        proprietario_nome: proprietarios.find((p) => p.id === donoSel)?.nome ?? null,
      } as ContratoComNomes);
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
      <div
        className="my-8 w-full max-w-2xl rounded-3xl bg-white p-6 shadow-lg sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold text-slate-950">
            {aEditar ? `Contrato ${contrato!.numero}` : "Novo contrato"}
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
              <span>Cliente <span className="text-red-600">*</span></span>
              <select className={campo} name="motorista_id" defaultValue={contrato?.motorista_id ?? ""} required>
                <option value="">Selecciona o motorista</option>
                {motoristas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome} · {m.telefone}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              <span>Veículo <span className="text-red-600">*</span></span>
              <select className={campo} name="veiculo_id" defaultValue={contrato?.veiculo_id ?? ""} required>
                <option value="">Selecciona o veículo</option>
                {motos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.matricula ?? "sem matrícula"} · {m.modelo}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>Periodicidade</span>
              <select className={campo} name="periodicidade" defaultValue={contrato?.periodicidade ?? "semanal"}>
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
                <option value="mensal">Mensal</option>
                <option value="diaria">Diária</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Preço (€) <span className="text-red-600">*</span></span>
              <input className={campo} name="preco_periodo" type="number" step="0.01" min="0" defaultValue={contrato?.preco_periodo ?? ""} required />
            </label>
            <label className={etiqueta}>
              <span>Dia de pagamento</span>
              <select className={campo} name="dia_vencimento" defaultValue={contrato?.dia_vencimento ?? ""}>
                <option value="">—</option>
                {DIAS.slice(1).map((d, i) => (
                  <option key={i + 1} value={i + 1}>{d}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>Data de início <span className="text-red-600">*</span></span>
              <input className={campo} name="data_inicio" type="date" defaultValue={contrato?.data_inicio ?? ""} required />
            </label>
            <label className={etiqueta}>
              <span>Caução (€)</span>
              <input className={campo} name="caucao" type="number" step="0.01" min="0" defaultValue={contrato?.caucao ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>Estado</span>
              <select className={campo} name="estado" defaultValue={contrato?.estado ?? "ativo"}>
                <option value="rascunho">Rascunho</option>
                <option value="ativo">Ativo</option>
                <option value="pendente_fecho">Pendente de fecho</option>
                <option value="suspenso">Suspenso</option>
                <option value="concluido">Concluído</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
          </div>

          <label className={etiqueta}>
            <span>Início da faturação (âncora do 1.º vencimento)</span>
            <input className={campo} name="ancora_vencimento" type="date" defaultValue={contrato?.ancora_vencimento ?? ""} />
            <span className="block text-xs text-slate-500">
              A partir desta data as cobranças são geradas. Deixa vazio até quereres
              começar a faturar na plataforma — assim não crias rendas do passado.
            </span>
          </label>

          <label className={etiqueta}>
            <span>Observações</span>
            <textarea className={`${campo} h-20`} name="observacoes" defaultValue={contrato?.observacoes ?? ""} />
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
              {aGravar ? "A gravar..." : aEditar ? "Guardar" : "Criar contrato"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
