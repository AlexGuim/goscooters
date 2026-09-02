"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CobrancaTipo, EstadoLiquidacao, PagamentoMetodo, PagamentoRecebidoPor } from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import {
  registarPagamento,
  listarPagamentos,
  alterarRecebidoPor,
  estornarPagamento,
  type AlocacaoInput,
  type PagamentoLista,
} from "@/actions/pagamentoActions";
import {
  emitirComprovativo,
  linkComprovativo,
  anularComprovativo,
  type ComprovativoPronto,
} from "@/actions/comprovativoActions";
import {
  cobrancasDaSemana,
  marcarIncobravel,
  reverterIncobravel,
  aplicarDesconto,
} from "@/actions/cobrancaActions";
import { rotuloSemanaMes } from "@/lib/datas";
import { Botao, Badge, Modal, AcoesMenu, classesBotao, campo, etiqueta } from "@/components/ui";
import type { AcaoMenu } from "@/components/ui";
import GrupoColapsavel from "@/components/GrupoColapsavel";
import LerComprovativo from "./LerComprovativo";
import type { ComprovativoLido } from "@/actions/pagamentoActions";

export interface CobrancaPainel {
  id: string;
  numero: string;
  contrato_id: string;
  motorista_id: string;
  motorista_nome: string;
  motorista_telefone: string | null;
  motorista_e164: string | null;
  veiculo_matricula: string;
  proprietario_id: string | null;
  proprietario_nome: string;
  proprietario_recebe_direto: boolean;
  periodo_inicio: string;
  periodo_fim: string;
  data_vencimento: string;
  valor_devido: string;
  valor_pago: string;
  /** Abatido por serviço não prestado (moto avariada). Não é perda. */
  desconto: string;
  desconto_motivo: string | null;
  em_falta: string;
  em_atraso: boolean;
  estado_liquidacao: EstadoLiquidacao;
  tipo: CobrancaTipo;
}

const hoje = () => new Date().toISOString().slice(0, 10);
const dataCurta = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

const TIPO_ROTULO: Partial<Record<CobrancaTipo, string>> = {
  caucao: "caução",
  extra: "coima / extra",
};

// "Resolvida" = já não é dívida (paga ou isenta).
/** Já não é dívida a perseguir — inclui a perda, que não se cobra nem se lembra. */
const resolvida = (c: CobrancaPainel) =>
  c.estado_liquidacao === "liquidada" ||
  c.estado_liquidacao === "isenta" ||
  c.estado_liquidacao === "incobravel";

/** Dada como perda: resolvida, mas o oposto de paga. Nunca se soma às pagas. */
const ehPerda = (c: CobrancaPainel) => c.estado_liquidacao === "incobravel";

// Semana de calendário domingo→sábado, deslocada por `offset` semanas.
function limitesSemana(agoraMs: number, offset: number) {
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const h = new Date(agoraMs);
  const dom = new Date(h);
  dom.setDate(h.getDate() - h.getDay() + offset * 7); // getDay: 0=domingo
  const sab = new Date(dom);
  sab.setDate(dom.getDate() + 6);
  return { de: fmt(dom), ate: fmt(sab) };
}

function linkWhatsapp(c: CobrancaPainel): string | null {
  const num = (c.motorista_e164 || c.motorista_telefone || "").replace(/\D/g, "");
  if (!num) return null;
  const oQue = c.tipo === "renda" ? "a renda" : `um valor (${TIPO_ROTULO[c.tipo] ?? c.tipo})`;
  const texto = encodeURIComponent(
    `Olá ${c.motorista_nome}, lembrete de pagamento: ${oQue} da mota ${c.veiculo_matricula} ` +
      `vence a ${dataCurta(c.data_vencimento)} — valor ${formatarPreco(c.em_falta)}. Obrigado!`,
  );
  return `https://wa.me/${num}?text=${texto}`;
}

