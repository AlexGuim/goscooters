import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mesDaSemana } from "@/lib/datas";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";
import { partirEmLotes } from "@/lib/lotes";
import { CAT_ROTULO } from "@/lib/despesasMeta";
import { rubricaDoDetalhe } from "@/lib/custos";
import { catalogoDeMotas, parteDaCasa, receitaDaCasa, type CatalogoDeMotas } from "@/lib/receitaCasa";
import {
  despesasDoMes,
  despesasDoNegocio,
  despesasPorDono,
  fechoGestao,
  type CatalogoDoFecho,
  type FechoGestao,
} from "@/lib/fechoGestao";

/** Como o fecho arruma os custos: os rótulos das categorias e a lista única das rubricas. */
const CATALOGO: CatalogoDoFecho = { rotuloCategoria: CAT_ROTULO, rubricaDe: rubricaDoDetalhe };

/**
 * Quantos ids de cobrança vão em cada pedido `.in()`. Os ids viajam no URL, e o
 * gateway da Supabase recusa-o perto dos 250 UUIDs; 100 deixa folga. Um ano
 * inteiro de rendas já passa dos 100 (124 em setembro de 2026).
 */
const LOTE_IDS = 100;

/** Quantos desses pedidos vão ao mesmo tempo, para não atropelar o gateway. */
const PEDIDOS_EM_PARALELO = 4;

/** Linhas que se pedem de cada vez. O PostgREST pode devolver menos, se o projeto tiver um limite mais baixo. */
const PAGINA = 1000;

/**
 * Travão de segurança: 100 páginas são 100 000 linhas. Uma leitura maior do que
 * isto não é um mês grande, é um filtro que se perdeu pelo caminho — mais vale
 * dar erro do que ficar a ler para sempre.
 */
const PAGINAS_MAX = 100;

/** Um erro da base como o supabase-js o devolve: mensagem e, quando há, o código. */
interface ErroDaBase {
  message: string;
  code?: string;
}

/**
 * Uma consulta que falha NÃO pode virar zeros. O supabase-js não lança: devolve
 * `{ data: null, error }`, e com `data ?? []` o Resultado mostrava 0 € de receita
 * como se fosse verdade. Cada consulta daqui verifica o `error` e lança com
 * contexto — melhor uma página de erro do que um número errado com ar de certo.
 */
function erroDeLeitura(oQue: string, error: ErroDaBase): Error {
  return new Error(`Resultado: não foi possível ler ${oQue}: ${error.message}`);
}

/**
 * Lê uma tabela inteira, página a página.
 *
 * O outro caminho para um número errado com ar de certo: o PostgREST devolve no
 * máximo 1000 linhas por pedido e deita o resto fora SEM erro. Com a frota de
 * hoje não chega lá; numa instância com ~60 motas, um ano de rendas passa das
 * 3000 e a receita do ano aparecia a menos, calada. Aqui pede-se página a
 * página — e cada página verifica o seu erro.
 *
 * Avança pelo que VEIO, não pelo tamanho que se pediu, e só pára numa página
 * vazia. O limite de linhas por pedido é uma definição do projeto Supabase e
 * pode ser baixada sem ninguém tocar no código: a parar na primeira página
 * incompleta, um limite de 500 devolvia as primeiras 500 linhas e calava-se —
 * outra vez receita a menos com ar de certo. Custa um pedido vazio no fim.
 *
 * Cada consulta tem de trazer uma ordem FIXA (o `id` chega), senão a base pode
 * devolver a mesma linha em duas páginas e saltar outra.
 */
async function lerTudo<T>(
  oQue: string,
  pedir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: ErroDaBase | null }>,
): Promise<T[]> {
  const linhas: T[] = [];
  let de = 0;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const { data, error } = await pedir(de, de + PAGINA - 1);
    if (error) {
      // Pedir um intervalo já fora da tabela é o fim da leitura, não uma avaria:
      // há instalações que respondem 416 (PGRST103) em vez de uma lista vazia.
      if (de > 0 && error.code === "PGRST103") return linhas;
      throw erroDeLeitura(oQue, error);
    }
    const desta = data ?? [];
    linhas.push(...desta);
    if (desta.length === 0) return linhas;
    de += desta.length;
  }
  throw new Error(`Resultado: ${oQue} não acabou ao fim de ${PAGINAS_MAX} páginas — a leitura foi interrompida.`);
}

