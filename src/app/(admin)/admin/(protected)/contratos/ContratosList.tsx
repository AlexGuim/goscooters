"use client";

import { useState } from "react";
import Link from "next/link";
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
  finalizarPreContrato,
  descartarPreContrato,
  gerarCobrancas,
  terminarContrato,
} from "@/actions/contratoActions";
import { criarSessaoEntrega, criarSessaoRegisto } from "@/actions/entregaActions";
import GrupoColapsavel from "@/components/GrupoColapsavel";

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
  pre_contrato: { rotulo: "Pré-contrato", cor: "bg-indigo-100 text-indigo-700" },
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
  const [registo, setRegisto] = useState(false);
  const [aGerar, setAGerar] = useState<string | null>(null);

  const filtrados = contratos.filter((c) => {
    if (filtro === "") return true;
    if (filtro === "abertos")
      return c.estado === "ativo" || c.estado === "pendente_fecho" || c.estado === "suspenso";
    return c.estado === filtro;
  });

  // Agrupados por proprietário da moto (secção colapsável por dono).
  const grupos = (() => {
    const m = new Map<string, { nome: string; itens: ContratoComNomes[] }>();
    for (const c of filtrados) {
      const nome = c.proprietario_nome ?? "Sem proprietário";
      if (!m.has(nome)) m.set(nome, { nome, itens: [] });
      m.get(nome)!.itens.push(c);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  })();

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
    // Cobrança aberta: gera-se sempre até um horizonte rolante (8 semanas à
    // frente), sem pedir data-limite. Correr de novo estende o horizonte.
    setAGerar(c.id);
    const r = await gerarCobrancas(c.id, horizontePadrao());
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

  const handleLink = async (c: ContratoComNomes) => {
    setAGerar(c.id);
    const r = await criarSessaoEntrega(c.id);
    setAGerar(null);
    if (r.success && r.link) {
      if (r.whatsapp) {
        // Abre o WhatsApp já com a mensagem na língua do motorista.
        window.open(r.whatsapp, "_blank");
      } else {
        window.prompt(
          "Link de preparação (72h). Copia e envia ao motorista (sem telefone E.164 na ficha):",
          r.link,
        );
      }
    } else {
      alert(r.error);
    }
  };

  const handleDescartar = async (c: ContratoComNomes) => {
    if (!window.confirm(`Descartar a jornada ${c.numero}? Fica cancelada.`)) return;
    const r = await descartarPreContrato(c.id);
    if (r.success) {
      setContratos((atuais) => atuais.map((x) => (x.id === c.id ? { ...x, estado: "cancelado" } : x)));
    } else {
      alert(r.error);
    }
  };

  const handleTerminar = async (c: ContratoComNomes) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const dataFim = window.prompt(
      `Terminar o contrato ${c.numero}? Para de faturar e anula as semanas futuras por pagar.\n\nData de fim (AAAA-MM-DD):`,
      hoje,
    );
    if (!dataFim) return;

    setAGerar(c.id);
    const r = await terminarContrato(c.id, dataFim);
    setAGerar(null);

    if (r.success) {
      setContratos((atuais) =>
        atuais.map((x) => (x.id === c.id ? { ...x, estado: "concluido", data_fim: dataFim } : x)),
      );
      alert(`Contrato terminado.${r.anuladas ? ` ${r.anuladas} cobrança(s) futura(s) anulada(s).` : ""}`);
    } else {
      alert(r.error);
    }
  };

  const handleSuspender = async (c: ContratoComNomes, suspender: boolean) => {
    if (
      suspender &&
      !window.confirm(
        `Suspender o contrato ${c.numero}? Pausa a faturação (deixa de gerar novas cobranças) até retomares. As cobranças já geradas mantêm-se.`,
      )
    )
      return;
    const novo: ContratoEstado = suspender ? "suspenso" : "ativo";
    setAGerar(c.id);
    const r = await atualizarContrato(c.id, { estado: novo });
    setAGerar(null);
    if (r.success) {
      setContratos((atuais) => atuais.map((x) => (x.id === c.id ? { ...x, estado: novo } : x)));
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
          <option value="suspenso">Suspensos</option>
          <option value="concluido">Concluídos</option>
          <option value="cancelado">Cancelados</option>
        </select>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
            onClick={() => setRegisto(true)}
          >
            Registar motorista (link)
          </button>
          <button
            className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            onClick={() => setModal("novo")}
          >
            + Novo contrato
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">Nenhum contrato neste filtro.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => (
            <GrupoColapsavel key={g.nome} titulo={g.nome} resumo={`${g.itens.length} contrato(s)`}>
              <div className="divide-y divide-slate-100">
                {g.itens.map((c) => {
            const info = ESTADO_INFO[c.estado];
            const aberto = c.estado === "ativo" || c.estado === "pendente_fecho";
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
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
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right text-sm">
                    {c.preco_periodo ? (
                      <>
                        <p className="font-semibold text-slate-950">
                          €{c.preco_periodo}/{PERIODICIDADE_ROTULO[c.periodicidade]}
                        </p>
                        <p className="text-xs text-slate-500">
                          {c.dia_vencimento ? DIAS[c.dia_vencimento] : "sem dia"}
                          {!c.ancora_vencimento && " · faturação por iniciar"}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-medium text-indigo-600">mota/preço por atribuir</p>
                    )}
                  </div>

                  {c.estado === "pre_contrato" ? (
                    <>
                      <button
                        className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                        onClick={() => setModal(c)}
                      >
                        Finalizar
                      </button>
                      <button
                        className="text-xs font-semibold text-red-600 transition hover:text-red-700"
                        onClick={() => handleDescartar(c)}
                      >
                        Descartar
                      </button>
                    </>
                  ) : (
                    <>
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
                        className="text-xs font-semibold text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
                        onClick={() => handleLink(c)}
                        disabled={aGerar === c.id}
                      >
                        Link ao motorista
                      </button>
                      {c.estado !== "concluido" && c.estado !== "cancelado" && (
                        <Link
                          href={`/admin/contratos/${c.id}/entrega`}
                          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Entregar
                        </Link>
                      )}
                      {(aberto || c.estado === "suspenso") && (
                        <Link
                          href={`/admin/contratos/${c.id}/recolha`}
                          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                        >
                          Devolver
                        </Link>
                      )}
                      {c.estado !== "rascunho" && c.estado !== "cancelado" && (
                        <Link
                          href={`/admin/contratos/${c.id}/vistoria`}
                          className="text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                        >
                          Ver vistoria
                        </Link>
                      )}
                      {c.estado === "suspenso" && (
                        <button
                          className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                          onClick={() => handleSuspender(c, false)}
                          disabled={aGerar === c.id}
                        >
                          Retomar
                        </button>
                      )}
                      <button
                        className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
                        onClick={() => setModal(c)}
                      >
                        Editar
                      </button>
                      {c.estado === "ativo" && (
                        <button
                          className="text-xs font-semibold text-amber-700 transition hover:text-amber-800 disabled:opacity-50"
                          onClick={() => handleSuspender(c, true)}
                          disabled={aGerar === c.id}
                        >
                          Suspender
                        </button>
                      )}
                      {(aberto || c.estado === "suspenso") && (
                        <button
                          className="text-xs font-semibold text-red-600 transition hover:text-red-700 disabled:opacity-50"
                          onClick={() => handleTerminar(c)}
                          disabled={aGerar === c.id}
                        >
                          Terminar
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
                })}
              </div>
            </GrupoColapsavel>
          ))}
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

      {registo && <RegistoLinkModal onClose={() => setRegisto(false)} />}
    </div>
  );
}

function RegistoLinkModal({ onClose }: { onClose: () => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [idioma, setIdioma] = useState("pt");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const enviar = async () => {
    setErro(null);
    if (!telefone.trim()) return setErro("Indica o telefone do motorista.");
    setAEnviar(true);
    const r = await criarSessaoRegisto({ nome: nome.trim() || null, telefone: telefone.trim(), idioma });
    setAEnviar(false);
    if (!r.success) return setErro(r.error ?? "Erro ao criar o link.");
    setLink(r.link ?? null);
    // Se houver telefone E.164 na ficha, abre logo o WhatsApp com a mensagem pronta.
    if (r.whatsapp) window.open(r.whatsapp, "_blank");
  };

  const campoIn = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6" onClick={onClose}>
      <div className="my-8 w-full max-w-md rounded-3xl bg-white p-6 shadow-lg sm:p-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Registar motorista</h2>
            <p className="text-sm text-slate-600">Envia-lhe o link — ele carrega o documento e o sistema preenche a ficha.</p>
          </div>
          <button className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 transition hover:bg-slate-100" onClick={onClose} type="button" aria-label="Fechar">×</button>
        </div>

        {link ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-slate-700">Link criado (válido 72h). Se o WhatsApp não abriu, copia e envia:</p>
            <input className={campoIn} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <button onClick={onClose} className="w-full rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
              Concluído
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              <span>Nome (opcional)</span>
              <input className={campoIn} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Fica por confirmar no registo" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              <span>Telefone <span className="text-red-600">*</span></span>
              <input className={campoIn} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+351 91 234 5678" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              <span>Idioma do link e do formulário</span>
              <select className={campoIn} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                <option value="pt">Português</option>
                <option value="en">English (outras línguas)</option>
              </select>
            </label>
            {erro && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50">
                Cancelar
              </button>
              <button type="button" onClick={enviar} disabled={aEnviar} className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                {aEnviar ? "A criar…" : "Criar e enviar link"}
              </button>
            </div>
          </div>
        )}
      </div>
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

    // Finalizar um pré-contrato: atribui mota/preço/data e passa-o a 'rascunho'.
    const ehPreContrato = aEditar && contrato!.estado === "pre_contrato";

    try {
      const r = ehPreContrato
        ? await finalizarPreContrato(contrato!.id, {
            veiculo_id: base.veiculo_id,
            proprietario_id: base.proprietario_id,
            periodicidade: base.periodicidade,
            dia_vencimento: base.dia_vencimento,
            preco_periodo: base.preco_periodo,
            caucao: base.caucao,
            data_inicio: base.data_inicio,
            ancora_vencimento: base.ancora_vencimento,
            observacoes: base.observacoes,
          })
        : aEditar
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
        estado: ehPreContrato ? "rascunho" : base.estado,
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
              {aGravar
                ? "A gravar..."
                : contrato?.estado === "pre_contrato"
                  ? "Finalizar contrato"
                  : aEditar
                    ? "Guardar"
                    : "Criar contrato"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
