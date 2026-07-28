"use client";

import { useState, type ReactNode } from "react";
import type { Acerto, AcertoEstado, AcertoLinha, Proprietario } from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import {
  calcularAcerto,
  fecharAcerto,
  marcarAcertoPago,
  type AcertoPreview,
} from "@/actions/acertoActions";

export interface AcertoComLinhas extends Acerto {
  proprietario_nome: string;
  linhas: (AcertoLinha & { documento_url?: string | null })[];
}

const ESTADO_COR: Record<AcertoEstado, string> = {
  rascunho: "bg-slate-100 text-slate-600",
  fechado: "bg-amber-100 text-amber-800",
  pago: "bg-emerald-100 text-emerald-700",
  parcial: "bg-blue-100 text-blue-700",
};

const mesAnterior = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Semanas de renda que "pertencem" ao mês. Regra do parceiro: uma semana que
// atravessa dois meses pertence ao mês com mais dias — e numa semana de 7 dias
// isso é sempre o mês do 4.º dia (início + 3). Como a data de vencimento é o
// início da semana, a janela de vencimentos é [1.º dia − 3, último dia − 3].
// Ex.: julho → 28/06 a 28/07 (inclui a semana 28/06–04/07, exclui a de 30/07).
const limitesDoMes = (competencia: string) => {
  const [ano, mes] = competencia.split("-").map(Number);
  const de = new Date(Date.UTC(ano, mes - 1, 1));
  const ate = new Date(Date.UTC(ano, mes, 0));
  de.setUTCDate(de.getUTCDate() - 3);
  ate.setUTCDate(ate.getUTCDate() - 3);
  return { inicio: iso(de), fim: iso(ate) };
};

