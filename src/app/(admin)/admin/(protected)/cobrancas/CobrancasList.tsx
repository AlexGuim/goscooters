"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { cobrancasDaSemana } from "@/actions/cobrancaActions";
import { rotuloSemanaMes } from "@/lib/datas";
import { Botao, Badge, Modal, classesBotao, campo, etiqueta } from "@/components/ui";
import GrupoColapsavel from "@/components/GrupoColapsavel";

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
const resolvida = (c: CobrancaPainel) =>
  c.estado_liquidacao === "liquidada" || c.estado_liquidacao === "isenta";

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
    for (const c of roster) {
      total += Number(c.valor_devido);
      recebido += Number(c.valor_pago);
      if (resolvida(c)) pagas++;
      else { porPagarV += Number(c.em_falta); porPagarN++; }
    }
    return { total, recebido, pagas, porPagarV, porPagarN, n: roster.length };
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
      <div className="flex gap-2">
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
          <div className="grid gap-4 sm:grid-cols-3">
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
          onClose={() => setPagar(null)}
          onPago={aposPagamento}
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
    if (
      !window.confirm(
        `Estornar o pagamento de ${formatarPreco(p.valor)} de ${p.motorista_nome} (${dataCurta(p.data_recebimento)})?\n\nAs semanas que cobria voltam a ficar por pagar.`,
      )
    )
      return;
    setErro(null);
    setAAgir(p.id);
    const r = await estornarPagamento(p.id);
    setAAgir(null);
    if (r.success) setPags((atuais) => atuais.filter((x) => x.id !== p.id));
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
        Últimos pagamentos. Corrige o recebedor ou estorna um lançamento errado (as semanas voltam a ficar
        por pagar). Um pagamento já num acerto fechado fica trancado.
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
      {filtrados.map((p) => (
        <div key={p.id} className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-950">
                {p.motorista_nome} · {formatarPreco(p.valor)}
              </p>
              <p className="text-xs text-slate-500">
                {dataCurta(p.data_recebimento)}
                {p.semanas.length ? ` · ${p.semanas.join(" · ")}` : " · sem alocação"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {p.bloqueado ? (
                <Badge tom="neutral">🔒 em acerto fechado</Badge>
              ) : (
                <>
                  <select
                    value={p.recebido_por}
                    disabled={aAgir === p.id}
                    onChange={(e) => mudarRecebedor(p, e.target.value as PagamentoRecebidoPor)}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    <option value="goscooters">Recebido: GoScooters</option>
                    <option value="proprietario">Recebido: parceiro</option>
                  </select>
                  <Botao variante="danger" tamanho="sm" onClick={() => estornar(p)} disabled={aAgir === p.id}>
                    Estornar
                  </Botao>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
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
  const [recebidoPor, setRecebidoPor] = useState<PagamentoRecebidoPor>(
    cobrancaClicada.proprietario_recebe_direto ? "proprietario" : "goscooters",
  );
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
