/**
 * O fecho de gestão de um mês: do que a casa ganhou ao que lhe sobrou, em cascata.
 *
 *     Receita
 *   − Custos da frota      despesas da casa COM mota, por categoria
 *   = Margem da frota
 *   − Custos da empresa    despesas da casa SEM mota, por rubrica
 *   = Resultado
 *
 * A receita chega já calculada por financeiro.ts (renda paga × taxa, no mês da
 * quarta-feira da semana); aqui só se arrumam os custos à volta dela.
 *
 * Custos da casa são só as despesas imputadas à GoScooters. As imputadas ao
 * motorista (coimas, portagens) são dinheiro adiantado por conta dele, e as do
 * proprietário entram no acerto dele: nenhuma é custo da casa.
 *
 * Valores com IVA incluído (valor_total), pela data da fatura, pagas ou não.
 *
 * Pura, sem Supabase nem Next — testada em fechoGestao.test.mjs. Os rótulos das
 * categorias e a leitura da rubrica chegam por parâmetro (CAT_ROTULO e
 * rubricaDoDetalhe), porque os módulos testados não se importam uns aos outros.
 */

/** Uma despesa como o fecho a precisa. `valor_total` vem da base em texto. */
export interface DespesaDoFecho {
  categoria: string;
  imputar_a: string;
  veiculo_id: string | null;
  valor_total: number | string;
  /** O detalhe da despesa (JSON). A rubrica, se houver, está em `detalhe.rubrica`. */
  detalhe?: unknown;
}

export interface CatalogoDoFecho {
  /** Rótulo de cada categoria de despesa — o CAT_ROTULO de despesasMeta.ts. */
  rotuloCategoria: Readonly<Record<string, string>>;
  /** A rubrica do detalhe, se existir e for válida — o rubricaDoDetalhe de custos.ts. */
  rubricaDe: (detalhe: unknown) => { id: string; rotulo: string } | null;
}

/** Uma parcela de um custo: uma categoria (frota) ou uma rubrica (empresa). */
export interface ParcelaDoFecho {
  /** Única no mês e igual de mês para mês: "categoria:…" ou "rubrica:…". */
  chave: string;
  rotulo: string;
  valor: number;
}