/**
 * Consolidação financeira da GoScooters.
 *
 * A que MÊS pertence cada euro: à semana a que a renda diz respeito, pela regra
 * da quarta-feira — exatamente como o acerto do parceiro. Só conta o que foi
 * PAGO (uma semana por cobrar não é receita), mas o mês é o da semana e não o
 * do dia em que o dinheiro entrou.
 *
 * Foi assim de propósito: com a data do pagamento a mandar, uma semana de
 * setembro paga a 28/08 caía em agosto, e a comissão daqui divergia da do
 * acerto do mesmo mês (39 € de diferença em agosto/2026). Dois números com o
 * mesmo nome e valores diferentes não se defendem.
 *
 * Evita a dupla contagem tratando a renda bruta como dinheiro de passagem e
 * reconhecendo como RECEITA da casa apenas:
 *   - a comissão sobre as motos de parceiro, e
 *   - a renda integral da frota própria (taxa efetiva 100%).
 * Fórmula: Receita_GS = Σ (renda paga × taxa efetiva). Só conta tipo='renda'.
 * Resultado = Receita_GS − Custos da frota − Custos da empresa: as despesas da casa
 * (imputar_a='goscooters') com mota e sem mota, pela data da fatura — o fecho de
 * gestão, em fechoGestao.ts.
 */
export interface MesFinanceiro {
  mes: number; // 1..12
  receita_gs: number;
  /**
   * Parte da receita que entrou MESMO na conta da GoScooters (frota própria, ou
   * renda de parceiro que a GoScooters cobrou).
   */
  receita_em_caixa: number;
  /**
   * Comissão sobre renda que o PARCEIRO recebeu diretamente. É receita ganha,
   * mas o dinheiro nunca passou pela GoScooters — chega pelo acerto do mês.
   * Separada porque juntá-las diz "regime de caixa" e não é verdade.
   */
  receita_via_acerto: number;
  /** Despesas da casa COM mota, pela data da fatura. */
  custos_frota: number;
  /** Receita − custos da frota. */
  margem_frota: number;
  /** Despesas da casa SEM mota: não são de nenhuma mota nem de nenhum dono. */
  custos_empresa: number;
  /** Todas as despesas da casa: custos da frota + custos da empresa. */
  despesas_gs: number;
  /** Margem da frota − custos da empresa (= receita − despesas da casa). */
  resultado: number;
  turnover: number; // renda bruta cobrada (memorando)
}