export default function CobrancasList({ inicial }: { inicial: CobrancaPainel[] }) {
  const [cobrancas, setCobrancas] = useState(inicial);
  const [filtro, setFiltro] = useState<"atraso" | "vencer" | "semana" | "todas">("atraso");
  const [pagar, setPagar] = useState<CobrancaPainel | null>(null);
  // Captura o "agora" uma vez (montagem) para o cálculo ser puro no render.
  const [agora] = useState(() => Date.now());
  // Vista: "dividas" (só em aberto) | "semana" (folha de conferência dom→sáb).
  const [vista, setVista] = useState<"dividas" | "semana" | "pagamentos">("dividas");
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [roster, setRoster] = useState<CobrancaPainel[]>([]);
  const [aCarregarSemana, setACarregarSemana] = useState(false);

  // Janela de datas em formato ISO local (comparação por string, imune a fuso).
  const janela = useMemo(() => {
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const h = new Date(agora);
    const mais7 = new Date(h);
    mais7.setDate(h.getDate() + 7);
    const sem = limitesSemana(agora, 0); // semana corrente domingo→sábado
    return { hoje: fmt(h), ate7: fmt(mais7), domingo: sem.de, sabado: sem.ate };
  }, [agora]);

  const em7dias = useCallback(
    (d: string) => {
      const s = d.slice(0, 10);
      return s >= janela.hoje && s <= janela.ate7;
    },
    [janela],
  );
  const estaSemana = useCallback(
    (d: string) => {
      const s = d.slice(0, 10);
      return s >= janela.domingo && s <= janela.sabado;
    },
    [janela],
  );

  const resumo = useMemo(() => {
    let atrasoV = 0, atrasoN = 0, vencerV = 0, vencerN = 0, semanaV = 0, semanaN = 0;
    for (const c of cobrancas) {
      const falta = Number(c.em_falta);
      if (c.em_atraso) { atrasoV += falta; atrasoN++; }
      else if (em7dias(c.data_vencimento)) { vencerV += falta; vencerN++; }
      if (estaSemana(c.data_vencimento)) { semanaV += falta; semanaN++; }
    }
    return { atrasoV, atrasoN, vencerV, vencerN, semanaV, semanaN };
  }, [cobrancas, em7dias, estaSemana]);

  const filtradas = cobrancas.filter((c) => {
    if (filtro === "atraso") return c.em_atraso;
    if (filtro === "vencer") return !c.em_atraso && em7dias(c.data_vencimento);
    if (filtro === "semana") return estaSemana(c.data_vencimento);
    return true;
  });

  // Separadas por proprietário da moto (secção por dono, com subtotal).
  const grupos = useMemo(() => {
    const m = new Map<string, { nome: string; itens: CobrancaPainel[] }>();
    for (const c of filtradas) {
      const k = c.proprietario_id ?? "__sem__";
      if (!m.has(k)) m.set(k, { nome: c.proprietario_nome, itens: [] });
      m.get(k)!.itens.push(c);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  }, [filtradas]);

  // Folha semanal (dom→sáb): todas as cobranças da semana, incluindo as pagas.
  const janelaSemana = useMemo(() => limitesSemana(agora, semanaOffset), [agora, semanaOffset]);
  const carregarSemana = useCallback(async () => {
    setACarregarSemana(true);
    const r = await cobrancasDaSemana(janelaSemana.de, janelaSemana.ate);
    setRoster(r);
    setACarregarSemana(false);
  }, [janelaSemana.de, janelaSemana.ate]);
  useEffect(() => {
    // Busca a folha semanal ao entrar na vista ou mudar de semana (fetch → servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (vista === "semana") carregarSemana();
  }, [vista, carregarSemana]);

  // Remove da lista (ou atualiza) as cobranças que ficaram liquidadas após pagar.
  // Perda (calote) e desconto (serviço não prestado) — coisas diferentes.
  const [perda, setPerda] = useState<CobrancaPainel | null>(null);
  const [descontar, setDescontar] = useState<CobrancaPainel | null>(null);

  // Leitura de comprovativos: a IA lê o print, o gestor confirma.
  const [aLerComprovativo, setALerComprovativo] = useState(false);
  const [prePagamento, setPrePagamento] = useState<{
    valor?: string | null; data?: string | null; metodo?: PagamentoMetodo | null; referencia?: string | null;
  } | null>(null);

  /** Motoristas com dívida em aberto — os únicos a quem faz sentido alocar. */
  const motoristasComDivida = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cobrancas) m.set(c.motorista_id, c.motorista_nome);
    return [...m.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  }, [cobrancas]);

  /**
   * Do comprovativo lido para o formulário: escolhe-se a cobrança mais antiga em
   * dívida do motorista, que e a que o FIFO iria pagar primeiro de qualquer forma.
   */
  const doComprovativoParaPagamento = (motoristaId: string, lido: ComprovativoLido) => {
    const dele = cobrancas
      .filter((c) => c.motorista_id === motoristaId)
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));
    if (!dele.length) {
      window.alert("Esse motorista não tem cobranças em aberto — nada a alocar.");
      return;
    }
    setPrePagamento({
      valor: lido.valor,
      data: lido.data,
      metodo: lido.metodo,
      referencia: lido.referencia,
    });
    setALerComprovativo(false);
    setPagar(dele[0]);
  };

  /** Desfaz uma perda: a semana volta a ser dívida a cobrar. */
  const reverter = async (c: CobrancaPainel) => {
    if (
      !window.confirm(
        `Reverter a perda de ${formatarPreco(c.valor_devido)} (${c.motorista_nome}, ${rotuloSemanaMes(c.periodo_inicio)})?\n\nA semana volta a aparecer como dívida a cobrar.`,
      )
    )
      return;
    const r = await reverterIncobravel(c.id);
    if (r.success) carregarSemana();
    else window.alert(r.error ?? "Erro.");
  };

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
    // Na folha semanal, reflete logo o pagamento (a cobrança passa a paga).
    if (vista === "semana") carregarSemana();
  };

  // Roster ordenado: em atraso primeiro, depois por pagar, por fim as resolvidas.
  const rosterOrdenado = useMemo(() => {
    const ordem = (c: CobrancaPainel) => (resolvida(c) ? 2 : c.em_atraso ? 0 : 1);
    return [...roster].sort(
      (a, b) => ordem(a) - ordem(b) || a.motorista_nome.localeCompare(b.motorista_nome, "pt"),
    );
  }, [roster]);
  const rosterResumo = useMemo(() => {
    let total = 0, recebido = 0, pagas = 0, porPagarV = 0, porPagarN = 0;
    let perdaV = 0, perdaN = 0;
    for (const c of roster) {
      total += Number(c.valor_devido);
      recebido += Number(c.valor_pago);
      if (ehPerda(c)) {
        // Nem paga nem por cobrar: perdida. Somá-la às pagas inflacionava o
        // "9/10" e escondia exactamente o que interessa ver.
        perdaN++;
        perdaV += Number(c.valor_devido) - Number(c.desconto ?? 0) - Number(c.valor_pago);
      } else if (resolvida(c)) pagas++;
      else { porPagarV += Number(c.em_falta); porPagarN++; }
    }
    return { total, recebido, pagas, porPagarV, porPagarN, perdaV, perdaN, n: roster.length };
  }, [roster]);

  // Folha semanal agrupada por proprietário (mantém a ordem de rosterOrdenado).
  const rosterGrupos = useMemo(() => {
    const m = new Map<string, { nome: string; itens: CobrancaPainel[] }>();
    for (const c of rosterOrdenado) {
      const nome = c.proprietario_nome ?? "Sem proprietário";
      if (!m.has(nome)) m.set(nome, { nome, itens: [] });
      m.get(nome)!.itens.push(c);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  }, [rosterOrdenado]);

  return (
    <div className="space-y-6">
      {/* Abas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {([["dividas", "Dívidas em aberto"], ["semana", "Semana (conferência)"], ["pagamentos", "Pagamentos"]] as const).map(([v, r]) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                vista === v ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {/* Disponível em qualquer vista: o print chega quando chega. */}
        <Botao variante="secondary" onClick={() => setALerComprovativo(true)}>
          Ler comprovativo
        </Botao>
      </div>

      {vista === "dividas" && (
        <div className="space-y-6">
      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Em atraso</p>
          <p className="mt-1 text-2xl font-bold text-red-600">{formatarPreco(resumo.atrasoV)}</p>
          <p className="text-xs text-slate-500">{resumo.atrasoN} cobrança(s)</p>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Vence esta semana</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{formatarPreco(resumo.semanaV)}</p>
          <p className="text-xs text-slate-500">{resumo.semanaN} cobrança(s)</p>
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
        {([["atraso", "Em atraso"], ["semana", "Vence esta semana"], ["vencer", "A vencer (7 dias)"], ["todas", "Todas as abertas"]] as const).map(
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
        <div className="space-y-4">
          {grupos.map((g) => {
            const totalFalta = g.itens.reduce((s, c) => s + Number(c.em_falta), 0);
            return (
        <GrupoColapsavel
          key={g.nome}
          titulo={g.nome}
          resumo={`${g.itens.length} cobrança(s) · ${formatarPreco(totalFalta)}`}
        >
          <div className="divide-y divide-slate-100">
            {g.itens.map((c) => {
              const wa = linkWhatsapp(c);
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{c.motorista_nome}</p>
                      {c.em_atraso ? (
                        <Badge tom="danger">em atraso</Badge>
                      ) : (
                        <Badge tom="warning">vence {dataCurta(c.data_vencimento)}</Badge>
                      )}
                      {c.estado_liquidacao === "parcial" && <Badge tom="warning">parcial</Badge>}
                      {c.tipo !== "renda" && <Badge tom="info">{TIPO_ROTULO[c.tipo] ?? c.tipo}</Badge>}
                    </div>
                    <p className="text-sm text-slate-500">
                      {c.tipo === "renda"
                        ? `${c.veiculo_matricula} · ${rotuloSemanaMes(c.periodo_inicio)}`
                        : `${c.veiculo_matricula} · ${TIPO_ROTULO[c.tipo] ?? c.tipo} · ${dataCurta(c.periodo_inicio)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold tabular-nums text-slate-950">{formatarPreco(c.em_falta)}</span>
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className={classesBotao("secondary", "sm")}>
                        Lembrete WhatsApp
                      </a>
                    )}
                    <Botao variante="volt" tamanho="sm" onClick={() => setPagar(c)}>
                      Registar pagamento
                    </Botao>
                    <AcoesMenu
                      acoes={[
                        { rotulo: "Aplicar desconto…", onClick: () => setDescontar(c) },
                        {
                          rotulo: "Dar como perda (incobrável)…",
                          perigo: true,
                          onClick: () => setPerda(c),
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GrupoColapsavel>
            );
          })}
        </div>
      )}
        </div>
      )}
      {vista === "semana" && (
        <div className="space-y-4">
          {/* Navegação de semana (domingo → sábado) */}
          <div className="flex items-center justify-between gap-3 rounded-3xl bg-white p-4 shadow-sm">
            <button
              onClick={() => setSemanaOffset((o) => o - 1)}
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              aria-label="Semana anterior"
            >
              ←
            </button>
            <div className="text-center">
              <p className="text-base font-semibold text-slate-950">
                {rotuloSemanaMes(janelaSemana.de)}
              </p>
              {/* As datas reais: "Semana 2 de agosto" sozinho não diz que dias cobre. */}
              <p className="text-xs text-slate-500">
                {dataCurta(janelaSemana.de)} a {dataCurta(janelaSemana.ate)}
              </p>
              <button
                onClick={() => setSemanaOffset(0)}
                className="text-xs font-medium text-emerald-600 transition hover:text-emerald-700"
              >
                {semanaOffset === 0 ? "esta semana" : "voltar a esta semana"}
              </button>
            </div>
            <button
              onClick={() => setSemanaOffset((o) => o + 1)}
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
              aria-label="Semana seguinte"
            >
              →
            </button>
          </div>

          {/* Resumo da semana */}
          <div className={`grid gap-4 ${rosterResumo.perdaN > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Recebido</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{formatarPreco(rosterResumo.recebido)}</p>
              <p className="text-xs text-slate-500">de {formatarPreco(rosterResumo.total)}</p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Pagas</p>
              <p className="mt-1 text-2xl font-bold text-slate-950">{rosterResumo.pagas}/{rosterResumo.n}</p>
              <p className="text-xs text-slate-500">cobranças</p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Por pagar</p>
              <p className="mt-1 text-2xl font-bold text-red-600">{formatarPreco(rosterResumo.porPagarV)}</p>
              <p className="text-xs text-slate-500">{rosterResumo.porPagarN} cobrança(s)</p>
            </div>
            {rosterResumo.perdaN > 0 && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm text-red-700">Perdas</p>
                <p className="mt-1 text-2xl font-bold text-red-700">{formatarPreco(rosterResumo.perdaV)}</p>
                <p className="text-xs text-red-600">{rosterResumo.perdaN} cobrança(s) incobrável(is)</p>
              </div>
            )}
          </div>

          {/* Lista da semana (pagas + por pagar) */}
          {aCarregarSemana ? (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <p className="text-slate-500">A carregar…</p>
            </div>
          ) : rosterOrdenado.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <p className="text-slate-600">Nenhuma cobrança vence nesta semana.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {rosterGrupos.map((g) => {
                const pagasG = g.itens.filter(resolvida).length;
                const porPagarG = g.itens.filter((c) => !resolvida(c)).reduce((s, c) => s + Number(c.em_falta), 0);
                return (
                  <GrupoColapsavel
                    key={g.nome}
                    titulo={g.nome}
                    resumo={`${pagasG}/${g.itens.length} pagas · ${formatarPreco(porPagarG)} por pagar`}
                  >
                    <div className="divide-y divide-slate-100">
                      {g.itens.map((c) => {
                        const feito = resolvida(c);
                        const wa = linkWhatsapp(c);
                        return (
                          <div key={c.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-950">{c.motorista_nome}</p>
                        {c.estado_liquidacao === "liquidada" ? (
                          <Badge tom="success">✓ pago</Badge>
                        ) : c.estado_liquidacao === "incobravel" ? (
                          <Badge tom="danger">perda</Badge>
                        ) : c.estado_liquidacao === "isenta" ? (
                          <Badge tom="neutral">isento</Badge>
                        ) : c.estado_liquidacao === "parcial" ? (
                          <Badge tom="warning">parcial · falta {formatarPreco(c.em_falta)}</Badge>
                        ) : c.em_atraso ? (
                          <Badge tom="danger">em atraso</Badge>
                        ) : (
                          <Badge tom="neutral">por pagar</Badge>
                        )}
                        {c.tipo !== "renda" && <Badge tom="info">{TIPO_ROTULO[c.tipo] ?? c.tipo}</Badge>}
                      </div>
                      <p className="text-sm text-slate-500">{c.veiculo_matricula} · vence {dataCurta(c.data_vencimento)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`font-semibold tabular-nums ${feito ? "text-slate-400 line-through" : "text-slate-950"}`}>
                        {formatarPreco(c.valor_devido)}
                      </span>
                      {!feito && wa && (
                        <a href={wa} target="_blank" rel="noreferrer" className={classesBotao("secondary", "sm")}>
                          Lembrete
                        </a>
                      )}
                      {!feito && (
                        <Botao variante="volt" tamanho="sm" onClick={() => setPagar(c)}>
                          Registar pagamento
                        </Botao>
                      )}
                      <AcoesMenu
                        acoes={[
                          {
                            rotulo: "Aplicar desconto…",
                            onClick: () => setDescontar(c),
                            oculta: feito,
                          },
                          {
                            rotulo: "Dar como perda (incobrável)…",
                            perigo: true,
                            onClick: () => setPerda(c),
                            oculta: feito,
                          },
                          {
                            rotulo: "Reverter perda (volta a dívida)",
                            onClick: () => reverter(c),
                            oculta: !ehPerda(c),
                          },
                        ]}
                      />
                    </div>
                  </div>
                        );
                      })}
                    </div>
                  </GrupoColapsavel>
                );
              })}
            </div>
          )}
        </div>
      )}
      {vista === "pagamentos" && <LivroPagamentos />}

      {pagar && (
        <FormPagamento
          cobrancaClicada={pagar}
          cobrancasDoMotorista={cobrancas
            .filter((c) => c.motorista_id === pagar.motorista_id)
            .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))}
          inicial={prePagamento ?? undefined}
          onClose={() => {
            setPagar(null);
            setPrePagamento(null);
          }}
          onPago={aposPagamento}
        />
      )}

      {aLerComprovativo && (
        <LerComprovativo
          motoristasComDivida={motoristasComDivida}
          onConfirmar={doComprovativoParaPagamento}
          onClose={() => setALerComprovativo(false)}
        />
      )}

      {perda && (
        <FormPerda
          cobranca={perda}
          outrasDoMotorista={cobrancas.filter(
            (c) =>
              c.motorista_id === perda.motorista_id &&
              c.id !== perda.id &&
              (c.estado_liquidacao === "por_liquidar" || c.estado_liquidacao === "parcial"),
          )}
          onClose={() => setPerda(null)}
          onFeito={(ids) => {
            setCobrancas((atuais) => atuais.filter((c) => !ids.has(c.id)));
            if (vista === "semana") carregarSemana();
          }}
        />
      )}

      {descontar && (
        <FormDesconto
          cobranca={descontar}
          onClose={() => setDescontar(null)}
          onFeito={(id, valor, motivo) => {
            if (vista === "semana") carregarSemana();
            setCobrancas((atuais) =>
              atuais.flatMap((c) => {
                if (c.id !== id) return [c];
                const falta = Math.max(
                  Number(c.valor_devido) - valor - Number(c.valor_pago),
                  0,
                );
                // Se o desconto fecha a semana, ela deixa de ser dívida.
                if (falta <= 0.001) return [];
                return [{ ...c, desconto: String(valor), desconto_motivo: motivo, em_falta: String(falta) }];
              }),
            );
          }}
        />
      )}
    </div>
  );
}

// Livro-razão dos pagamentos: corrigir o recebedor ou estornar um lançamento errado.
const rotuloMes = (m: string) =>
  new Date(m + "-01T00:00:00").toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

function LivroPagamentos() {
  const [pags, setPags] = useState<PagamentoLista[]>([]);
  const [aCarregar, setACarregar] = useState(true);
  const [aAgir, setAAgir] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fMes, setFMes] = useState("");
  const [fMotorista, setFMotorista] = useState("");
  const [fMoto, setFMoto] = useState("");
  const [fParceiro, setFParceiro] = useState("");
  // Selecção múltipla: 1 pagamento = comprovativo simples; N = consolidado.
  // Só do MESMO motorista — o documento tem um único destinatário.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pronto, setPronto] = useState<ComprovativoPronto | null>(null);
  const [copiado, setCopiado] = useState(false);
  const painelRef = useRef<HTMLDivElement>(null);

  const opcoes = useMemo(() => {
    const meses = new Set<string>(), mots = new Set<string>(), motos = new Set<string>(), parceiros = new Set<string>();
    for (const p of pags) {
      meses.add(p.data_recebimento.slice(0, 7));
      mots.add(p.motorista_nome);
      p.matriculas.forEach((m) => motos.add(m));
      p.proprietarios.forEach((pr) => parceiros.add(pr));
    }
    return {
      meses: [...meses].sort().reverse(),
      motoristas: [...mots].sort((a, b) => a.localeCompare(b, "pt")),
      motos: [...motos].sort(),
      parceiros: [...parceiros].sort((a, b) => a.localeCompare(b, "pt")),
    };
  }, [pags]);

  const filtrados = useMemo(
    () =>
      pags.filter(
        (p) =>
          (!fMes || p.data_recebimento.slice(0, 7) === fMes) &&
          (!fMotorista || p.motorista_nome === fMotorista) &&
          (!fMoto || p.matriculas.includes(fMoto)) &&
          (!fParceiro || p.proprietarios.includes(fParceiro)),
      ),
    [pags, fMes, fMotorista, fMoto, fParceiro],
  );

  const carregar = useCallback(async () => {
    setACarregar(true);
    setPags(await listarPagamentos());
    setACarregar(false);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  const mudarRecebedor = async (p: PagamentoLista, novo: PagamentoRecebidoPor) => {
    setErro(null);
    setAAgir(p.id);
    const r = await alterarRecebidoPor(p.id, novo);
    setAAgir(null);
    if (r.success) setPags((atuais) => atuais.map((x) => (x.id === p.id ? { ...x, recebido_por: novo } : x)));
    else setErro(r.error ?? "Erro.");
  };

  const estornar = async (p: PagamentoLista) => {
    // Quantos pagamentos o comprovativo cobre: anular um consolidado deixa os
    // outros sem documento, e isso tem de estar dito ANTES de confirmar.
    const irmaos = p.comprovativo_id
      ? pags.filter((x) => x.comprovativo_id === p.comprovativo_id)
      : [];
    const avisoDoc = !p.comprovativo_numero
      ? ""
      : irmaos.length > 1
        ? `\n\nO comprovativo ${p.comprovativo_numero} cobre ${irmaos.length} pagamentos (${formatarPreco(
            irmaos.reduce((t, x) => t + Number(x.valor), 0),
          )}) e fica TODO ANULADO — terás de emitir um novo para os restantes. Avisa o motorista.`
        : `\n\nO comprovativo ${p.comprovativo_numero} fica ANULADO — avisa o motorista.`;
    if (
      !window.confirm(
        `Estornar o pagamento de ${formatarPreco(p.valor)} de ${p.motorista_nome} (${dataCurta(p.data_recebimento)})?\n\nAs semanas que cobria voltam a ficar por pagar.` +
          avisoDoc,
      )
    )
      return;
    setErro(null);
    setAAgir(p.id);
    const r = await estornarPagamento(p.id);
    setAAgir(null);
    if (r.success) {
      setPags((atuais) =>
        atuais
          .filter((x) => x.id !== p.id)
          // O documento foi anulado no servidor: as linhas irmãs também o perdem.
          .map((x) =>
            p.comprovativo_id && x.comprovativo_id === p.comprovativo_id
              ? { ...x, comprovativo_id: null, comprovativo_numero: null }
              : x,
          ),
      );
      // Sem isto ficava um id fantasma na selecção, a falsear o contador e a
      // guarda "mesmo motorista".
      setSel((atual) => {
        if (!atual.has(p.id)) return atual;
        const novo = new Set(atual);
        novo.delete(p.id);
        return novo;
      });
    } else setErro(r.error ?? "Erro.");
  };

  // Selecção EFECTIVA: só o que está visível no filtro actual. Derivar de
  // `filtrados` (e não de `pags`) garante "o que vês é o que emites" — de outro
  // modo, mudar de filtro deixava marcados pagamentos fora do ecrã que entravam
  // no documento à mesma. Também dispensa limpar a selecção a cada filtro.
  const selecionados = filtrados.filter((p) => sel.has(p.id));
  // Só se podem juntar pagamentos do mesmo motorista: o comprovativo tem um só
  // destinatário. Escolhido o primeiro, os outros motoristas ficam por escolher.
  const motoristaSel = selecionados[0]?.motorista_id ?? null;
  const totalSel = selecionados.reduce((t, p) => t + Number(p.valor), 0);

  const alternarSel = (p: PagamentoLista) => {
    setSel((atual) => {
      const novo = new Set(atual);
      if (novo.has(p.id)) novo.delete(p.id);
      else novo.add(p.id);
      return novo;
    });
  };

  const mostrarPainel = (d: ComprovativoPronto) => {
    setCopiado(false);
    setPronto(d);
    // O painel fica no topo da lista: emitir a partir de uma linha lá em baixo
    // não dava sinal nenhum de que algo tinha acontecido.
    requestAnimationFrame(() => painelRef.current?.scrollIntoView({ block: "nearest" }));
  };

  /** `emLote` distingue a barra de selecção do menu ⋯ de uma linha. */
  const emitir = async (ids: string[], emLote: boolean) => {
    setErro(null);
    setAAgir(ids[0]);
    const r = await emitirComprovativo(ids);
    setAAgir(null);
    if (!r.success || !r.dados) {
      setErro(r.error ?? "Erro.");
      return;
    }
    const d = r.dados;
    setPags((atuais) =>
      atuais.map((x) =>
        ids.includes(x.id) ? { ...x, comprovativo_id: d.id, comprovativo_numero: d.numero } : x,
      ),
    );
    // Emitir de uma linha não deita fora uma selecção que o gestor está a montar.
    if (emLote) setSel(new Set());
    mostrarPainel(d);
  };

  const reabrirLink = async (p: PagamentoLista) => {
    if (!p.comprovativo_id) return;
    setErro(null);
    setAAgir(p.id);
    const r = await linkComprovativo(p.comprovativo_id);
    setAAgir(null);
    if (r.success && r.dados) mostrarPainel(r.dados);
    else setErro(r.error ?? "Erro.");
  };

  const anular = async (p: PagamentoLista) => {
    if (!p.comprovativo_id) return;
    if (
      !window.confirm(
        `Anular o comprovativo ${p.comprovativo_numero}?\n\nO link continua a abrir, mas passa a mostrar "ANULADO". Usa isto quando o documento saiu com dados errados — depois emites outro.`,
      )
    )
      return;
    setErro(null);
    setAAgir(p.id);
    const r = await anularComprovativo(p.comprovativo_id);
    setAAgir(null);
    if (r.success)
      // Por DOCUMENTO, não por linha: um comprovativo consolidado cobre vários
      // pagamentos e todos deixam de o ter.
      setPags((atuais) =>
        atuais.map((x) =>
          x.comprovativo_id === p.comprovativo_id
            ? { ...x, comprovativo_id: null, comprovativo_numero: null }
            : x,
        ),
      );
    else setErro(r.error ?? "Erro.");
  };

  if (aCarregar) return <p className="text-sm text-slate-500">A carregar pagamentos…</p>;
  if (!pags.length)
    return (
      <p className="rounded-3xl bg-white p-6 text-center text-slate-600 shadow-sm">
        Ainda não há pagamentos registados.
      </p>
    );

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Últimos pagamentos. Marca um ou vários (do mesmo motorista) para emitir um comprovativo de
        pagamento. Corrige o recebedor ou estorna um lançamento errado (as semanas voltam a ficar por
        pagar). Um pagamento já num acerto fechado fica trancado.
      </p>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500">
          <option value="">Todos os meses</option>
          {opcoes.meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
        <select value={fParceiro} onChange={(e) => setFParceiro(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500">
          <option value="">Todos os parceiros</option>
          {opcoes.parceiros.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fMotorista} onChange={(e) => setFMotorista(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500">
          <option value="">Todos os motoristas</option>
          {opcoes.motoristas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fMoto} onChange={(e) => setFMoto(e.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500">
          <option value="">Todas as motos</option>
          {opcoes.motos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {(fMes || fParceiro || fMotorista || fMoto) && (
          <Botao
            variante="ghost"
            onClick={() => { setFMes(""); setFParceiro(""); setFMotorista(""); setFMoto(""); }}
          >
            Limpar
          </Botao>
        )}
      </div>
      {!filtrados.length && (
        <p className="rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm">Nenhum pagamento neste filtro.</p>
      )}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-950">
              {sel.size} {sel.size === 1 ? "pagamento" : "pagamentos"}
            </span>{" "}
            · {formatarPreco(totalSel)}
            {selecionados[0] ? ` · ${selecionados[0].motorista_nome}` : ""}
          </p>
          <div className="flex items-center gap-2">
            <Botao variante="ghost" tamanho="sm" onClick={() => setSel(new Set())}>
              Limpar
            </Botao>
            <Botao
              variante="volt"
              tamanho="sm"
              onClick={() => emitir(selecionados.map((p) => p.id), true)}
              disabled={aAgir !== null}
            >
              {sel.size === 1 ? "Emitir comprovativo" : `Emitir comprovativo (${sel.size})`}
            </Botao>
          </div>
        </div>
      )}

      {pronto && (
        <div ref={painelRef} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm font-semibold text-slate-950">
            Comprovativo {pronto.numero} pronto a enviar
          </p>
          <input
            readOnly
            value={pronto.link}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pronto.whatsapp && (
              <a
                href={pronto.whatsapp}
                target="_blank"
                rel="noreferrer"
                className={classesBotao("volt", "sm")}
              >
                Enviar por WhatsApp
              </a>
            )}
            <a
              href={pronto.link}
              target="_blank"
              rel="noreferrer"
              className={classesBotao("secondary", "sm")}
            >
              Abrir
            </a>
            <Botao
              variante="secondary"
              tamanho="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pronto.link);
                  setCopiado(true);
                } catch {
                  setErro("Não foi possível copiar — seleciona o link acima e copia à mão.");
                }
              }}
            >
              {copiado ? "Copiado ✓" : "Copiar link"}
            </Botao>
            <Botao variante="ghost" tamanho="sm" onClick={() => setPronto(null)}>
              Fechar
            </Botao>
          </div>
          {!pronto.whatsapp && (
            <p className="mt-2 text-xs text-slate-500">
              Sem telemóvel na ficha do motorista — copia o link e envia como preferires.
            </p>
          )}
        </div>
      )}

      {filtrados.map((p) => {
        // Bloqueado para selecção: outro motorista, ou já tem comprovativo activo.
        const outroMotorista = !!motoristaSel && p.motorista_id !== motoristaSel;
        const naoSelecionavel = outroMotorista || !!p.comprovativo_numero;
        const acoes: AcaoMenu[] = [
          {
            // Rótulo distinto do botão em lote: daqui emite-se SÓ este pagamento.
            rotulo: sel.size > 0 ? "Emitir só deste pagamento" : "Emitir comprovativo",
            onClick: () => emitir([p.id], false),
            oculta: !!p.comprovativo_numero,
          },
          {
            rotulo: "Abrir / reenviar comprovativo",
            onClick: () => reabrirLink(p),
            oculta: !p.comprovativo_numero,
          },
          {
            rotulo: "Anular comprovativo",
            onClick: () => anular(p),
            perigo: true,
            oculta: !p.comprovativo_numero,
          },
          {
            rotulo: "Estornar pagamento",
            onClick: () => estornar(p),
            perigo: true,
            oculta: p.bloqueado,
          },
        ];
        return (
          <div
            key={p.id}
            className={`rounded-2xl bg-white p-4 shadow-sm transition ${
              sel.has(p.id) ? "ring-2 ring-emerald-500" : ""
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={sel.has(p.id)}
                  disabled={naoSelecionavel}
                  onChange={() => alternarSel(p)}
                  aria-label={`Selecionar pagamento de ${p.motorista_nome}`}
                  title={
                    p.comprovativo_numero
                      ? `Já tem o comprovativo ${p.comprovativo_numero}`
                      : outroMotorista
                        ? "Só podes juntar pagamentos do mesmo motorista"
                        : "Juntar a um comprovativo"
                  }
                  className="mt-1 h-4 w-4 shrink-0 accent-emerald-500 disabled:opacity-30"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">
                    {p.motorista_nome} · {formatarPreco(p.valor)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {dataCurta(p.data_recebimento)}
                    {p.semanas.length ? ` · ${p.semanas.join(" · ")}` : " · sem alocação"}
                  </p>
                  {p.comprovativo_numero && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">{p.comprovativo_numero}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.bloqueado ? (
                  <Badge tom="neutral">🔒 em acerto fechado</Badge>
                ) : (
                  <select
                    value={p.recebido_por}
                    disabled={aAgir === p.id}
                    onChange={(e) => mudarRecebedor(p, e.target.value as PagamentoRecebidoPor)}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    <option value="goscooters">Recebido: GoScooters</option>
                    <option value="proprietario">Recebido: parceiro</option>
                  </select>
                )}
                <AcoesMenu acoes={acoes} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FormPagamento({
  cobrancaClicada,
  cobrancasDoMotorista,
  inicial,
  onClose,
  onPago,
}: {
  cobrancaClicada: CobrancaPainel;
  cobrancasDoMotorista: CobrancaPainel[];
  /** Pré-preenchimento vindo da leitura de um comprovativo (só sugestão). */
  inicial?: { valor?: string | null; data?: string | null; metodo?: PagamentoMetodo | null; referencia?: string | null };
  onClose: () => void;
  onPago: (liquidados: Set<string>, parciais: Map<string, number>) => void;
}) {
  const [valor, setValor] = useState<string>(inicial?.valor || cobrancaClicada.em_falta);
  const [metodo, setMetodo] = useState<PagamentoMetodo>(inicial?.metodo || "transferencia");
  const [recebidoPor, setRecebidoPor] = useState<PagamentoRecebidoPor>(
    cobrancaClicada.proprietario_recebe_direto ? "proprietario" : "goscooters",
  );
  const [data, setData] = useState(() => inicial?.data || hoje());
  const [referencia, setReferencia] = useState(inicial?.referencia || "");
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
        recebido_por: recebidoPor,
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
    <Modal
      onClose={onClose}
      titulo="Registar pagamento"
      subtitulo={cobrancaClicada.motorista_nome}
      maxWidth="max-w-lg"
    >
        <div className="space-y-4">
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
          <label className={etiqueta}>
            <span>Recebido por</span>
            <select
              className={campo}
              value={recebidoPor}
              onChange={(e) => setRecebidoPor(e.target.value as PagamentoRecebidoPor)}
            >
              <option value="goscooters">GoScooters</option>
              <option value="proprietario">Parceiro (conta dele)</option>
            </select>
            <span className="text-xs font-normal text-slate-500">
              {cobrancaClicada.proprietario_recebe_direto
                ? "Este parceiro recebe direto — muda para GoScooters se foste tu a receber."
                : "Muda para “Parceiro” se este pagamento entrou na conta dele."}
            </span>
          </label>

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
                      {l.c.tipo === "renda"
                        ? rotuloSemanaMes(l.c.periodo_inicio)
                        : `${TIPO_ROTULO[l.c.tipo] ?? l.c.tipo} · ${dataCurta(l.c.periodo_inicio)}`}
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
            <Botao type="button" variante="secondary" tamanho="lg" className="flex-1" onClick={onClose}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              variante="volt"
              tamanho="lg"
              className="flex-1"
              onClick={handleSubmit}
              disabled={aGravar || !(Number(valor) > 0)}
            >
              {aGravar ? "A gravar..." : "Registar pagamento"}
            </Botao>
          </div>
        </div>
    </Modal>
  );
}

/**
 * Dar semanas como PERDA (incobrável). Um calote raramente é de uma semana só,
 * por isso o formulário traz já as outras semanas em dívida do mesmo motorista,
 * pré-marcadas — resolve-se o caso todo de uma vez.
 */
function FormPerda({
  cobranca,
  outrasDoMotorista,
  onClose,
  onFeito,
}: {
  cobranca: CobrancaPainel;
  outrasDoMotorista: CobrancaPainel[];
  onClose: () => void;
  onFeito: (ids: Set<string>) => void;
}) {
  const [motivo, setMotivo] = useState("");
  // Todas as semanas em dívida do motorista, por ordem cronológica e tratadas da
  // MESMA maneira: são o mesmo caso (o mesmo calote), com a mesma justificação.
  // Destacar a que foi clicada fazia-a parecer outra coisa.
  const candidatas = [cobranca, ...outrasDoMotorista].sort((a, b) =>
    a.periodo_inicio.localeCompare(b.periodo_inicio),
  );
  const [marcadas, setMarcadas] = useState<Set<string>>(
    () => new Set(candidatas.map((c) => c.id)),
  );
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const escolhidas = candidatas.filter((c) => marcadas.has(c.id));
  const total = escolhidas.reduce((t, c) => t + Number(c.em_falta), 0);

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    const r = await marcarIncobravel(escolhidas.map((c) => c.id), motivo);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro.");
      return;
    }
    onFeito(new Set(escolhidas.map((c) => c.id)));
    onClose();
  };

  return (
    <Modal onClose={onClose} titulo="Dar como perda (incobrável)">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Estas semanas foram usadas e eram devidas, mas não vão ser pagas. Ficam registadas
          como <strong>perda</strong> — não são apagadas. Saem de &quot;quem me deve&quot; e
          passam a contar no total de incobráveis.
        </p>

        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {candidatas.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-500"
                  checked={marcadas.has(c.id)}
                  onChange={() =>
                    setMarcadas((atual) => {
                      const novo = new Set(atual);
                      if (novo.has(c.id)) novo.delete(c.id);
                      else novo.add(c.id);
                      return novo;
                    })
                  }
                />
                {c.veiculo_matricula} · {rotuloSemanaMes(c.periodo_inicio)}
                <span className="text-slate-400">
                  ({dataCurta(c.periodo_inicio)}–{dataCurta(c.periodo_fim)})
                </span>
              </span>
              <span className="text-sm tabular-nums text-slate-600">{formatarPreco(c.em_falta)}</span>
            </label>
          ))}
        </div>

        <div className="rounded-2xl bg-red-50 px-4 py-3">
          <p className="text-sm text-slate-700">
            Perda a registar para <strong>{cobranca.motorista_nome}</strong>:{" "}
            <strong className="tabular-nums text-red-700">{formatarPreco(total)}</strong>{" "}
            <span className="text-slate-500">({escolhidas.length} semana(s))</span>
          </p>
        </div>

        <label className={etiqueta}>
          <span>Motivo (fica no registo)</span>
          <input
            className={campo}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: devolveu a moto a 25/08 e não voltou a contactar"
          />
        </label>

        {erro && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Botao variante="secondary" onClick={onClose} disabled={aGravar}>
            Cancelar
          </Botao>
          <Botao
            variante="danger"
            onClick={gravar}
            disabled={aGravar || !motivo.trim() || escolhidas.length === 0}
          >
            {aGravar ? "A gravar…" : `Dar ${formatarPreco(total)} como perda`}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

/**
 * DESCONTO numa semana: o serviço não foi prestado (moto avariada, dias sem
 * rodar), por isso aquele valor nunca chegou a ser devido. Não é perda — o
 * preço contratado fica intacto e o abatimento vai à parte, para a diferença
 * ser sempre explicável.
 */
function FormDesconto({
  cobranca,
  onClose,
  onFeito,
}: {
  cobranca: CobrancaPainel;
  onClose: () => void;
  onFeito: (id: string, valor: number, motivo: string | null) => void;
}) {
  const [valor, setValor] = useState(cobranca.desconto ?? "0");
  const [motivo, setMotivo] = useState(cobranca.desconto_motivo ?? "");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const desconto = Number(valor) || 0;
  const fica = Math.max(Number(cobranca.valor_devido) - desconto - Number(cobranca.valor_pago), 0);

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    const r = await aplicarDesconto(cobranca.id, desconto, motivo);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro.");
      return;
    }
    onFeito(cobranca.id, desconto, motivo.trim() || null);
    onClose();
  };

  return (
    <Modal onClose={onClose} titulo="Aplicar desconto">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Para quando o serviço não foi prestado — a moto esteve parada e o motorista não
          rodou. <strong>Não é perda</strong>: aquele valor nunca chegou a ser devido.
        </p>

        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {cobranca.motorista_nome} · {cobranca.veiculo_matricula} ·{" "}
          {rotuloSemanaMes(cobranca.periodo_inicio)}
          <br />
          Semana de <strong>{formatarPreco(cobranca.valor_devido)}</strong>
          {Number(cobranca.valor_pago) > 0 && <> · já pago {formatarPreco(cobranca.valor_pago)}</>}
        </div>

        <label className={etiqueta}>
          <span>Desconto (€) — 0 remove</span>
          <input
            type="number"
            step="0.01"
            min="0"
            className={campo}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>

        <label className={etiqueta}>
          <span>Motivo</span>
          <input
            className={campo}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: 3 dias parada por avaria no travão"
          />
        </label>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
          <p className="text-sm text-slate-700">
            Passa a dever{" "}
            <strong className="tabular-nums">{formatarPreco(fica)}</strong>
            {fica <= 0.001 && <span className="text-emerald-700"> — semana fica liquidada</span>}
          </p>
        </div>

        {erro && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Botao variante="secondary" onClick={onClose} disabled={aGravar}>
            Cancelar
          </Botao>
          <Botao variante="volt" onClick={gravar} disabled={aGravar || (desconto > 0 && !motivo.trim())}>
            {aGravar ? "A gravar…" : "Aplicar desconto"}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
