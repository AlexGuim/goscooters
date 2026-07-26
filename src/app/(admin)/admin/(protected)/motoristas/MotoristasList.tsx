"use client";

import { useMemo, useRef, useState } from "react";
import type { Avaliacao, AvaliacaoTipo, DocIdTipo, Motorista } from "@/types/db";
import { normalizarTelefone } from "@/lib/telefone";
import { IDIOMAS } from "@/lib/lembretes";
import { ocrFicheiro } from "@/lib/ocr";
import { interpretarDocumento, iso3ParaIso2 } from "@/lib/documentos";
import { kycCompleto } from "@/lib/kyc";
import {
  criarMotorista,
  atualizarMotorista,
  eliminarMotorista,
  criarAvaliacao,
  eliminarAvaliacao,
  type MotoristaEditavel,
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
  const [soRevisao, setSoRevisao] = useState(false);
  const [aCriar, setACriar] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);

  const numRevisao = motoristas.filter((m) => m.precisa_revisao).length;

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    const digitos = termo ? normalizarTelefone(termo) : "";
    // O filtro de revisão só se aplica se ainda houver registos por rever —
    // assim, ao limpar o último, a lista não fica presa vazia.
    const revisaoAtiva = soRevisao && numRevisao > 0;
    return motoristas.filter((m) => {
      if (revisaoAtiva && !m.precisa_revisao) return false;
      if (!termo) return true;
      return (
        m.nome.toLowerCase().includes(termo) ||
        (digitos && m.telefone_digitos.includes(digitos))
      );
    });
  }, [motoristas, procura, soRevisao, numRevisao]);

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

  const atualizarCampos = (id: string, campos: Partial<MotoristaComAvaliacoes>) =>
    setMotoristas((atuais) =>
      atuais.map((m) => (m.id === id ? { ...m, ...campos } : m)),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${campo} max-w-xs`}
            placeholder="Procurar por nome ou telefone..."
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
          />
          {numRevisao > 0 && (
            <button
              onClick={() => setSoRevisao((v) => !v)}
              className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                soRevisao
                  ? "bg-amber-500 text-white"
                  : "bg-amber-100 text-amber-800 hover:bg-amber-200"
              }`}
            >
              ⚠ {numRevisao} por rever
            </button>
          )}
        </div>
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
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{m.nome}</p>
                      {m.pais_iso && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {m.pais_iso}
                        </span>
                      )}
                      {m.estado === "bloqueado" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                          bloqueado
                        </span>
                      )}
                      {m.precisa_revisao && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                          ⚠ rever
                        </span>
                      )}
                    </div>
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
                    onAtualizado={(campos) => atualizarCampos(m.id, campos)}
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
  onAtualizado,
  onEliminar,
}: {
  motorista: MotoristaComAvaliacoes;
  onAvaliacoes: (avs: Avaliacao[]) => void;
  onAtualizado: (campos: Partial<MotoristaComAvaliacoes>) => void;
  onEliminar: () => void;
}) {
  const [tipo, setTipo] = useState<AvaliacaoTipo>("positiva");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Capturar o form ANTES do await: e.currentTarget fica null depois.
    const form = e.currentTarget;
    const dados = new FormData(form);
    const notaBruta = dados.get("nota");
    setErro(null);
    setAGravar(true);

    try {
      const r = await criarAvaliacao({
        motoristaId: motorista.id,
        tipo,
        nota: notaBruta ? Number(notaBruta) : null,
        comentario: String(dados.get("comentario") ?? ""),
        dataAluguer: String(dados.get("data_aluguer") ?? "") || undefined,
      });

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
      form.reset();
      setTipo("positiva");
    } catch (err) {
      // Se a Server Action rebentar, nunca deixar a UI presa em "a gravar".
      console.error("Erro ao gravar avaliação:", err);
      setErro("Erro inesperado. Tenta novamente.");
    } finally {
      setAGravar(false);
    }
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
      <FichaKYC motorista={motorista} onAtualizado={onAtualizado} />

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

const DOC_TIPOS: { valor: DocIdTipo; rotulo: string }[] = [
  { valor: "cc", rotulo: "Cartão de cidadão" },
  { valor: "passaporte", rotulo: "Passaporte" },
  { valor: "titulo_residencia", rotulo: "Título de residência" },
  { valor: "aima", rotulo: "Documento AIMA" },
];
const docTipoRotulo = (t: DocIdTipo | null) => DOC_TIPOS.find((d) => d.valor === t)?.rotulo ?? "";

const ESTADOS_MOTORISTA: { valor: MotoristaComAvaliacoes["estado"]; rotulo: string }[] = [
  { valor: "lead", rotulo: "Lead" },
  { valor: "ativo", rotulo: "Ativo" },
  { valor: "inativo", rotulo: "Inativo" },
  { valor: "bloqueado", rotulo: "Bloqueado" },
];

function FichaKYC({
  motorista,
  onAtualizado,
}: {
  motorista: MotoristaComAvaliacoes;
  onAtualizado: (campos: Partial<MotoristaComAvaliacoes>) => void;
}) {
  const [aEditar, setAEditar] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    setErro(null);
    setAGravar(true);

    const telefoneNovo = String(dados.get("telefone") ?? "").trim();
    const campos: MotoristaEditavel = {
      nome: String(dados.get("nome") ?? "").trim(),
      email: String(dados.get("email") ?? "").trim() || null,
      plataforma: String(dados.get("plataforma") ?? "").trim() || null,
      nif: String(dados.get("nif") ?? "").trim() || null,
      pais_iso: String(dados.get("pais_iso") ?? "").trim().toUpperCase() || null,
      morada_linha1: String(dados.get("morada_linha1") ?? "").trim() || null,
      codigo_postal: String(dados.get("codigo_postal") ?? "").trim() || null,
      localidade: String(dados.get("localidade") ?? "").trim() || null,
      estado: String(dados.get("estado") ?? "lead") as MotoristaComAvaliacoes["estado"],
      idioma_preferido: String(dados.get("idioma_preferido") ?? "pt").trim() || "pt",
      iban: String(dados.get("iban") ?? "").trim() || null,
      // Guardar a ficha resolve a razão da revisão.
      precisa_revisao: false,
    };
    // Carta: só enviar quando preenchida (colunas da fase4c; assim a ficha não
    // parte se a SQL ainda não correu).
    const cn = String(dados.get("carta_numero") ?? "").trim();
    const cc = String(dados.get("carta_categoria") ?? "").trim().toUpperCase();
    const cp = String(dados.get("carta_pais") ?? "").trim().toUpperCase();
    const cv = String(dados.get("carta_validade") ?? "").trim();
    if (cn) campos.carta_numero = cn;
    if (cc) campos.carta_categoria = cc;
    if (cp) campos.carta_pais = cp;
    if (cv) campos.carta_validade = cv;
    // Documento de identidade (idem — colunas de fase1).
    const dt = String(dados.get("doc_id_tipo") ?? "").trim();
    const dn = String(dados.get("doc_id_numero") ?? "").trim();
    const dv = String(dados.get("doc_id_validade") ?? "").trim();
    campos.doc_id_tipo = (dt || null) as DocIdTipo | null;
    campos.doc_id_numero = dn || null;
    campos.doc_id_validade = dv || null;
    // Só envia o telefone se mudou — evita recalcular (e corromper) o E.164 de
    // um número estrangeiro que já estava correcto.
    if (telefoneNovo !== (motorista.telefone ?? "")) {
      campos.telefone = telefoneNovo;
    }

    try {
      const r = await atualizarMotorista(motorista.id, campos);
      if (!r.success) {
        setErro(r.error ?? "Erro ao gravar.");
        return;
      }
      // Funde os derivados recalculados pelo servidor (E.164, nif_valido).
      onAtualizado({ ...campos, ...(r.derivados ?? {}) } as Partial<MotoristaComAvaliacoes>);
      setAEditar(false);
    } catch (err) {
      console.error("Erro ao gravar ficha:", err);
      setErro("Erro inesperado. Tenta novamente.");
    } finally {
      setAGravar(false);
    }
  };

  if (!aEditar) {
    const linhas: [string, string | null][] = [
      ["Telefone (E.164)", motorista.telefone_e164],
      ["País", motorista.pais_iso],
      ["NIF", motorista.nif ? `${motorista.nif}${motorista.nif_valido === false ? " (inválido)" : ""}` : null],
      ["Documento", motorista.doc_id_numero ? `${docTipoRotulo(motorista.doc_id_tipo)} ${motorista.doc_id_numero}${motorista.doc_id_validade ? ` · val. ${motorista.doc_id_validade}` : ""}`.trim() : null],
      ["Estado", motorista.estado],
      ["Morada", [motorista.morada_linha1, motorista.codigo_postal, motorista.localidade].filter(Boolean).join(", ") || null],
      ["Carta", motorista.carta_numero ? `${motorista.carta_numero}${motorista.carta_categoria ? ` · ${motorista.carta_categoria}` : ""}${motorista.carta_pais ? ` · ${motorista.carta_pais}` : ""}${motorista.carta_validade ? ` · val. ${motorista.carta_validade}` : ""}` : null],
      ["Idioma", IDIOMAS.find((i) => i.valor === motorista.idioma_preferido)?.rotulo ?? motorista.idioma_preferido],
      ["IBAN", motorista.iban],
    ];
    const kyc = kycCompleto(motorista);
    return (
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Ficha
          </h3>
          <button
            onClick={() => setAEditar(true)}
            className="text-xs font-semibold text-emerald-600 transition hover:text-emerald-700"
          >
            Editar ficha
          </button>
        </div>
        {kyc.completo ? (
          <p className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            ✓ KYC completo
          </p>
        ) : (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            KYC incompleto — falta: {kyc.faltam.join(", ")}
          </p>
        )}
        {motorista.precisa_revisao && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Este registo veio da importação e precisa de ser confirmado. Ao guardar
            a ficha, a marca de revisão é removida.
          </p>
        )}
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {linhas.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex justify-between gap-3 text-sm">
              <span className="text-slate-500">{rotulo}</span>
              <span className="text-right text-slate-900">{valor || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Editar ficha
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={etiqueta}>
          <span>Nome</span>
          <input className={campo} name="nome" defaultValue={motorista.nome} required />
        </label>
        <label className={etiqueta}>
          <span>Telefone</span>
          <input className={campo} name="telefone" defaultValue={motorista.telefone} />
        </label>
        <label className={etiqueta}>
          <span>Email</span>
          <input className={campo} type="email" name="email" defaultValue={motorista.email ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>Plataforma</span>
          <input className={campo} name="plataforma" defaultValue={motorista.plataforma ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>NIF</span>
          <input className={campo} name="nif" defaultValue={motorista.nif ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>País (código ISO, ex. PT)</span>
          <input className={campo} name="pais_iso" maxLength={2} defaultValue={motorista.pais_iso ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>Estado</span>
          <select className={campo} name="estado" defaultValue={motorista.estado}>
            {ESTADOS_MOTORISTA.map((e) => (
              <option key={e.valor} value={e.valor}>{e.rotulo}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>Idioma (para lembretes)</span>
          <select className={campo} name="idioma_preferido" defaultValue={motorista.idioma_preferido || "pt"}>
            {IDIOMAS.map((i) => (
              <option key={i.valor} value={i.valor}>{i.rotulo}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>IBAN</span>
          <input className={campo} name="iban" defaultValue={motorista.iban ?? ""} />
        </label>
      </div>
      <label className={etiqueta}>
        <span>Morada</span>
        <input className={campo} name="morada_linha1" defaultValue={motorista.morada_linha1 ?? ""} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={etiqueta}>
          <span>Código postal</span>
          <input className={campo} name="codigo_postal" defaultValue={motorista.codigo_postal ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>Localidade</span>
          <input className={campo} name="localidade" defaultValue={motorista.localidade ?? ""} />
        </label>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Documento de identidade</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={etiqueta}>
          <span>Tipo</span>
          <select className={campo} name="doc_id_tipo" defaultValue={motorista.doc_id_tipo ?? ""}>
            <option value="">—</option>
            {DOC_TIPOS.map((d) => (
              <option key={d.valor} value={d.valor}>{d.rotulo}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>Nº do documento</span>
          <input className={campo} name="doc_id_numero" defaultValue={motorista.doc_id_numero ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>Validade</span>
          <input className={campo} type="date" name="doc_id_validade" defaultValue={motorista.doc_id_validade ?? ""} />
        </label>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Carta de condução</p>
      <div className="grid gap-4 sm:grid-cols-4">
        <label className={etiqueta}>
          <span>Nº da carta</span>
          <input className={campo} name="carta_numero" defaultValue={motorista.carta_numero ?? ""} />
        </label>
        <label className={etiqueta}>
          <span>Categoria</span>
          <input className={campo} name="carta_categoria" defaultValue={motorista.carta_categoria ?? ""} placeholder="A1, A, B" />
        </label>
        <label className={etiqueta}>
          <span>País</span>
          <input className={campo} name="carta_pais" maxLength={2} defaultValue={motorista.carta_pais ?? ""} placeholder="PT" />
        </label>
        <label className={etiqueta}>
          <span>Validade</span>
          <input className={campo} type="date" name="carta_validade" defaultValue={motorista.carta_validade ?? ""} />
        </label>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setAEditar(false)}
          className="flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={aGravar}
          className="flex-1 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {aGravar ? "A gravar..." : "Guardar ficha"}
        </button>
      </div>
    </form>
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
  const formRef = useRef<HTMLFormElement>(null);
  // Campos preenchidos pela ÚLTIMA leitura de documento (proveniência): só estes
  // são limpos antes de uma nova leitura, para não apagar o que foi digitado à mão.
  const autoRef = useRef<Set<string>>(new Set());
  const [aLerDoc, setALerDoc] = useState(false);
  const [statusOcr, setStatusOcr] = useState<string | null>(null);

  // Lê a foto/PDF do documento, corre o OCR (MRZ) e pré-preenche o formulário.
  // Nunca grava — o admin confirma sempre antes de criar. O NIF não vem na MRZ.
  const lerDocumento = async (file: File | undefined) => {
    if (!file) return;
    const form = formRef.current;
    if (!form) return;
    setALerDoc(true);
    setStatusOcr("A ler o documento…");
    // Limpa APENAS os campos que a leitura ANTERIOR preencheu — senão uma leitura
    // errada/falhada deixa colados os dados do documento anterior (contamina a
    // pessoa errada). Os campos digitados à mão nunca entram aqui, por isso não
    // se perdem. O NIF é sempre manual (não vem do OCR).
    for (const name of autoRef.current) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = "";
    }
    autoRef.current.clear();
    try {
      const texto = await ocrFicheiro(file, (fase, pct) => setStatusOcr(`${fase} ${pct}%`));
      const d = interpretarDocumento(texto);
      const set = (name: string, valor: string | null | undefined) => {
        if (!valor) return false;
        const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        if (!el) return false;
        el.value = valor;
        autoRef.current.add(name); // marca como preenchido por OCR (limpo na próxima leitura)
        return true;
      };
      const preenchidos: string[] = [];
      if (set("nome", d.nome)) preenchidos.push("nome");
      if (set("data_nascimento", d.nascimento)) preenchidos.push("nascimento");
      if (set("doc_id_numero", d.numero)) preenchidos.push("nº do documento");
      if (set("doc_id_validade", d.validade)) preenchidos.push("validade");
      if (set("doc_id_tipo", d.tipo)) preenchidos.push("tipo");
      if (set("pais_iso", iso3ParaIso2(d.nacionalidade))) preenchidos.push("país");
      setStatusOcr(
        preenchidos.length
          ? `Preenchido: ${preenchidos.join(", ")}. Confirma tudo — o NIF não vem do documento.`
          : "Não consegui ler a zona MRZ. Tenta uma foto mais nítida ou preenche à mão.",
      );
    } catch (err) {
      console.error("OCR do documento falhou:", err);
      setStatusOcr("Erro ao ler o documento. Preenche à mão.");
    } finally {
      setALerDoc(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro(null);
    setAGravar(true);

    const input = {
      nome: String(dados.get("nome") ?? ""),
      telefone: String(dados.get("telefone") ?? ""),
      email: String(dados.get("email") ?? "") || undefined,
      plataforma: String(dados.get("plataforma") ?? "") || undefined,
      notas: String(dados.get("notas") ?? "") || undefined,
      nif: String(dados.get("nif") ?? "").trim() || null,
      pais_iso: String(dados.get("pais_iso") ?? "").trim().toUpperCase() || null,
      morada_linha1: String(dados.get("morada_linha1") ?? "").trim() || null,
      codigo_postal: String(dados.get("codigo_postal") ?? "").trim() || null,
      localidade: String(dados.get("localidade") ?? "").trim() || null,
      data_nascimento: String(dados.get("data_nascimento") ?? "").trim() || null,
      doc_id_tipo: (String(dados.get("doc_id_tipo") ?? "").trim() || null) as DocIdTipo | null,
      doc_id_numero: String(dados.get("doc_id_numero") ?? "").trim() || null,
      doc_id_validade: String(dados.get("doc_id_validade") ?? "").trim() || null,
    };

    let r: { success: boolean; id?: string; error?: string };
    try {
      r = await criarMotorista(input);
    } catch (err) {
      console.error("Erro ao criar motorista:", err);
      setErro("Erro inesperado. Tenta novamente.");
      setAGravar(false);
      return;
    }
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
      telefone_e164: null,
      telefones_extra: null,
      nif: input.nif,
      // O servidor recalcula nif_valido; otimista fica null (sem marca).
      nif_valido: null,
      pais_iso: input.pais_iso,
      data_nascimento: input.data_nascimento,
      doc_id_tipo: input.doc_id_tipo,
      doc_id_numero: input.doc_id_numero,
      doc_id_validade: input.doc_id_validade,
      doc_urls: null,
      carta_numero: null,
      carta_categoria: null,
      carta_pais: null,
      carta_validade: null,
      morada_linha1: input.morada_linha1,
      codigo_postal: input.codigo_postal,
      localidade: input.localidade,
      estado: "lead",
      origem: "site",
      idioma_preferido: "pt",
      iban: null,
      telefone_mbway: null,
      precisa_revisao: false,
      import_notion_id: null,
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

        <form ref={formRef} onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* OCR do documento — pré-preenche os campos (best-effort, sempre confirmar) */}
          <div className="space-y-2 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                disabled={aLerDoc}
                onChange={(e) => lerDocumento(e.target.files?.[0])}
              />
              {aLerDoc ? "A ler…" : "📷 Ler documento (CC / passaporte)"}
            </label>
            {statusOcr && <p className="text-xs text-slate-600">{statusOcr}</p>}
          </div>

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

          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Identificação</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>NIF</span>
              <input className={campo} name="nif" inputMode="numeric" placeholder="9 dígitos" />
            </label>
            <label className={etiqueta}>
              <span>Data de nascimento</span>
              <input className={campo} type="date" name="data_nascimento" />
            </label>
            <label className={etiqueta}>
              <span>Tipo de documento</span>
              <select className={campo} name="doc_id_tipo" defaultValue="">
                <option value="">—</option>
                <option value="cc">Cartão de cidadão</option>
                <option value="passaporte">Passaporte</option>
                <option value="titulo_residencia">Título de residência</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Nº do documento</span>
              <input className={campo} name="doc_id_numero" />
            </label>
            <label className={etiqueta}>
              <span>Validade do documento</span>
              <input className={campo} type="date" name="doc_id_validade" />
            </label>
            <label className={etiqueta}>
              <span>País (ISO, ex. PT)</span>
              <input className={campo} name="pais_iso" maxLength={2} placeholder="PT" />
            </label>
          </div>

          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Morada</p>
          <label className={etiqueta}>
            <span>Morada</span>
            <input className={campo} name="morada_linha1" placeholder="Rua, nº, andar" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Código postal</span>
              <input className={campo} name="codigo_postal" placeholder="0000-000" />
            </label>
            <label className={etiqueta}>
              <span>Localidade</span>
              <input className={campo} name="localidade" />
            </label>
          </div>

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
