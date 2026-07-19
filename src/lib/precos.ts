import type { Moto, Periodo } from "@/types/db";

/**
 * Ponto único de verdade sobre períodos e preços.
 *
 * A regra que atravessa todo o projeto: um preço a `null` significa que a mota
 * não é oferecida nesse período. É a ausência de valor que decide o que
 * aparece — não há nenhum campo separado a dizer "mostrar/esconder".
 */

export const PERIODOS: Periodo[] = ["dia", "semana", "mes"];

interface RotulosPeriodo {
  /** "dia" — como aparece a seguir ao preço: €30 / dia */
  unidade: string;
  /** "2 dias" — plural para durações */
  plural: string;
  /** "Diária" — para títulos e etiquetas */
  nome: string;
}

export const ROTULOS: Record<Periodo, RotulosPeriodo> = {
  dia: { unidade: "dia", plural: "dias", nome: "Diária" },
  semana: { unidade: "semana", plural: "semanas", nome: "Semanal" },
  mes: { unidade: "mês", plural: "meses", nome: "Mensal" },
};

export interface PrecoDisponivel {
  periodo: Periodo;
  /** Valor tal como vem da base de dados (numeric chega como string). */
  valor: string;
  rotulos: RotulosPeriodo;
}

const COLUNAS: Record<Periodo, keyof Moto> = {
  dia: "preco_dia",
  semana: "preco_semana",
  mes: "preco_mes",
};

/**
 * Preços efectivamente oferecidos, sempre pela mesma ordem (dia → semana → mês),
 * para o catálogo não trocar a apresentação de mota para mota.
 */
export function precosDisponiveis(moto: Moto): PrecoDisponivel[] {
  return PERIODOS.flatMap((periodo) => {
    const valor = moto[COLUNAS[periodo]];

    if (valor === null || valor === undefined || valor === "") {
      return [];
    }

    return [{ periodo, valor: String(valor), rotulos: ROTULOS[periodo] }];
  });
}

/** Formata um valor como €220 ou €27,50 — sem cêntimos quando são zero. */
export function formatarPreco(valor: string | number): string {
  const numero = typeof valor === "number" ? valor : Number(valor);

  if (Number.isNaN(numero)) {
    return `€${valor}`;
  }

  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(numero) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numero);
}

/** "€150 / semana" */
export function precoComUnidade(preco: PrecoDisponivel): string {
  return `${formatarPreco(preco.valor)} / ${preco.rotulos.unidade}`;
}

/** "3 semanas" / "1 semana" */
export function duracaoPorExtenso(duracao: number, periodo: Periodo): string {
  const { unidade, plural } = ROTULOS[periodo];
  return `${duracao} ${duracao === 1 ? unidade : plural}`;
}
