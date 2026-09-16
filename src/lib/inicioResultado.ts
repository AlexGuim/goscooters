/**
 * O gráfico do Resultado no Início: que meses mostrar, que altura tem cada
 * coluna e o que dizer do último mês fechado.
 *
 * Aqui não se calcula dinheiro nenhum. O Resultado de cada mês é o do fecho de
 * gestão (Margem da frota − Custos da empresa), calculado por fechoGestao.ts e
 * lido por financeiro.ts; este módulo só recebe os números já feitos e trata da
 * escala, da ordem e das palavras. Assim o gráfico nunca pode divergir da
 * tabela do Resultado — é o mesmo número, desenhado.
 *
 * Os nomes dos meses vivem aqui (e não em datas.ts) porque os módulos testados
 * não se importam uns aos outros a não ser por tipos.
 *
 * Pura, sem Supabase nem Next — testada em inicioResultado.test.mjs.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Uma coluna do gráfico é tão fina que uma altura destas já não se vê: dá-se-lhe o mínimo. */
const ALTURA_MINIMA = 1.5;

/** O Resultado de um mês, tal como o fecho de gestão o devolve. */
export interface MesDoResultado {
  /** "AAAA-MM". */
  competencia: string;
  resultado: number;
}

export interface ColunaDoResultado {
  competencia: string;
  /** "setembro" — para ler. */
  nome: string;
  /** "set" — para caber por baixo da coluna. */
  curto: string;
  resultado: number;
  /** Altura da coluna, em % da altura do gráfico. */
  altura: number;
  /** Distância do fundo do gráfico ao pé da coluna, em %. */
  base: number;
  /** Mês ainda a decorrer: o número vai mudar até ao fim do mês. */
  em_curso: boolean;
}

export interface GraficoDoResultado {
  colunas: ColunaDoResultado[];
  /** Onde fica a linha do zero, em % contados do fundo do gráfico. */
  zero: number;
}

/** O nome do mês de uma competência "AAAA-MM" ("" se não for uma). */
export function nomeDoMes(competencia: string): string {
  const m = Number(competencia.slice(5, 7));
  return m >= 1 && m <= 12 ? MESES[m - 1] : "";
}

/** O nome com maiúscula, para começar uma frase. */
export function nomeDoMesEmMaiuscula(competencia: string): string {
  const nome = nomeDoMes(competencia);
  return nome ? nome[0].toUpperCase() + nome.slice(1) : "";
}

/**
 * As `quantos` competências que acabam em `mesAtual`, da mais antiga para a mais
 * recente. Com 6, são os 5 meses fechados mais o mês em curso.
 */
export function competenciasAte(mesAtual: string, quantos: number): string[] {
  const ano = Number(mesAtual.slice(0, 4));
  const mes = Number(mesAtual.slice(5, 7));
  if (!ano || !mes || quantos < 1) return [];
  const lista: string[] = [];
  for (let i = quantos - 1; i >= 0; i--) {
    // Meses "a mais" no Date rodam o ano sozinhos: mês 0 de 2027 é dezembro de 2026.
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    lista.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return lista;
}

/**
 * As colunas do gráfico, com a escala já feita.
 *
 * A escala é a mesma para todas as colunas e vai do maior valor ao menor,
 * incluindo sempre o zero: com resultados todos positivos as colunas assentam no
 * fundo; com um mês negativo abre-se espaço por baixo da linha do zero e a
 * coluna desse mês pendura-se dela. Assim um mês mau vê-se logo pela direção.
 */
export function graficoDoResultado(meses: readonly MesDoResultado[], mesAtual: string): GraficoDoResultado {
  const valores = meses.map((m) => m.resultado);
  const topo = Math.max(0, ...valores);
  const fundo = Math.min(0, ...valores);
  const amplitude = topo - fundo;
  const zero = amplitude > 0 ? arredondar((-fundo / amplitude) * 100) : 0;

  const colunas = meses.map((m) => {
    const positivo = m.resultado >= 0;
    let altura = amplitude > 0 ? arredondar((Math.abs(m.resultado) / amplitude) * 100) : 0;
    if (m.resultado !== 0 && altura < ALTURA_MINIMA) altura = ALTURA_MINIMA;
    return {
      competencia: m.competencia,
      nome: nomeDoMes(m.competencia),
      curto: MESES_CURTOS[Number(m.competencia.slice(5, 7)) - 1] ?? "",
      resultado: m.resultado,
      altura,
      base: positivo ? zero : arredondar(Math.max(0, zero - altura)),
      em_curso: m.competencia === mesAtual,
    };
  });

  return { colunas, zero };
}

/** O último mês fechado do gráfico, comparado com o mês antes dele. */
export interface UltimoFechado {
  competencia: string;
  /** "Agosto" — com maiúscula, para abrir a frase. */
  nome: string;
  resultado: number;
  /** Quanto mudou face ao mês anterior. Null quando não há mês anterior no gráfico. */
  variacao: number | null;
  /** A mesma variação em %. Null quando o mês anterior foi 0 (não se divide por zero). */
  percentagem: number | null;
  /** "julho" — o mês com que se compara. */
  nome_anterior: string;
}

/**
 * O mês fechado mais recente (o último antes do mês em curso) e a comparação com
 * o anterior: é a frase que se lê por cima do gráfico.
 *
 * Null quando não há nenhum mês fechado no gráfico — aí não há nada a dizer.
 */
export function ultimoFechado(meses: readonly MesDoResultado[], mesAtual: string): UltimoFechado | null {
  const fechados = meses.filter((m) => m.competencia < mesAtual);
  const ultimo = fechados[fechados.length - 1];
  if (!ultimo) return null;
  const anterior = fechados[fechados.length - 2] ?? null;
  const variacao = anterior ? arredondar(ultimo.resultado - anterior.resultado) : null;
  const percentagem =
    anterior && anterior.resultado !== 0 && variacao !== null
      ? Math.round((variacao / Math.abs(anterior.resultado)) * 100)
      : null;
  return {
    competencia: ultimo.competencia,
    nome: nomeDoMesEmMaiuscula(ultimo.competencia),
    resultado: ultimo.resultado,
    variacao,
    percentagem,
    nome_anterior: anterior ? nomeDoMes(anterior.competencia) : "",
  };
}

/** Uma casa decimal chega para uma altura em % — e não enche o HTML de dígitos. */
function arredondar(n: number): number {
  // O "+ 0" tira o zero negativo, que no HTML saía como "-0%".
  return Math.round(n * 10) / 10 + 0;
}