export interface FinanceiroAno {
  ano: number;
  meses: MesFinanceiro[];
  total: Omit<MesFinanceiro, "mes">;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function financeiroAno(ano: number): Promise<FinanceiroAno> {
  // Janela generosa: uma semana de janeiro pode vencer em dezembro do ano
  // anterior, e uma de dezembro em janeiro do seguinte. Filtra-se depois pela
  // regra da quarta-feira, que é quem manda.
  const de = `${ano - 1}-12-01`;
  const ate = `${ano + 1}-01-31`;

  const catalogo = await lerCatalogoDeMotas();

  // MESMA regra do acerto do parceiro: a semana pertence ao mês da sua
  // quarta-feira, e conta-se o que foi PAGO dessa semana — não o dinheiro que
  // entrou no mês. Assim "agosto" quer dizer o mesmo em todo o sistema.
  const cobs = await lerTudo(`as cobranças de ${ano}`, (dePagina, atePagina) =>
    supabaseAdmin
      .from("cobranca")
      .select("id, veiculo_id, valor_pago, data_vencimento")
      .eq("tipo", "renda")
      .gt("valor_pago", 0)
      .gte("data_vencimento", de)
      .lte("data_vencimento", ate)
      .order("id")
      .range(dePagina, atePagina),
  );

  const doAno = cobs.filter((c) => (mesDaSemana(c.data_vencimento) ?? "").startsWith(`${ano}-`));
  const gsPorCobranca = await parteRecebidaPelaGoScooters(doAno.map((c) => c.id));

  const receita = new Array(13).fill(0);
  const emCaixa = new Array(13).fill(0);
  const viaAcerto = new Array(13).fill(0);
  const turnover = new Array(13).fill(0);

  for (const c of doAno) {
    const mes = Number((mesDaSemana(c.data_vencimento) ?? "").slice(5, 7));
    if (!mes) continue;
    // A mesma regra do mês, do mesmo módulo: a renda inteira na frota própria, a
    // comissão numa mota de parceiro, nada numa mota sem dono ou sem mota.
    const p = parteDaCasa(c, catalogo);
    if (!p) continue;
    turnover[mes] += p.pago;
    receita[mes] += p.receita;
    if (p.eh_propria) {
      emCaixa[mes] += p.receita; // frota própria: a renda entra sempre na conta da casa
    } else {
      // Numa moto de parceiro, a comissão só está em caixa na proporção do que
      // foi a GoScooters a cobrar; o resto vem pelo acerto.
      const gs = Math.min(gsPorCobranca.get(c.id) ?? 0, p.pago);
      const fracao = p.pago > 0 ? gs / p.pago : 0;
      emCaixa[mes] += p.receita * fracao;
      viaAcerto[mes] += p.receita * (1 - fracao);
    }
  }

  // As despesas são eventos pontuais: pertencem ao mês da fatura, pagas ou não.
  // Só as da casa; a rubrica dos custos da empresa vem no detalhe.
  const desps = await lerTudo(`as despesas de ${ano}`, (dePagina, atePagina) =>
    supabaseAdmin
      .from("despesa")
      .select("data_despesa, categoria, imputar_a, veiculo_id, valor_total, detalhe")
      .eq("imputar_a", "goscooters")
      .gte("data_despesa", `${ano}-01-01`)
      .lte("data_despesa", `${ano}-12-31`)
      .order("id")
      .range(dePagina, atePagina),
  );

  const meses: MesFinanceiro[] = [];
  const tot = {
    receita_gs: 0,
    receita_em_caixa: 0,
    receita_via_acerto: 0,
    custos_frota: 0,
    margem_frota: 0,
    custos_empresa: 0,
    despesas_gs: 0,
    resultado: 0,
    turnover: 0,
  };
  for (let m = 1; m <= 12; m++) {
    const f = fechoGestao(receita[m], despesasDoMes(desps, `${ano}-${String(m).padStart(2, "0")}`), CATALOGO);
    meses.push({
      mes: m,
      receita_gs: f.receita,
      receita_em_caixa: r2(emCaixa[m]),
      receita_via_acerto: r2(viaAcerto[m]),
      custos_frota: f.custos_frota,
      margem_frota: f.margem_frota,
      custos_empresa: f.custos_empresa,
      despesas_gs: r2(f.custos_frota + f.custos_empresa),
      resultado: f.resultado,
      turnover: r2(turnover[m]),
    });
    tot.receita_gs += f.receita;
    tot.receita_em_caixa += emCaixa[m];
    tot.receita_via_acerto += viaAcerto[m];
    tot.custos_frota += f.custos_frota;
    tot.custos_empresa += f.custos_empresa;
    tot.turnover += turnover[m];
  }
  tot.receita_gs = r2(tot.receita_gs);
  tot.receita_em_caixa = r2(tot.receita_em_caixa);
  tot.receita_via_acerto = r2(tot.receita_via_acerto);
  tot.custos_frota = r2(tot.custos_frota);
  tot.custos_empresa = r2(tot.custos_empresa);
  tot.despesas_gs = r2(tot.custos_frota + tot.custos_empresa);
  tot.margem_frota = r2(tot.receita_gs - tot.custos_frota);
  tot.resultado = r2(tot.margem_frota - tot.custos_empresa);
  tot.turnover = r2(tot.turnover);

  return { ano, meses, total: tot };
}

/** Quem é o dono de cada mota e a que taxa a renda dela entra na receita. */
async function lerCatalogoDeMotas(): Promise<CatalogoDeMotas> {
  const [motos, donos] = await Promise.all([
    lerTudo("as motas", (de, ate) =>
      supabaseAdmin.from("moto").select("id, proprietario_id, comissao_valor_override").order("id").range(de, ate),
    ),
    lerTudo("os proprietários", (de, ate) =>
      supabaseAdmin.from("proprietario").select("id, comissao_valor, eh_goscooters").order("id").range(de, ate),
    ),
  ]);
  return catalogoDeMotas(motos, donos);
}

/** Quanto de cada cobrança foi cobrado PELA GoScooters (o resto foi ao parceiro). */
async function parteRecebidaPelaGoScooters(cobIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!cobIds.length) return mapa;
  // Aos bocados: com a lista inteira no URL, o gateway recusava o pedido a partir
  // de ~250 ids e a receita "em caixa" passava a 0 sem aviso. Cada lote verifica
  // o seu erro — um lote perdido também era dinheiro a desaparecer.
  // Os lotes também não vão todos ao mesmo tempo: com um ano inteiro de rendas
  // seriam dezenas de pedidos em simultâneo, e é assim que se deita um gateway
  // abaixo. Vão poucos de cada vez, e cada um lê-se até ao fim (página a página).
  for (const grupo of partirEmLotes(partirEmLotes(cobIds, LOTE_IDS), PEDIDOS_EM_PARALELO)) {
    const respostas = await Promise.all(
      grupo.map((lote) =>
        lerTudo("os pagamentos das cobranças", (de, ate) =>
          supabaseAdmin
            .from("pagamento_cobranca")
            .select("cobranca_id, valor_alocado, pagamento:pagamento_id(recebido_por)")
            .in("cobranca_id", lote)
            .order("id")
            .range(de, ate),
        ),
      ),
    );
    for (const alocs of respostas) {
      for (const a of alocs) {
        const pj = Array.isArray(a.pagamento) ? a.pagamento[0] : a.pagamento;
        const rp = (pj as { recebido_por?: string } | null)?.recebido_por ?? "goscooters";
        if (rp !== "goscooters") continue;
        const k = a.cobranca_id as string;
        mapa.set(k, (mapa.get(k) ?? 0) + Number(a.valor_alocado));
      }
    }
  }
  return mapa;
}

