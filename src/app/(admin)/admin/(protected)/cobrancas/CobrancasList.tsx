"use client";

import { useCallback, useMemo, useState } from "react";
import type { EstadoLiquidacao, PagamentoMetodo } from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import { registarPagamento, type AlocacaoInput } from "@/actions/pagamentoActions";

export interface CobrancaPainel {
  id: string;
  numero: string;
  contrato_id: string;
  motorista_id: string;
  motorista_nome: string;
  motorista_telefone: string | null;
  motorista_e164: string | null;
  veiculo_matricula: string;
  periodo_inicio: string;
  periodo_fim: string;
  data_vencimento: string;
  valor_devido: string;
  valor_pago: string;
  em_falta: string;
  em_atraso: boolean;
  estado_liquidacao: EstadoLiquidacao;
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const hoje = () => new Date().toISOString().slice(0, 10);
const dataCurta = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

function linkWhatsapp(c: CobrancaPainel): string | null {
  const num = (c.motorista_e164 || c.motorista_telefone || "").replace(/\D/g, "");
  if (!num) return null;
  const texto = encodeURIComponent(
    `Olá ${c.motorista_nome}, lembrete de pagamento: a renda da mota ${c.veiculo_matricula} ` +
      `vence a ${dataCurta(c.data_vencimento)} — valor ${formatarPreco(c.em_falta)}. Obrigado!`,
  );
  return `https://wa.me/${num}?text=${texto}`;
}

export default function CobrancasList({ inicial }: { inicial: CobrancaPainel[] }) {
  const [cobrancas, setCobrancas] = useState(inicial);
  const [filtro, setFiltro] = useState<"atraso" | "vencer" | "todas">("atraso");
  const [pagar, setPagar] = useState<CobrancaPainel | null>(null);
  // Captura o "agora" uma vez (montagem) para o cálculo ser puro no render.
  const [agora] = useState(() => Date.now());

  const em7dias = useCallback(
    (d: string) => {
      const diff = (new Date(d).getTime() - agora) / 86400000;
      return diff >= 0 && diff <= 7;
    },
    [agora],
  );

  const resumo = useMemo(() => {
    let atrasoV = 0, atrasoN = 0, vencerV = 0, vencerN = 0;
    for (const c of cobrancas) {
      const falta = Number(c.em_falta);
      if (c.em_atraso) { atrasoV += falta; atrasoN++; }
      else if (em7dias(c.data_vencimento)) { vencerV += falta; vencerN++; }
    }
    return { atrasoV, atrasoN, vencerV, vencerN };
  }, [cobrancas, em7dias]);

  const filtradas = cobrancas.filter((c) => {
    if (filtro === "atraso") return c.em_atraso;
    if (filtro === "vencer") return !c.em_atraso && em7dias(c.data_vencimento);
    return true;
  });

  // Remove da lista (ou atualiza) as cobranças que ficaram liquidadas após pagar.
  const aposPagamento = (idsLiquidados: Set<string>, parciais: Map<string, number>) => {
    setCobrancas((atuais) =>
      atuais
        .filter((c) => !idsLiquidados.has(c.id))
        .map((c) =>
          parciais.has(c.id)
            ? { ...c, valor_pago: String(parciais.get(c.id)), em_falta: String(Number(c.valor_devido) - (parciais.get(c.id) ?? 0)), estado_liquidacao: "parcial" }
            : c,
        ),
    );
  };

  return (
    <div className="space-y-6">
      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Em atraso</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{formatarPreco(resumo.atrasoV)}</p>
          <p className="text-xs text-slate-500">{resumo.atrasoN} cobrança(s)</p>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">A vencer (7 dias)</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{formatarPreco(resumo.vencerV)}</p>
          <p className="text-xs text-slate-500">{resumo.vencerN} cobrança(s)</p>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total por liquidar</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{cobrancas.length}</p>
          <p className="text-xs text-slate-500">cobranças abertas</p>
        </div>
      </div>

      <div className="flex gap-2">
        {([["atraso", "Em atraso"], ["vencer", "A vencer"], ["todas", "Todas as abertas"]] as const).map(
          ([v, r]) => (
            <button
              key={v}
              onClick={() => setFiltro(v)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                filtro === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {r}
            </button>
          ),
        )}
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">
            {filtro === "atraso" ? "Ninguém em atraso 🎉" : "Nada a mostrar neste filtro."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {filtradas.map((c) => {
              const wa = linkWhatsapp(c);
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{c.motorista_nome}</p>
                      {c.em_atraso ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          em atraso
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                          vence {dataCurta(c.data_vencimento)}
                        </span>
                      )}
                      {c.estado_liquidacao === "parcial" && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          parcial
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">
                      {c.veiculo_matricula} · semana {dataCurta(c.periodo_inicio)}–{dataCurta(c.periodo_fim)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold text-slate-950">{formatarPreco(c.em_falta)}</span>
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                      >
                        Lembrete WhatsApp
                      </a>
                    )}
                    <button
                      onClick={() => setPagar(c)}
                      className="rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Registar pagamento
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pagar && (
        <FormPagamento
          cobrancaClicada={pagar}
          cobrancasDoMotorista={cobrancas
            .filter((c) => c.motorista_id === pagar.motorista_id)
            .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))}
          onClose={() => setPagar(null)}
          onPago={aposPagamento}
        />
      )}
    </div>
  );
}

function FormPagamento({
  cobrancaClicada,
  cobrancasDoMotorista,
  onClose,
  onPago,
}: {
  cobrancaClicada: CobrancaPainel;
  cobrancasDoMotorista: CobrancaPainel[];
  onClose: () => void;
  onPago: (liquidados: Set<string>, parciais: Map<string, number>) => void;
}) {
  const [valor, setValor] = useState<string>(cobrancaClicada.em_falta);
  const [metodo, setMetodo] = useState<PagamentoMetodo>("transferencia");
  const [data, setData] = useState(() => hoje());
  const [referencia, setReferencia] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Aloca o valor às cobranças mais antigas primeiro (FIFO).
  const alocacao = useMemo(() => {
    let resto = Number(valor) || 0;
    const linhas: { c: CobrancaPainel; aloc: number }[] = [];
    for (const c of cobrancasDoMotorista) {
      if (resto <= 0) break;
      const falta = Number(c.em_falta);
      const aloc = Math.min(resto, falta);
      if (aloc > 0) {
        linhas.push({ c, aloc: Math.round(aloc * 100) / 100 });
        resto -= aloc;
      }
    }
    return { linhas, sobra: Math.round(resto * 100) / 100 };
  }, [valor, cobrancasDoMotorista]);

  const handleSubmit = async () => {
    setErro(null);
    setAGravar(true);
    const alocacoes: AlocacaoInput[] = alocacao.linhas.map((l) => ({
      cobranca_id: l.c.id,
      valor_alocado: l.aloc,
    }));
    try {
      const r = await registarPagamento({
        motorista_id: cobrancaClicada.motorista_id,
        valor: Number(valor),
        data_recebimento: data,
        metodo,
        referencia,
        alocacoes,
      });
      if (!r.success) {
        setErro(r.error ?? "Erro ao gravar.");
        return;
      }
      // Atualiza a lista: liquidadas (aloc cobre o em_falta) saem; parciais ficam.
      const liquidados = new Set<string>();
      const parciais = new Map<string, number>();
      for (const l of alocacao.linhas) {
        if (l.aloc >= Number(l.c.em_falta) - 0.001) liquidados.add(l.c.id);
        else parciais.set(l.c.id, Number(l.c.valor_pago) + l.aloc);
      }
      onPago(liquidados, parciais);
      onClose();
    } catch (err) {
      console.error(err);
      setErro("Erro inesperado. Tenta novamente.");
    } finally {
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
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Registar pagamento</h2>
            <p className="text-sm text-slate-600">{cobrancaClicada.motorista_nome}</p>
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

        <div className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Valor recebido (€)</span>
              <input
                className={campo}
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </label>
            <label className={etiqueta}>
              <span>Data</span>
              <input className={campo} type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Método</span>
              <select className={campo} value={metodo} onChange={(e) => setMetodo(e.target.value as PagamentoMetodo)}>
                <option value="transferencia">Transferência</option>
                <option value="mbway">MB Way</option>
                <option value="numerario">Numerário</option>
                <option value="multibanco">Multibanco</option>
                <option value="outro">Outro</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Referência (opcional)</span>
              <input className={campo} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </label>
          </div>

          {/* Pré-visualização da alocação */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Cobre estas semanas
            </p>
            {alocacao.linhas.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Sem semanas em dívida para alocar.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {alocacao.linhas.map((l) => (
                  <li key={l.c.id} className="flex justify-between text-sm">
                    <span className="text-slate-700">
                      {dataCurta(l.c.periodo_inicio)}–{dataCurta(l.c.periodo_fim)}
                    </span>
                    <span className="font-medium text-slate-950">
                      {formatarPreco(l.aloc)}
                      {l.aloc < Number(l.c.em_falta) - 0.001 ? " (parcial)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {alocacao.sobra > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                Sobram {formatarPreco(alocacao.sobra)} sem semana para alocar (fica como
                crédito não alocado).
              </p>
            )}
          </div>

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
              type="button"
              onClick={handleSubmit}
              disabled={aGravar || !(Number(valor) > 0)}
              className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {aGravar ? "A gravar..." : "Registar pagamento"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
