import type { Moto, Periodo } from "@/types/db";
import type { Dicionario, Locale } from "@/lib/i18n";

/**
 * Ponto único de verdade sobre períodos e preços.
 *
 * A regra que atravessa todo o projeto: um preço a `null` significa que a mota
 * não é oferecida nesse período. É a ausência de valor que decide o que
 * aparece — não há nenhum campo separado a dizer "mostrar/esconder".
 */

export const PERIODOS: Periodo[] = ["dia", "semana", "mes"];

export interface RotulosPeriodo {
  /** "dia" — como aparece a seguir ao preço: 30 € / dia */
  unidade: string;
  /** "2 dias" — plural para durações */
  plural: string;
  /** "Diária" — para títulos e etiquetas */
  nome: string;
}

export type RotulosPorPeriodo = Record<Periodo, RotulosPeriodo>;

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

/** Rótulos traduzidos, extraídos do dicionário do idioma activo. */
export function rotulosDe(dic: Dicionario): RotulosPorPeriodo {
  return dic.periodos;
}

/**
 * Preços efectivamente oferecidos, sempre pela mesma ordem (dia → semana → mês),
 * para o catálogo não trocar a apresentação de mota para mota.
 */
export function precosDisponiveis(
  moto: Moto,
  rotulos: RotulosPorPeriodo,
): PrecoDisponivel[] {
  return PERIODOS.flatMap((periodo) => {
    const valor = moto[COLUNAS[periodo]];

    if (valor === null || valor === undefined || valor === "") {
      return [];
    }

    return [{ periodo, valor: String(valor), rotulos: rotulos[periodo] }];
  });
}

/** Formata um valor como 220 € ou 27,50 € — sem cêntimos quando são zero. */
export function formatarPreco(valor: string | number, locale: Locale = "pt"): string {
  const numero = typeof valor === "number" ? valor : Number(valor);

  if (Number.isNaN(numero)) {
    return `${valor} €`;
  }

  return new Intl.NumberFormat(locale === "en" ? "en-IE" : "pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(numero) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numero);
}

/** "3 semanas" / "1 semana" */
export function duracaoPorExtenso(
  duracao: number,
  periodo: Periodo,
  rotulos: RotulosPorPeriodo,
): string {
  const { unidade, plural } = rotulos[periodo];
  return `${duracao} ${duracao === 1 ? unidade : plural}`;
}
