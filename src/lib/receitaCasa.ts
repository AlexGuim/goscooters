/**
 * A regra do dinheiro da casa: quanto de uma renda paga é receita da GoScooters.
 *
 *   - mota da frota própria → a renda inteira (a casa não se cobra a si mesma);
 *   - mota de um parceiro   → a renda × a comissão (a do dono, ou a da mota se
 *                             ela tiver comissão própria);
 *   - mota sem dono, mota que já não existe, ou renda sem mota → nada.
 *
 * Estava escrita duas vezes — uma na página do ano, outra na do mês — e as duas
 * já não diziam o mesmo nas motas sem dono. Aqui é uma só, pura e testada, para
 * que uma mudança na comissão não tenha de ser acertada em dois sítios.
 *
 * A que MÊS pertence cada renda não se decide aqui: isso é a regra da
 * quarta-feira (datas.ts), e quem chama já traz as cobranças do mês certo.
 *
 * Pura, sem Supabase nem Next — testada em receitaCasa.test.mjs.
 */

/** Uma mota, como a receita a precisa (`comissao_valor_override` em %, como vem da base). */
export interface MotaDaReceita {
  id: string;
  proprietario_id: string | null;
  comissao_valor_override?: number | string | null;
}

/** Um dono, como a receita o precisa (`comissao_valor` em %, como vem da base). */
export interface DonoDaReceita {
  id: string;
  comissao_valor?: number | string | null;
  /** A frota própria da GoScooters. */
  eh_goscooters?: boolean | null;
}

/** Uma renda paga, como a receita a precisa. */
export interface CobrancaDaReceita {
  veiculo_id: string | null;
  valor_pago: number | string;
}

/** Quem é o dono de cada mota e a que taxa a renda dela entra na receita. */
export interface CatalogoDeMotas {
  /** Taxa efetiva por mota: 1 na frota própria, a comissão (0 a 1) numa de parceiro. */
  taxaDe: ReadonlyMap<string, number>;
  /** O dono de cada mota, quando ela tem dono. */
  donoDe: ReadonlyMap<string, DonoDaReceita>;
}

/** O que uma renda paga dá à casa. */
export interface ParteDaCasa {
  veiculo_id: string;
  /** O dono da mota, ou null quando a mota não tem dono atribuído. */
  dono_id: string | null;
  /** É uma mota da frota própria. */
  eh_propria: boolean;
  /** A renda que o motorista pagou. */
  pago: number;
  /** A parte dessa renda que é receita da casa. */
  receita: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Um número da base (texto, nulo ou lixo) como número: o que não for número é 0. */
function numero(valor: number | string | null | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** A taxa (0 a 1) a que a renda desta mota entra na receita da casa. */
function taxaDaMota(moto: MotaDaReceita, dono: DonoDaReceita | undefined): number {
  if (!dono) return 0; // mota sem dono: não se sabe de quem é a renda, não é receita
  if (dono.eh_goscooters) return 1; // frota própria: é tudo da casa
  const pct = moto.comissao_valor_override != null ? numero(moto.comissao_valor_override) : numero(dono.comissao_valor);
  return pct / 100;
}

/** A taxa e o dono de cada mota, a partir das motas e dos proprietários da base. */
export function catalogoDeMotas(
  motos: readonly MotaDaReceita[],
  donos: readonly DonoDaReceita[],
): CatalogoDeMotas {
  const porId = new Map(donos.map((d) => [d.id, d]));
  const taxaDe = new Map<string, number>();
  const donoDe = new Map<string, DonoDaReceita>();
  for (const m of motos) {
    const dono = m.proprietario_id ? porId.get(m.proprietario_id) : undefined;
    if (dono) donoDe.set(m.id, dono);
    taxaDe.set(m.id, taxaDaMota(m, dono));
  }
  return { taxaDe, donoDe };
}

/**
 * A parte de uma renda paga que é receita da casa, ou null quando a cobrança não
 * tem mota (sem mota não se sabe de quem é: não conta para nada).
 */
export function parteDaCasa(cobranca: CobrancaDaReceita, catalogo: CatalogoDeMotas): ParteDaCasa | null {
  const veiculo_id = cobranca.veiculo_id;
  if (!veiculo_id) return null;
  const pago = numero(cobranca.valor_pago);
  const dono = catalogo.donoDe.get(veiculo_id);
  const taxa = catalogo.taxaDe.get(veiculo_id) ?? 0;
  return {
    veiculo_id,
    dono_id: dono?.id ?? null,
    eh_propria: !!dono?.eh_goscooters,
    pago,
    receita: dono ? pago * taxa : 0,
  };
}

/** A receita da casa num conjunto de rendas pagas (as do mesmo mês), ao cêntimo. */
export function receitaDaCasa(cobrancas: readonly CobrancaDaReceita[], catalogo: CatalogoDeMotas): number {
  let receita = 0;
  for (const c of cobrancas) receita += parteDaCasa(c, catalogo)?.receita ?? 0;
  return r2(receita);
}
