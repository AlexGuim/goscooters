"use client";

import { useMemo, useState } from "react";
import type { Avaliacao, AvaliacaoTipo, Motorista } from "@/types/db";
import { normalizarTelefone } from "@/lib/telefone";
import {
  criarMotorista,
  eliminarMotorista,
  criarAvaliacao,
  eliminarAvaliacao,
} from "@/actions/motoristaActions";

export interface MotoristaComAvaliacoes extends Motorista {
  avaliacoes: Avaliacao[];
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const CORES: Record<AvaliacaoTipo, string> = {
  positiva: "bg-emerald-100 text-emerald-700",
  negativa: "bg-red-100 text-red-700",
  neutra: "bg-slate-100 text-slate-700",
};

const NOME_TIPO: Record<AvaliacaoTipo, string> = {
  positiva: "Positiva",
  negativa: "Negativa",
  neutra: "Neutra",
};

function contar(avaliacoes: Avaliacao[], tipo: AvaliacaoTipo) {
  return avaliacoes.filter((a) => a.tipo === tipo).length;
}

export default function MotoristasList({
  inicial,
}: {
  inicial: MotoristaComAvaliacoes[];
}) {
  const [motoristas, setMotoristas] = useState(inicial);
  const [procura, setProcura] = useState("");
  const [aCriar, setACriar] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    if (!termo) return motoristas;
    const digitos = normalizarTelefone(termo);
    return motoristas.filter(
      (m) =>
        m.nome.toLowerCase().includes(termo) ||
        (digitos && m.telefone_digitos.includes(digitos)),
    );
  }, [motoristas, procura]);

  const handleCriado = (m: MotoristaComAvaliacoes) => {
    setMotoristas((atuais) => [m, ...atuais]);
    setACriar(false);
    setExpandido(m.id);
  };

  const handleEliminar = async (m: MotoristaComAvaliacoes) => {
    if (
      !window.confirm(
        `Eliminar o registo de "${m.nome}" e todas as avaliações? Esta ação não pode ser anulada.`,
      )
    )
      return;
    const r = await eliminarMotorista(m.id);
    if (r.success) {
      setMotoristas((atuais) => atuais.filter((x) => x.id !== m.id));
    } else {
      alert(r.error);
    }
  };

  const atualizarLocal = (id: string, avaliacoes: Avaliacao[]) =>
    setMotoristas((atuais) =>
      atuais.map((m) => (m.id === id ? { ...m, avaliacoes } : m)),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          className={`${campo} max-w-sm`}
          placeholder="Procurar por nome ou telefone..."
          value={procura}
          onChange={(e) => setProcura(e.target.value)}
        />
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setACriar(true)}
        >
          + Novo motorista
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">
            {motoristas.length === 0
              ? "Ainda não há motoristas registados."
              : "Nenhum motorista corresponde à procura."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtrados.map((m) => {
            const pos = contar(m.avaliacoes, "positiva");
            const neg = contar(m.avaliacoes, "negativa");

            return (
              <div
                key={m.id}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white"
              >
                <button
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-slate-50"
                  onClick={() => setExpandido(expandido === m.id ? null : m.id)}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{m.nome}</p>
                    <p className="truncate text-sm text-slate-600">
                      {m.telefone}
                      {m.plataforma ? ` · ${m.plataforma}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {pos > 0 && (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                        ▲ {pos}
                      </span>
                    )}
                    {neg > 0 && (
                      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                        ▼ {neg}
                      </span>
                    )}
                    {pos === 0 && neg === 0 && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                        sem avaliações
                      </span>
                    )}
                  </div>
                </button>

                {expandido === m.id && (
                  <DetalheMotorista
                    motorista={m}
                    onAvaliacoes={(avs) => atualizarLocal(m.id, avs)}
                    onEliminar={() => handleEliminar(m)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {aCriar && (
        <FormMotorista onClose={() => setACriar(false)} onCriado={handleCriado} />
      )}
    </div>
  );
}

function DetalheMotorista({
  motorista,
  onAvaliacoes,
  onEliminar,
}: {
  motorista: MotoristaComAvaliacoes;
  onAvaliacoes: (avs: Avaliacao[]) => void;
  onEliminar: () => void;
}) {
  const [tipo, setTipo] = useState<AvaliacaoTipo>("positiva");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);
    const notaBruta = dados.get("nota");
    const r = await criarAvaliacao({
      motoristaId: motorista.id,
      tipo,
      nota: notaBruta ? Number(notaBruta) : null,
      comentario: String(dados.get("comentario") ?? ""),
      dataAluguer: String(dados.get("data_aluguer") ?? "") || undefined,
    });

    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }

    // Recarrega leve: acrescenta a avaliação nova em memória.
    const nova: Avaliacao = {
      id: crypto.randomUUID(),
      motorista_id: motorista.id,
      tipo,
      nota: notaBruta ? Number(notaBruta) : null,
      comentario: String(dados.get("comentario") ?? "").trim() || null,
      data_aluguer: String(dados.get("data_aluguer") ?? "") || null,
      created_at: new Date().toISOString(),
    };
    onAvaliacoes([nova, ...motorista.avaliacoes]);
    (e.target as HTMLFormElement).reset();
    setTipo("positiva");
  };

  const handleEliminarAvaliacao = async (id: string) => {
    const r = await eliminarAvaliacao(id);
    if (r.success) {
      onAvaliacoes(motorista.avaliacoes.filter((a) => a.id !== id));
    } else {
      alert(r.error);
    }
  };

  return (
    <div className="space-y-6 border-t border-slate-200 bg-slate-50 px-6 py-5">
      {motorista.notas && (
        <p className="rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm">
          {motorista.notas}
        </p>
      )}

      {/* Histórico */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Histórico
        </h3>
        {motorista.avaliacoes.length === 0 ? (
          <p className="text-sm text-slate-500">Ainda sem avaliações.</p>
        ) : (
          motorista.avaliacoes.map((a) => (
            <div
              key={a.id}
              className="flex items-start justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CORES[a.tipo]}`}
                  >
                    {NOME_TIPO[a.tipo]}
                  </span>
                  {a.nota != null && (
                    <span className="text-xs text-slate-500">{a.nota}/5</span>
                  )}
                  {a.data_aluguer && (
                    <span className="text-xs text-slate-400">· {a.data_aluguer}</span>
                  )}
                </div>
                {a.comentario && (
                  <p className="text-sm text-slate-700">{a.comentario}</p>
                )}
              </div>
              <button
                className="flex-none text-xs font-semibold text-red-600 transition hover:text-red-700"
                onClick={() => handleEliminarAvaliacao(a.id)}
              >
                Eliminar
              </button>
            </div>
          ))
        )}
      </div>

      {/* Nova avaliação */}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nova avaliação
        </h3>

        <div className="flex flex-wrap gap-2">
          {(["positiva", "negativa", "neutra"] as AvaliacaoTipo[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                tipo === t ? CORES[t] : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {NOME_TIPO[t]}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={etiqueta}>
            <span>Nota (opcional)</span>
            <select className={campo} name="nota" defaultValue="">
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}/5
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            <span>Data do aluguer (opcional)</span>
            <input className={campo} type="date" name="data_aluguer" />
          </label>
        </div>

        <label className={etiqueta}>
          <span>Comentário</span>
          <textarea
            className={`${campo} h-20`}
            name="comentario"
            placeholder="Regista factos, ex.: devolveu no prazo e sem danos."
          />
        </label>
        <p className="text-xs text-slate-500">
          Regista factos verificáveis, não juízos — protege-te legalmente.
        </p>

        {erro && <p className="text-sm text-red-700">{erro}</p>}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onEliminar}
            className="text-xs font-semibold text-red-600 transition hover:text-red-700"
          >
            Eliminar motorista
          </button>
          <button
            type="submit"
            disabled={aGravar}
            className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {aGravar ? "A gravar..." : "Adicionar avaliação"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormMotorista({
  onClose,
  onCriado,
  valoresIniciais,
}: {
  onClose: () => void;
  onCriado: (m: MotoristaComAvaliacoes) => void;
  valoresIniciais?: { nome?: string; telefone?: string };
}) {
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);
    const input = {
      nome: String(dados.get("nome") ?? ""),
      telefone: String(dados.get("telefone") ?? ""),
      email: String(dados.get("email") ?? "") || undefined,
      plataforma: String(dados.get("plataforma") ?? "") || undefined,
      notas: String(dados.get("notas") ?? "") || undefined,
    };

    const r = await criarMotorista(input);
    setAGravar(false);

    if (!r.success || !r.id) {
      setErro(r.error ?? "Erro ao criar.");
      return;
    }

    onCriado({
      id: r.id,
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      telefone_digitos: normalizarTelefone(input.telefone),
      email: input.email?.trim() || null,
      plataforma: input.plataforma?.trim() || null,
      notas: input.notas?.trim() || null,
      created_at: new Date().toISOString(),
      avaliacoes: [],
    });
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
          <h2 className="text-2xl font-semibold text-slate-950">Novo motorista</h2>
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
            <input
              className={campo}
              name="nome"
              required
              defaultValue={valoresIniciais?.nome}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>
                Telefone <span className="text-red-600">*</span>
              </span>
              <input
                className={campo}
                name="telefone"
                required
                defaultValue={valoresIniciais?.telefone}
                placeholder="+351 91 234 5678"
              />
            </label>
            <label className={etiqueta}>
              <span>Plataforma</span>
              <input className={campo} name="plataforma" placeholder="Uber, Bolt..." />
            </label>
          </div>
          <label className={etiqueta}>
            <span>Email (opcional)</span>
            <input className={campo} type="email" name="email" />
          </label>
          <label className={etiqueta}>
            <span>Notas gerais (opcional)</span>
            <textarea className={`${campo} h-20`} name="notas" />
          </label>

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
              {aGravar ? "A criar..." : "Criar motorista"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
