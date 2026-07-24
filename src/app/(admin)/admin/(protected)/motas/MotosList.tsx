"use client";

import { useEffect, useMemo, useState } from "react";
import type { Moto, MotoEstado, Proprietario } from "@/types/db";
import { updateMoto, deleteMoto } from "@/actions/motoActions";
import { historicoAtivo, type HistoricoAtivo } from "@/actions/ativoActions";
import { precosDisponiveis, formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import pt from "@/dictionaries/pt.json";
import MotoForm from "./MotoForm";

interface MotosListProps {
  initialMotas: Moto[];
  proprietarios: Proprietario[];
}

type Modal = { tipo: "criar" } | { tipo: "editar"; moto: Moto } | null;

export default function MotosList({ initialMotas, proprietarios }: MotosListProps) {
  const [motas, setMotas] = useState(initialMotas);
  const [modal, setModal] = useState<Modal>(null);
  const [pnl, setPnl] = useState<Moto | null>(null);
  const [aEliminar, setAEliminar] = useState<string | null>(null);
  const [filtroDono, setFiltroDono] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  const nomeDono = useMemo(
    () => new Map(proprietarios.map((p) => [p.id, p.nome])),
    [proprietarios],
  );

  const filtradas = motas.filter(
    (m) =>
      (!filtroDono || m.proprietario_id === filtroDono) &&
      (!filtroTipo || m.tipo_veiculo === filtroTipo),
  );

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
    // Publicar no catálogo exige pelo menos um preço (constraint na BD). Avisar
    // aqui, com clareza, em vez de deixar o erro genérico da constraint aparecer
    // — os veículos importados da frota vêm muitas vezes sem preço.
    if (novoAtivo) {
      const m = motas.find((x) => x.id === motoId);
      const temPreco = m && (m.preco_dia || m.preco_semana || m.preco_mes);
      if (!temPreco) {
        alert("Define um preço (diário, semanal ou mensal) antes de publicar no catálogo.");
        return;
      }
    }
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
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-600">
            {filtradas.length}{" "}
            {filtradas.length === 1 ? "veículo" : "veículos"}
          </p>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroDono}
            onChange={(e) => setFiltroDono(e.target.value)}
          >
            <option value="">Todos os donos</option>
            {proprietarios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
          >
            <option value="">Motos e carros</option>
            <option value="moto">Só motos</option>
            <option value="carro">Só carros</option>
          </select>
        </div>
        <button
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          onClick={() => setModal({ tipo: "criar" })}
        >
          + Novo veículo
        </button>
      </div>

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Veículo</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Proprietário</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Preços</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Estado</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Disponível em</th>
                <th className="px-6 py-4 text-left font-semibold text-slate-950">Ativo</th>
                <th className="px-6 py-4 text-right font-semibold text-slate-950">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtradas.map((moto) => (
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
                            {moto.tipo_veiculo === "carro" ? "carro" : "sem foto"}
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
                  <td className="px-6 py-4">
                    <p className="text-sm text-slate-700">
                      {moto.proprietario_id
                        ? nomeDono.get(moto.proprietario_id) ?? "—"
                        : "—"}
                    </p>
                    {moto.comissao_valor_override != null && (
                      <p className="text-xs text-amber-600">
                        {moto.comissao_valor_override}% (específica)
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      {precosDisponiveis(moto, pt.periodos).map((preco) => (
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
                        className="text-xs font-semibold text-slate-600 transition hover:text-slate-900"
                        onClick={() => setPnl(moto)}
                      >
                        P&L
                      </button>
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
          proprietarios={proprietarios}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {pnl && <ModalPnL moto={pnl} onClose={() => setPnl(null)} />}
    </div>
  );
}

function ModalPnL({ moto, onClose }: { moto: Moto; onClose: () => void }) {
  const [dados, setDados] = useState<HistoricoAtivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    historicoAtivo(moto.id).then((r) => {
      if (!vivo) return;
      if (r.success && r.dados) setDados(r.dados);
      else setErro(r.error ?? "Erro ao calcular.");
    });
    return () => {
      vivo = false;
    };
  }, [moto.id]);

  const eur = (n: number | null) => (n == null ? "—" : formatarPreco(n));

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
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Histórico do ativo</h2>
            <p className="text-sm text-slate-600">
              {moto.matricula ?? "?"} · {moto.modelo}
            </p>
          </div>
          <button
            className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 transition hover:bg-slate-100"
            onClick={onClose}
            type="button"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {erro && <p className="mt-6 text-sm text-red-700">{erro}</p>}
        {!dados && !erro && <p className="mt-6 text-sm text-slate-500">A calcular…</p>}

        {dados && (
          <div className="mt-6 space-y-4">
            <p className="text-xs text-slate-500">
              Desde a aquisição
              {dados.data_aquisicao ? ` (${dataBR(dados.data_aquisicao)})` : ""}
              {dados.valor_aquisicao != null ? ` · valor ${eur(dados.valor_aquisicao)}` : ""}.
              Regime de caixa (renda cobrada).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Kpi rotulo="Receita acumulada" valor={eur(dados.receita)} cor="text-slate-950" />
              <Kpi rotulo="Custos" valor={eur(dados.custo)} cor="text-red-600" />
              <Kpi
                rotulo="Resultado"
                valor={eur(dados.resultado)}
                cor={dados.resultado >= 0 ? "text-emerald-700" : "text-red-600"}
              />
              <Kpi
                rotulo="ROI"
                valor={dados.roi == null ? "—" : `${dados.roi}%`}
                cor="text-slate-950"
              />
              <Kpi
                rotulo="Custo / km"
                valor={dados.custo_km == null ? "—" : eur(dados.custo_km)}
                cor="text-slate-700"
              />
              <Kpi
                rotulo="km percorridos"
                valor={dados.km_percorridos == null ? "—" : dados.km_percorridos.toLocaleString("pt-PT")}
                cor="text-slate-700"
              />
            </div>
            {dados.valor_aquisicao != null && (
              <p
                className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                  dados.recuperado
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {dados.recuperado
                  ? "✓ O ativo já cobriu o valor de aquisição."
                  : `Ainda por recuperar ${eur(Math.round((dados.valor_aquisicao - dados.resultado) * 100) / 100)} do valor de aquisição.`}
              </p>
            )}
            <p className="text-xs text-slate-400">
              {dados.n_rendas_pagas} renda(s) paga(s) · {dados.n_despesas} despesa(s).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-lg font-bold ${cor}`}>{valor}</p>
    </div>
  );
}