const nomeMes = (competencia: string) => {
  const [ano, mes] = competencia.slice(0, 7).split("-");
  const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(mes)]} ${ano}`;
};

export default function AcertosList({
  inicial,
  proprietarios,
}: {
  inicial: AcertoComLinhas[];
  proprietarios: Pick<Proprietario, "id" | "nome" | "comissao_valor">[];
}) {
  const [acertos, setAcertos] = useState(inicial);
  const [donoId, setDonoId] = useState(proprietarios[0]?.id ?? "");
  const [mes, setMes] = useState(() => mesAnterior());
  const [de, setDe] = useState(() => limitesDoMes(mesAnterior()).inicio);
  const [ate, setAte] = useState(() => limitesDoMes(mesAnterior()).fim);
  const [preview, setPreview] = useState<AcertoPreview | null>(null);

  // Ao trocar o mês, repõe o período para os limites desse mês.
  const trocarMes = (novo: string) => {
    setMes(novo);
    if (novo) {
      const l = limitesDoMes(novo);
      setDe(l.inicio);
      setAte(l.fim);
    }
    setPreview(null);
  };
  const [aCalcular, setACalcular] = useState(false);
  const [aFechar, setAFechar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  const handleCalcular = async () => {
    setErro(null);
    setPreview(null);
    setACalcular(true);
    const r = await calcularAcerto(donoId, mes, de, ate);
    setACalcular(false);
    if (!r.success || !r.preview) {
      setErro(r.error ?? "Erro ao calcular.");
      return;
    }
    setPreview(r.preview);
  };

  const handleFechar = async () => {
    if (!preview) return;
    if (!window.confirm(`Fechar o acerto de ${preview.proprietario_nome} para ${nomeMes(mes)}? Fica congelado.`))
      return;
    setAFechar(true);
    const r = await fecharAcerto(donoId, mes, de, ate);
    setAFechar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao fechar.");
      return;
    }
    // Recarrega a página para trazer o acerto fechado com as linhas.
    window.location.reload();
  };

  const handlePago = async (a: AcertoComLinhas) => {
    const r = await marcarAcertoPago(a.id);
    if (r.success) {
      setAcertos((atuais) => atuais.map((x) => (x.id === a.id ? { ...x, estado: "pago" } : x)));
    } else alert(r.error);
  };

  return (
    <div className="space-y-8">
      {/* Novo acerto */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Novo acerto</h2>
        <p className="mt-1 text-xs text-slate-500">
          Fórmula: receita cobrada − comissão (por veículo) − despesas do parceiro
          = líquido a transferir. Confirma os valores antes de fechar.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Parceiro</span>
            <select
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              value={donoId}
              onChange={(e) => { setDonoId(e.target.value); setPreview(null); }}
            >
              {proprietarios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}{p.comissao_valor != null ? ` (${p.comissao_valor}%)` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Mês</span>
            <input
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              type="month"
              value={mes}
              onChange={(e) => trocarMes(e.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>De</span>
            <input
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              type="date"
              value={de}
              onChange={(e) => { setDe(e.target.value); setPreview(null); }}
            />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-slate-700">
            <span>Até</span>
            <input
              className="block rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              type="date"
              value={ate}
              onChange={(e) => { setAte(e.target.value); setPreview(null); }}
            />
          </label>
          <button
            onClick={handleCalcular}
            disabled={aCalcular || !donoId}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {aCalcular ? "A calcular..." : "Calcular"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          <strong>Mês</strong> = mês contabilístico (define as despesas). <strong>De/Até</strong>{" "}
          = semanas de renda a incluir, já pré-preenchidas: uma semana que atravessa
          dois meses conta para o mês com mais dias (ex.: 28/06–04/07 entra em julho).
          Ajusta se precisares.
        </p>

        {erro && <p className="mt-3 text-sm text-red-700">{erro}</p>}

        {preview && (
          <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            {preview.pago_direto && (
              <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                O parceiro já recebeu{" "}
                <strong>{formatarPreco(preview.receita_total - preview.receita_goscooters)}</strong>{" "}
                diretamente. A GoScooters cobrou {formatarPreco(preview.receita_goscooters)}; depois da
                comissão e despesas,{" "}
                {preview.liquido >= 0 ? (
                  <>há <strong>{formatarPreco(preview.liquido)} a transferir ao parceiro</strong>.</>
                ) : (
                  <>o parceiro <strong>deve {formatarPreco(-preview.liquido)} à GoScooters</strong>.</>
                )}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <Tile
                rotulo={preview.pago_direto ? "Renda total (da frota)" : "Receita"}
                valor={preview.receita_total}
                cor="text-slate-950"
              />
              <Tile rotulo="Comissão" valor={-preview.comissao_total} cor="text-amber-700" />
              <Tile rotulo="Despesas" valor={-preview.despesa_total} cor="text-red-600" />
              {preview.liquido >= 0 ? (
                <Tile rotulo="Líquido a transferir" valor={preview.liquido} cor="text-emerald-700" forte />
              ) : (
                <Tile rotulo="Parceiro deve à GoScooters" valor={-preview.liquido} cor="text-red-600" forte />
              )}
            </div>

            {preview.linhas.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-semibold text-slate-700">Detalhe</summary>
                <div className="mt-3">
                  <DetalheAgrupado linhas={preview.linhas} />
                </div>
              </details>
            )}

            <button
              onClick={handleFechar}
              disabled={aFechar}
              className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {aFechar ? "A fechar..." : "Fechar acerto (congelar)"}
            </button>
          </div>
        )}
      </div>

      {/* Acertos fechados */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">Acertos fechados</h2>
        {acertos.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
            Ainda não há acertos fechados.
          </div>
        ) : (
          acertos.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <button
                className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                onClick={() => setExpandido(expandido === a.id ? null : a.id)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-950">{a.proprietario_nome}</p>
                    <span className="text-sm text-slate-500">{nomeMes(a.competencia_mes)}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_COR[a.estado]}`}>
                      {a.estado}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Receita {formatarPreco(a.receita_total)} · Comissão {formatarPreco(a.comissao_total)} · Despesas {formatarPreco(a.despesa_total)}
                    {a.pago_direto ? " · renda paga direto ao parceiro" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {Number(a.liquido) >= 0 ? "A transferir" : "Parceiro deve"}
                    </p>
                    <p className={`text-lg font-bold ${Number(a.liquido) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatarPreco(Math.abs(Number(a.liquido)))}
                    </p>
                  </div>
                  {a.estado === "fechado" && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); handlePago(a); }}
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      Marcar pago
                    </span>
                  )}
                </div>
              </button>
              {expandido === a.id && a.linhas.length > 0 && (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
                  <DetalheAgrupado
                    linhas={a.linhas.map((l) => ({
                      tipo: l.tipo,
                      descricao: l.descricao,
                      matricula: l.matricula_snapshot,
                      veiculo_id: l.veiculo_id,
                      valor: Number(l.valor),
                      documento_url: l.documento_url ?? null,
                    }))}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({ rotulo, valor, cor, forte }: { rotulo: string; valor: number; cor: string; forte?: boolean }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ${forte ? "ring-1 ring-emerald-200" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 ${forte ? "text-2xl" : "text-xl"} font-bold ${cor}`}>{formatarPreco(valor)}</p>
    </div>
  );
}