// ── Detalhe de um mês ───────────────────────────────────────────────────────

/** Uma moto da frota própria: a renda dela é receita a 100%. */
export interface LinhaFrotaPropria {
  veiculo_id: string;
  matricula: string | null;
  valor: number;
}

/** Um parceiro: a receita é a comissão sobre a renda que os motoristas pagaram. */
export interface LinhaComissao {
  proprietario_id: string;
  nome: string;
  /** Renda paga pelos motoristas das motos deste parceiro (base da comissão). */
  base: number;
  /** Taxa média efetiva aplicada (%), útil quando há override por moto. */
  taxa_media: number;
  comissao: number;
}

/** Uma despesa própria, com a fatura para se poder conferir. */
export interface LinhaDespesaPropria {
  id: string;
  data: string;
  categoria: string;
  descricao: string | null;
  matricula: string | null;
  valor: number;
  /** Como está guardado: URL público (fatura) ou caminho privado (coima/portagem). O ecrã resolve-o. */
  documento_url: string | null;
}

/**
 * Uma linha da consolidação por dono: quanto a frota dele rendeu, quanto disso
 * foi comissão da GoScooters, que despesas suportou, e o que lhe sobra.
 *
 * É a mesma aritmética do acerto, mas com TODOS os donos lado a lado — e com a
 * frota própria incluída, para a tabela cobrir o negócio inteiro em vez de só a
 * parte que se acerta com terceiros.
 */
export interface LinhaPorDono {
  proprietario_id: string;
  nome: string;
  eh_propria: boolean;
  /** Renda paga pelos motoristas das motos dele, nas semanas do mês. */
  renda: number;
  /** Parte que fica para a GoScooters (0 na frota própria — é tudo dela). */
  comissao: number;
  /** Despesas imputadas a este dono no mês. */
  despesas: number;
  /** O que sobra para o dono: renda − comissão − despesas. */
  rendimento: number;
  motos: number;
}

