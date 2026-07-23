import { normalizarMatricula } from "@/lib/faturas";

/**
 * Associação de matrículas por SIMILARIDADE, para tolerar erros de OCR
 * (ex.: "63-XV-1B" lido em vez de "63-XV-18"). Cascata deliberadamente
 * conservadora — um falso positivo imputa a despesa ao dono errado:
 *   1) igualdade exata da matrícula normalizada;
 *   2) uma única troca plausível letra↔dígito (candidato único).
 * NÃO usa distância genérica (Levenshtein): duas matrículas reais distintas a
 * um caractere não devem casar. Casos mais raros escolhem-se à mão. Nunca grava
 * sozinho — o resultado é sempre confirmado pelo admin.
 */

// Trocas típicas do OCR: letra → dígito parecido.
const CONFUSOES: Record<string, string> = {
  O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6", A: "4", T: "7",
};

/**
 * Verdadeiro só se `a` e `b` diferem em EXATAMENTE uma posição e essa diferença
 * é uma confusão plausível de OCR (um lado é a letra, o outro o dígito parecido).
 * Ao contrário de colapsar ambos os lados, isto NÃO funde duas matrículas válidas
 * distintas (ex.: "AO..." vs "AQ..." — duas letras — deixa de casar).
 */
function umaTrocaOCR(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (++difs > 1) return false;
    const aLetraBDigito = CONFUSOES[a[i]] === b[i];
    const bLetraADigito = CONFUSOES[b[i]] === a[i];
    if (!aLetraBDigito && !bLetraADigito) return false;
  }
  return difs === 1;
}

export type MotivoMatch = "exata" | "ocr";

export interface CandidatoMoto {
  id: string;
  matricula: string | null;
  matricula_norm?: string | null;
}

export interface ResultadoMatch {
  candidato: CandidatoMoto;
  motivo: MotivoMatch;
  distancia: number;
}

/** Encontra o melhor veículo para uma matrícula lida, ou null se ambíguo. */
export function encontrarMatricula(
  lida: string | null,
  candidatos: CandidatoMoto[],
): ResultadoMatch | null {
  const alvo = normalizarMatricula(lida);
  if (alvo.length < 5) return null;

  const norm = candidatos
    .map((c) => ({ c, n: normalizarMatricula(c.matricula_norm ?? c.matricula) }))
    .filter((x) => x.n.length >= 5);

  // 1) Igualdade exata.
  const exata = norm.find((x) => x.n === alvo);
  if (exata) return { candidato: exata.c, motivo: "exata", distancia: 0 };

  // 2) Uma única troca plausível letra↔dígito; aceitar só se candidato único.
  const porOcr = norm.filter((x) => umaTrocaOCR(alvo, x.n));
  if (porOcr.length === 1) return { candidato: porOcr[0].c, motivo: "ocr", distancia: 1 };

  return null;
}