// Detalhe do acerto organizado por secções (Receita / Comissão / Despesas), com a
// receita agrupada por moto e as suas semanas — pedido do Alex. Serve o preview e o
// acerto já fechado (mesma forma de linha).
type LinhaDet = { tipo: string; descricao: string | null; matricula: string | null; veiculo_id: string | null; valor: number; documento_url?: string | null };

function DetalheAgrupado({ linhas }: { linhas: LinhaDet[] }) {
  const receita = linhas.filter((l) => l.tipo === "receita" && l.veiculo_id);
  const ajustes = linhas.filter((l) => l.tipo === "receita" && !l.veiculo_id);
  const comissao = linhas.filter((l) => l.tipo === "comissao");
  const despesa = linhas.filter((l) => l.tipo === "despesa");
  const soma = (arr: LinhaDet[]) => arr.reduce((s, l) => s + l.valor, 0);

  const porMoto = new Map<string, LinhaDet[]>();
  for (const l of receita) {
    const k = l.matricula ?? l.veiculo_id ?? "—";
    const arr = porMoto.get(k) ?? [];
    arr.push(l);
    porMoto.set(k, arr);
  }

  return (
    <div className="space-y-4 text-sm">
      {receita.length > 0 && (
        <SeccaoAcerto titulo="Receita (rendas cobradas)" total={soma(receita)}>
          {[...porMoto.entries()].map(([moto, ls]) => (
            <div key={moto} className="mt-2 first:mt-0">
              <p className="text-xs font-semibold text-slate-500">{moto}</p>
              {ls.map((l, i) => (
                <LinhaAcerto key={i} texto={l.descricao ?? ""} valor={l.valor} />
              ))}
            </div>
          ))}
        </SeccaoAcerto>
      )}
      {comissao.length > 0 && (
        <SeccaoAcerto titulo="Comissão GoScooters" total={soma(comissao)}>
          {comissao.map((l, i) => (
            <LinhaAcerto key={i} texto={`${l.matricula ? l.matricula + " · " : ""}${l.descricao ?? ""}`} valor={l.valor} />
          ))}
        </SeccaoAcerto>
      )}
      {despesa.length > 0 && (
        <SeccaoAcerto titulo="Despesas do parceiro" total={soma(despesa)}>
          {despesa.map((l, i) => (
            <LinhaAcerto
              key={i}
              texto={`${l.matricula ? l.matricula + " · " : ""}${l.descricao ?? ""}`}
              valor={l.valor}
              documentoUrl={l.documento_url}
            />
          ))}
        </SeccaoAcerto>
      )}
      {ajustes.map((l, i) => (
        <div key={i} className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-medium text-slate-700">
          <span>{l.descricao}</span>
          <span className="text-red-600">{formatarPreco(l.valor)}</span>
        </div>
      ))}
    </div>
  );
}

function SeccaoAcerto({ titulo, total, children }: { titulo: string; total: number; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</span>
        <span className="text-sm font-semibold text-slate-700">{formatarPreco(total)}</span>
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function LinhaAcerto({ texto, valor, documentoUrl }: { texto: string; valor: number; documentoUrl?: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-600">
        {texto}
        {documentoUrl && (
          <a
            href={documentoUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-2 text-xs font-medium text-emerald-700 transition hover:text-emerald-600"
          >
            documento
          </a>
        )}
      </span>
      <span className={valor < 0 ? "text-red-600" : "text-slate-900"}>{formatarPreco(valor)}</span>
    </div>
  );
}