/** O negócio inteiro no mês, independentemente de quem fica com o quê. */
export interface NegocioTotal {
  /** Toda a renda paga nas semanas do mês. */
  renda: number;
  /** As despesas do mês da casa e dos parceiros. As imputadas a motoristas não. */
  despesas: number;
  /** Renda − despesas: o que a operação gerou, antes de se repartir. */
  resultado: number;
  /** Despesas abertas por quem as suporta. */
  despesas_por_imputacao: { imputar_a: string; valor: number }[];
  /**
   * Coimas e portagens imputadas a motoristas: dinheiro que se adianta por conta
   * deles, não despesa do negócio. Só aparece à parte, numa linha discreta.
   */
  adiantado_motoristas: number;
}

export interface MesDetalhado extends MesFinanceiro {
  ano: number;
  frota_propria: LinhaFrotaPropria[];
  comissoes: LinhaComissao[];
  despesas: LinhaDespesaPropria[];
  /** Renda da frota própria (soma de frota_propria) — parte da receita. */
  receita_frota: number;
  /** Soma das comissões — a outra parte da receita. */
  receita_comissao: number;
  /** O negócio como um todo (todas as motos, todas as despesas). */
  negocio: NegocioTotal;
  /** Consolidação por dono — os acertos todos lado a lado. */
  por_dono: LinhaPorDono[];
  /** O fecho de gestão do mês: receita − custos da frota − custos da empresa. */
  fecho: FechoGestao;
  /** O mesmo fecho no mês anterior, para comparar. */
  fecho_anterior: FechoGestao;
  /**
   * Despesas da casa que não são de nenhum dono. Vão à parte no «Rendimento por
   * dono», para a soma continuar a bater com o negócio todo.
   */
  sem_dono: { custos_empresa: number; casa_noutras_motas: number; proprietario_sem_dono: number };
}

/**
 * O mesmo cálculo do ano, mas aberto: de onde veio cada euro num mês.
 *
 * Existe porque a tabela anual dizia "Agosto: 904 €" e mais nada — não se via
 * que motos, que parceiros, que despesas. O parceiro tem esse detalhe todo no
 * acerto dele; faltava à casa ter o seu.
 *
 * Recalcula sempre a partir dos dados (não congela): se se corrigir um
 * pagamento de agosto, agosto acompanha.
 */