export interface FechoGestao {
  receita: number;
  custos_frota: number;
  custos_frota_por_categoria: ParcelaDoFecho[];
  margem_frota: number;
  custos_empresa: number;
  custos_empresa_por_rubrica: ParcelaDoFecho[];
  resultado: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function somar(mapa: Map<string, ParcelaDoFecho>, chave: string, rotulo: string, valor: number) {
  const at = mapa.get(chave);
  if (at) at.valor += valor;
  else mapa.set(chave, { chave, rotulo, valor });
}

/** Do maior para o menor; em empate, por ordem alfabética. */
function ordenadas(mapa: Map<string, ParcelaDoFecho>): ParcelaDoFecho[] {
  return [...mapa.values()]
    .map((p) => ({ ...p, valor: r2(p.valor) }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, "pt"));
}

export function fechoGestao(
  receita: number,
  despesas: readonly DespesaDoFecho[],
  catalogo: CatalogoDoFecho,
): FechoGestao {
  const rotuloDe = (categoria: string) =>
    Object.hasOwn(catalogo.rotuloCategoria, categoria) ? catalogo.rotuloCategoria[categoria] : categoria;
  const frota = new Map<string, ParcelaDoFecho>();
  const empresa = new Map<string, ParcelaDoFecho>();
  let custosFrota = 0;
  let custosEmpresa = 0;

  for (const d of despesas) {
    if (d.imputar_a !== "goscooters") continue; // do motorista ou do proprietário: não é da casa
    const valor = Number(d.valor_total);
    if (d.veiculo_id) {
      custosFrota += valor;
      somar(frota, `categoria:${d.categoria}`, rotuloDe(d.categoria), valor);
    } else {
      custosEmpresa += valor;
      const rubrica = catalogo.rubricaDe(d.detalhe);
      if (rubrica) somar(empresa, `rubrica:${rubrica.id}`, rubrica.rotulo, valor);
      else somar(empresa, `categoria:${d.categoria}`, rotuloDe(d.categoria), valor);
    }
  }

  // Cada linha a partir das de cima já arredondadas: a cascata soma certo ao cêntimo.
  const rec = r2(receita);
  const cf = r2(custosFrota);
  const ce = r2(custosEmpresa);
  const margem = r2(rec - cf);
  return {
    receita: rec,
    custos_frota: cf,
    custos_frota_por_categoria: ordenadas(frota),
    margem_frota: margem,
    custos_empresa: ce,
    custos_empresa_por_rubrica: ordenadas(empresa),
    resultado: r2(margem - ce),
  };
}

/** As despesas cuja fatura é do mês `competencia` ("AAAA-MM"). */
export function despesasDoMes<T extends { data_despesa: string }>(despesas: readonly T[], competencia: string): T[] {
  return despesas.filter((d) => d.data_despesa.slice(0, 7) === competencia);
}

/** Uma parcela nos dois meses da cascata. */
export interface ParcelaComparada {
  chave: string;
  rotulo: string;
  este: number;
  anterior: number;
}

/**
 * As parcelas deste mês e do anterior lado a lado: uma linha por categoria ou
 * rubrica que exista em qualquer dos dois (0 onde faltar), do maior para o menor
 * neste mês.
 */
export function juntarParcelas(
  este: readonly ParcelaDoFecho[],
  anterior: readonly ParcelaDoFecho[],
): ParcelaComparada[] {
  const linhas = new Map<string, ParcelaComparada>();
  for (const p of este) linhas.set(p.chave, { chave: p.chave, rotulo: p.rotulo, este: p.valor, anterior: 0 });
  for (const p of anterior) {
    const at = linhas.get(p.chave);
    if (at) at.anterior = p.valor;
    else linhas.set(p.chave, { chave: p.chave, rotulo: p.rotulo, este: 0, anterior: p.valor });
  }
  return [...linhas.values()].sort(
    (a, b) => b.este - a.este || b.anterior - a.anterior || a.rotulo.localeCompare(b.rotulo, "pt"),
  );
}

/** Uma despesa como o «Rendimento por dono» a precisa. */
export interface DespesaDoDono {
  imputar_a: string;
  veiculo_id: string | null;
  proprietario_id: string | null;
  valor_total: number | string;
}

export interface DespesasPorDono {
  /** Por id do dono: as imputadas a ele e, num dono da frota própria, as da casa nas motas dele. */
  por_dono: Map<string, number>;
  /** Da casa e sem mota: os custos da empresa, que não são de nenhum dono. */
  custos_empresa: number;
  /** Da casa, numa mota que não é da frota própria. */
  casa_em_motas_de_parceiros: number;
}

/**
 * As despesas do mês repartidas por quem as suporta, para o «Rendimento por dono».
 * `donoProprioDaMota` = id da mota → id do dono, só para as motas da frota própria.
 *
 * Nada se perde pelo caminho: Σ por_dono + custos_empresa + casa_em_motas_de_parceiros
 * dá as despesas da casa mais as dos proprietários — as mesmas do negócio todo.
 * As do motorista ficam de fora, como no negócio todo.
 */
export function despesasPorDono(
  despesas: readonly DespesaDoDono[],
  donoProprioDaMota: ReadonlyMap<string, string>,
): DespesasPorDono {
  const porDono = new Map<string, number>();
  const juntar = (id: string, v: number) => porDono.set(id, (porDono.get(id) ?? 0) + v);
  let empresa = 0;
  let casaEmParceiros = 0;

  for (const d of despesas) {
    const v = Number(d.valor_total);
    if (d.imputar_a === "proprietario") {
      if (d.proprietario_id) juntar(d.proprietario_id, v);
    } else if (d.imputar_a === "goscooters") {
      if (!d.veiculo_id) {
        empresa += v;
      } else {
        const dono = donoProprioDaMota.get(d.veiculo_id);
        if (dono) juntar(dono, v);
        else casaEmParceiros += v;
      }
    }
  }

  return {
    por_dono: new Map([...porDono].map(([id, v]) => [id, r2(v)])),
    custos_empresa: r2(empresa),
    casa_em_motas_de_parceiros: r2(casaEmParceiros),
  };
}

export interface DespesasDoNegocio {
  /** As despesas da casa e dos proprietários. */
  total: number;
  por_imputacao: { imputar_a: string; valor: number }[];
  /** Imputadas a motoristas (coimas, portagens): adiantadas por conta deles. */
  adiantado_motoristas: number;
}

/**
 * As despesas do negócio inteiro, para «O negócio todo». As imputadas ao
 * motorista não são despesa do negócio: são dinheiro adiantado por conta dele, e
 * só aparecem à parte.
 */
export function despesasDoNegocio(
  despesas: readonly { imputar_a: string; valor_total: number | string }[],
): DespesasDoNegocio {
  const porImput = new Map<string, number>();
  let adiantado = 0;
  for (const d of despesas) {
    const v = Number(d.valor_total);
    if (d.imputar_a === "motorista") adiantado += v;
    else porImput.set(d.imputar_a, (porImput.get(d.imputar_a) ?? 0) + v);
  }
  const total = [...porImput.values()].reduce((a, b) => a + b, 0);
  return {
    total: r2(total),
    por_imputacao: [...porImput.entries()]
      .map(([imputar_a, valor]) => ({ imputar_a, valor: r2(valor) }))
      .sort((a, b) => b.valor - a.valor),
    adiantado_motoristas: r2(adiantado),
  };
}
