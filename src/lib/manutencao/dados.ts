import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { EstadoOperacional, Manutencao } from "@/types/db";
import {
  avaliarOleo,
  compararUrgenciaOleo,
  textoEstadoOleo,
  textoProximaTroca,
} from "./oleo";
import type { EntradaOleo, EstadoOleo, LeituraKm, ManutencaoParaOleo } from "./oleo";

/**
 * O que a base tem sobre a manutenção de cada mota, pronto para o cálculo do óleo
 * (src/lib/manutencao/oleo.ts). Sem tabelas novas: lê `km_registo`, `manutencao` e
 * a descrição da despesa ligada a cada manutenção — é lá que muitas vezes está
 * escrito o serviço («mudança de óleo e filtro»), porque a manutenção criada a
 * partir da fatura fica com o tipo «outro».
 *
 * Aqui não se decide nada: as contas são todas do módulo puro.
 */

/** A mota, na parte que interessa ao óleo. */
export type MotaOleo = {
  id: string;
  matricula: string | null;
  modelo: string;
  estado_operacional: EstadoOperacional;
};

/** Uma manutenção como a página da mota a mostra (o cálculo usa só parte disto). */
export type LinhaManutencaoMota = Pick<
  Manutencao,
  "id" | "veiculo_id" | "tipo" | "data" | "km" | "observacoes" | "detalhe" | "despesa_id" | "origem"
>;

type LinhaKm = { veiculo_id: string; km: number; data: string; fonte: string };

export type DadosOleoMota = {
  /** As leituras de `km_registo` (o km das manutenções entra no cálculo à parte). */
  leituras: LeituraKm[];
  manutencoes: ManutencaoParaOleo[];
  linhas: LinhaManutencaoMota[];
};

/** O PostgREST devolve no máximo 1.000 linhas por pedido — sem isto, cortava calado. */
const PAGINA = 1000;
/** Ids por pedido: uma lista enorme num só `in` rebenta o URL. */
const LOTE_IDS = 100;

async function lerTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  oQue: string,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    // Rebenta em vez de devolver vazio: uma leitura falhada calada punha motas
    // «Sem dados» e escondia exactamente as que estão vencidas.
    if (error) throw new Error(`Não consegui ler ${oQue}: ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return todas;
  }
}

/** A descrição da despesa de cada manutenção, por id de despesa. */
async function descricoesDasDespesas(
  manutencoes: readonly LinhaManutencaoMota[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(manutencoes.flatMap((m) => (m.despesa_id ? [m.despesa_id] : [])))];
  const descricoes = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { data, error } = await supabaseAdmin
      .from("despesa")
      .select("id, descricao")
      .in("id", ids.slice(i, i + LOTE_IDS));
    if (error) throw new Error(`Não consegui ler as despesas das manutenções: ${error.message}`);
    for (const d of data ?? []) descricoes.set(d.id, d.descricao);
  }
  return descricoes;
}

/**
 * As leituras e as manutenções, por mota. Com `motoId` lê só essa mota; sem ele,
 * a frota toda (a lista da manutenção). Lança erro se alguma leitura falhar.
 */
export async function lerDadosOleo(motoId?: string): Promise<Map<string, DadosOleoMota>> {
  const [leituras, manutencoes] = await Promise.all([
    lerTodas<LinhaKm>((de, ate) => {
      const q = supabaseAdmin.from("km_registo").select("veiculo_id, km, data, fonte");
      return (motoId ? q.eq("veiculo_id", motoId) : q).order("data").order("id").range(de, ate);
    }, "as leituras de km"),
    lerTodas<LinhaManutencaoMota>((de, ate) => {
      const q = supabaseAdmin
        .from("manutencao")
        .select("id, veiculo_id, tipo, data, km, observacoes, detalhe, despesa_id, origem");
      return (motoId ? q.eq("veiculo_id", motoId) : q).order("data").order("id").range(de, ate);
    }, "as manutenções"),
  ]);

  const descricoes = await descricoesDasDespesas(manutencoes);

  const porMota = new Map<string, DadosOleoMota>();
  const daMota = (id: string): DadosOleoMota => {
    const atual = porMota.get(id);
    if (atual) return atual;
    const nova: DadosOleoMota = { leituras: [], manutencoes: [], linhas: [] };
    porMota.set(id, nova);
    return nova;
  };

  for (const l of leituras) daMota(l.veiculo_id).leituras.push({ km: l.km, data: l.data, fonte: l.fonte });
  for (const m of manutencoes) {
    const dados = daMota(m.veiculo_id);
    dados.linhas.push(m);
    dados.manutencoes.push({
      id: m.id,
      tipo: m.tipo,
      data: m.data,
      km: m.km,
      textos: [m.observacoes, m.despesa_id ? descricoes.get(m.despesa_id) ?? null : null],
    });
  }
  return porMota;
}

/** O que o cálculo do óleo precisa de saber sobre uma mota, num só sítio. */
export function entradaOleo(moto: MotaOleo, dados: DadosOleoMota | undefined, hoje: string): EntradaOleo {
  return {
    modelo: moto.modelo,
    estadoOperacional: moto.estado_operacional,
    leituras: dados?.leituras ?? [],
    manutencoes: dados?.manutencoes ?? [],
    hoje,
  };
}

/** Uma linha da sub-aba Manutenção, com as contas já feitas. */
export type LinhaOleoFrota = {
  motoId: string;
  matricula: string | null;
  modelo: string;
  estado: EstadoOleo;
  /** Nunca houve troca registada: aparece «Sem registo» e conta-se à parte. */
  semRegisto: boolean;
  /** A troca já passou: numa mota parada, tira o verde ao selo. */
  passou: boolean;
  /** «vencida há 9 dias», «+640 km», «faltam 180 km». */
  texto: string;
  /** «aos 43.430 km ou a 07/10»; null quando não há próxima prevista. */
  proxima: string | null;
  /** A última leitura válida do conta-km, para a dica do «Óleo trocado». */
  ultimaLeitura: { km: number; data: string } | null;
};

/**
 * A frota toda avaliada de uma vez e já ordenada: primeiro o que está vencido e,
 * dentro de cada grupo, o que mais aperta. Uma leitura falhada rebenta (vem de
 * `lerDadosOleo`) — mais vale dizer que não carregou do que mostrar tudo «OK».
 */
export async function linhasOleoDaFrota(
  motas: readonly MotaOleo[],
  hoje: string,
): Promise<LinhaOleoFrota[]> {
  const dados = await lerDadosOleo();
  return motas
    .map((moto) => ({ moto, oleo: avaliarOleo(entradaOleo(moto, dados.get(moto.id), hoje)) }))
    .sort(
      (a, b) =>
        compararUrgenciaOleo(a.oleo, b.oleo) ||
        (a.moto.matricula ?? "").localeCompare(b.moto.matricula ?? "", "pt"),
    )
    .map(({ moto, oleo }) => ({
      motoId: moto.id,
      matricula: moto.matricula,
      modelo: moto.modelo,
      estado: oleo.estado,
      semRegisto: oleo.semRegisto,
      passou: oleo.passou,
      texto: textoEstadoOleo(oleo),
      proxima: textoProximaTroca(oleo.proxima),
      ultimaLeitura: oleo.km.ultimaValida
        ? { km: oleo.km.ultimaValida.km, data: oleo.km.ultimaValida.data }
        : null,
    }));
}