export async function financeiroMes(ano: number, mes: number): Promise<MesDetalhado> {
  const competencia = `${ano}-${String(mes).padStart(2, "0")}`;
  const mm = String(mes).padStart(2, "0");
  // O mês anterior só entra na coluna de comparação da cascata.
  const anoAnterior = mes === 1 ? ano - 1 : ano;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const competenciaAnterior = `${anoAnterior}-${String(mesAnterior).padStart(2, "0")}`;
  // Janela larga: a semana da virada do mês vence fora dele. Filtra-se depois
  // pela quarta-feira. Começa no mês anterior, que também se calcula.
  const janelaDe = new Date(Date.UTC(anoAnterior, mesAnterior - 1, 1));
  janelaDe.setUTCDate(janelaDe.getUTCDate() - 8);
  const janelaAte = new Date(Date.UTC(ano, mes, 0));
  janelaAte.setUTCDate(janelaAte.getUTCDate() + 8);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [motos, donos] = await Promise.all([
    lerTudo("as motas", (de, ate) =>
      supabaseAdmin
        .from("moto")
        .select("id, matricula, proprietario_id, comissao_valor_override")
        .order("id")
        .range(de, ate),
    ),
    lerTudo("os proprietários", (de, ate) =>
      supabaseAdmin.from("proprietario").select("id, nome, comissao_valor, eh_goscooters").order("id").range(de, ate),
    ),
  ]);
  const donoDe = new Map(donos.map((d) => [d.id, d]));
  const motoDe = new Map(motos.map((m) => [m.id, m]));
  // A regra do dinheiro — quanto de cada renda é da casa — é a mesma do ano e
  // vive num módulo puro testado (receitaCasa.ts). Serve este mês e o anterior.
  const catalogo = catalogoDeMotas(motos, donos);

  // Semanas QUE PERTENCEM a este mês (regra da quarta-feira), e pagas.
  const cobs = await lerTudo(`as cobranças de ${competenciaAnterior} e ${competencia}`, (dePagina, atePagina) =>
    supabaseAdmin
      .from("cobranca")
      .select("id, veiculo_id, valor_pago, data_vencimento")
      .eq("tipo", "renda")
      .gt("valor_pago", 0)
      .gte("data_vencimento", iso(janelaDe))
      .lte("data_vencimento", iso(janelaAte))
      .order("id")
      .range(dePagina, atePagina),
  );
  const doMes = cobs.filter((c) => mesDaSemana(c.data_vencimento) === competencia);
  const doMesAnterior = cobs.filter((c) => mesDaSemana(c.data_vencimento) === competenciaAnterior);
  const gsPorCobranca = await parteRecebidaPelaGoScooters(doMes.map((c) => c.id));

  const frota = new Map<string, number>();
  const porParceiro = new Map<string, { base: number; comissao: number }>();
  // Por DONO (inclui a frota própria): a consolidação de todos os acertos.
  const porDono = new Map<string, { renda: number; comissao: number; motos: Set<string> }>();
  let turnover = 0;
  let receitaFrota = 0;
  let receitaComissao = 0;
  let emCaixa = 0;
  let viaAcerto = 0;

  for (const c of doMes) {
    const p = parteDaCasa(c, catalogo);
    if (!p) continue;
    turnover += p.pago;

    if (p.dono_id) {
      const at = porDono.get(p.dono_id) ?? { renda: 0, comissao: 0, motos: new Set<string>() };
      at.renda += p.pago;
      at.comissao += p.eh_propria ? 0 : p.receita; // a frota própria não se cobra a si
      at.motos.add(p.veiculo_id);
      porDono.set(p.dono_id, at);
    }

    if (p.eh_propria) {
      frota.set(p.veiculo_id, (frota.get(p.veiculo_id) ?? 0) + p.receita);
      receitaFrota += p.receita;
      emCaixa += p.receita;
    } else if (p.dono_id) {
      const com = p.receita;
      const at = porParceiro.get(p.dono_id) ?? { base: 0, comissao: 0 };
      at.base += p.pago;
      at.comissao += com;
      porParceiro.set(p.dono_id, at);
      receitaComissao += com;
      const gs = Math.min(gsPorCobranca.get(c.id) ?? 0, p.pago);
      const fracao = p.pago > 0 ? gs / p.pago : 0;
      emCaixa += com * fracao;
      viaAcerto += com * (1 - fracao);
    }
  }

  const receitaAnterior = receitaDaCasa(doMesAnterior, catalogo);

  // As despesas deste mês e do anterior, pela data da fatura.
  const ultimo = String(new Date(ano, mes, 0).getDate()).padStart(2, "0");
  const despsDosDoisMeses = await lerTudo(
    `as despesas de ${competenciaAnterior} e ${competencia}`,
    (dePagina, atePagina) =>
      supabaseAdmin
        .from("despesa")
        .select("id, data_despesa, categoria, descricao, valor_total, veiculo_id, detalhe, imputar_a, proprietario_id")
        .gte("data_despesa", `${competenciaAnterior}-01`)
        .lte("data_despesa", `${ano}-${mm}-${ultimo}`)
        .order("data_despesa")
        .order("id")
        .range(dePagina, atePagina),
  );
  const todasDesps = despesasDoMes(despsDosDoisMeses, competencia);
  const despsAnterior = despesasDoMes(despsDosDoisMeses, competenciaAnterior);

  const desps = todasDesps.filter((d) => d.imputar_a === "goscooters");
  const despesas: LinhaDespesaPropria[] = desps.map((d) => ({
    id: d.id,
    data: d.data_despesa as string,
    categoria: d.categoria as string,
    descricao: (d.descricao as string) ?? null,
    matricula: d.veiculo_id ? motoDe.get(d.veiculo_id)?.matricula ?? null : null,
    valor: Number(d.valor_total),
    // O valor guardado (URL público ou caminho privado): o ecrã resolve-o para abrir.
    documento_url: documentoDoDetalhe(d.detalhe),
  }));
  const despesasTotal = despesas.reduce((s, d) => s + d.valor, 0);
  const receita = receitaFrota + receitaComissao;

  // ── O fecho de gestão: a cascata deste mês e a do anterior ────────────
  const fecho = fechoGestao(receita, todasDesps, CATALOGO);
  const fecho_anterior = fechoGestao(receitaAnterior, despsAnterior, CATALOGO);

  // ── O negócio inteiro: toda a renda, as despesas da casa e dos parceiros ─
  // As dos motoristas são adiantamentos por conta deles: só à parte.
  const doNegocio = despesasDoNegocio(todasDesps);
  const negocio: NegocioTotal = {
    renda: r2(turnover),
    despesas: doNegocio.total,
    resultado: r2(turnover - doNegocio.total),
    despesas_por_imputacao: doNegocio.por_imputacao,
    adiantado_motoristas: doNegocio.adiantado_motoristas,
  };

  // ── Por dono: a mesma conta do acerto, com todos lado a lado ────────────
  // As despesas de cada dono são as imputadas a ELE — a mesma regra que o acerto
  // usa. A frota própria só fica com as da casa nas motas próprias; as da casa
  // sem mota (custos da empresa) não são de nenhum dono e vão à parte.
  const donoProprioDaMota = new Map<string, string>();
  for (const m of motos) {
    const dono = m.proprietario_id ? donoDe.get(m.proprietario_id) : undefined;
    if (dono?.eh_goscooters) donoProprioDaMota.set(m.id, dono.id);
  }
  const reparto = despesasPorDono(todasDesps, donoProprioDaMota);
  const despDoDono = reparto.por_dono;
  // A união dos dois: um dono pode ter tido despesas sem ter tido renda no mês
  // (uma mota parada que foi à oficina). Se só olhássemos à renda, essa despesa
  // aparecia no total do negócio e desaparecia da linha de quem a suporta.
  const idsDono = new Set<string>([...porDono.keys(), ...despDoDono.keys()]);
  const por_dono: LinhaPorDono[] = [...idsDono]
    .map((id) => {
      const v = porDono.get(id) ?? { renda: 0, comissao: 0, motos: new Set<string>() };
      const dono = donoDe.get(id);
      const desp = despDoDono.get(id) ?? 0;
      return {
        proprietario_id: id,
        nome: dono?.nome ?? "—",
        eh_propria: !!dono?.eh_goscooters,
        renda: r2(v.renda),
        comissao: r2(v.comissao),
        despesas: r2(desp),
        rendimento: r2(v.renda - v.comissao - desp),
        motos: v.motos.size,
      };
    })
    .sort((a, b) => b.renda - a.renda);

  return {
    ano,
    mes,
    receita_gs: r2(receita),
    receita_em_caixa: r2(emCaixa),
    receita_via_acerto: r2(viaAcerto),
    custos_frota: fecho.custos_frota,
    margem_frota: fecho.margem_frota,
    custos_empresa: fecho.custos_empresa,
    despesas_gs: r2(despesasTotal),
    resultado: fecho.resultado,
    turnover: r2(turnover),
    receita_frota: r2(receitaFrota),
    receita_comissao: r2(receitaComissao),
    frota_propria: [...frota.entries()]
      .map(([id, valor]) => ({ veiculo_id: id, matricula: motoDe.get(id)?.matricula ?? null, valor: r2(valor) }))
      .sort((a, b) => (a.matricula ?? "").localeCompare(b.matricula ?? "")),
    comissoes: [...porParceiro.entries()]
      .map(([id, v]) => ({
        proprietario_id: id,
        nome: donoDe.get(id)?.nome ?? "—",
        base: r2(v.base),
        taxa_media: v.base > 0 ? r2((v.comissao / v.base) * 100) : 0,
        comissao: r2(v.comissao),
      }))
      .sort((a, b) => b.comissao - a.comissao),
    despesas,
    negocio,
    por_dono,
    fecho,
    fecho_anterior,
    sem_dono: {
      custos_empresa: reparto.custos_empresa,
      casa_noutras_motas: reparto.casa_noutras_motas,
      proprietario_sem_dono: reparto.proprietario_sem_dono,
    },
  };
}
