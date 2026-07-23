import type { DespesaCategoria } from "@/types/db";

/**
 * Interpretação de faturas a partir do TEXTO já extraído (sem IA, sem custo).
 *
 * Funciona bem em faturas geradas por software (PDF com camada de texto). As
 * heurísticas são deliberadamente conservadoras: preferem devolver `null` a
 * adivinhar mal — o admin confirma/corrige tudo antes de gravar.
 */

export interface FaturaCampos {
  matricula: string | null;
  data: string | null; // ISO AAAA-MM-DD
  data_vencimento: string | null; // ISO
  fornecedor: string | null;
  referencia: string | null;
  descricao: string | null;
  valor: string | null; // "5.00"
  km: number | null;
  proxima_troca: string | null; // texto livre (data ou km), vai para detalhe
  categoria: DespesaCategoria;
}

/** Matrícula normalizada: maiúsculas, só letras e dígitos. */
export function normalizarMatricula(m: string | null | undefined): string {
  return (m ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "1.234,56" ou "5,00" ou "5.00" → "1234.56" / "5.00". */
function numeroPT(s: string): string | null {
  const limpo = s.trim().replace(/\s|€/g, "");
  if (!limpo) return null;
  // Se tem vírgula, é o separador decimal (PT). Os pontos são milhares.
  const norm = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(norm);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** dd/mm/aaaa → aaaa-mm-dd. */
function dataISO(s: string | undefined | null): string | null {
  const m = (s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function primeiro(texto: string, re: RegExp): string | null {
  const m = texto.match(re);
  return m ? m[1].trim() : null;
}

// Um par de matrícula é duas letras OU dois dígitos. Exige-se separador entre os
// pares (o formato escrito, "63-XV-18") para não confundir com referências como
// "Pr2026/3461", que colariam PR-20-26.
const PAR = "(?:[A-Z]{2}|\\d{2})";
const MATRICULA_RE = new RegExp(`\\b(${PAR})[-\\s](${PAR})[-\\s](${PAR})\\b`, "g");

/** Extrai a matrícula: prefere as que misturam letras e dígitos (plausíveis). */
function acharMatricula(texto: string): string | null {
  const t = texto.toUpperCase();
  let m: RegExpExecArray | null;
  let candidata: string | null = null;
  MATRICULA_RE.lastIndex = 0;
  while ((m = MATRICULA_RE.exec(t))) {
    const grupos = [m[1], m[2], m[3]];
    const temLetra = grupos.some((g) => /[A-Z]/.test(g));
    const temDigito = grupos.some((g) => /\d/.test(g));
    if (temLetra && temDigito) {
      // Formato válido de matrícula portuguesa (mistura letras e números).
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    // Guarda uma só-dígitos como último recurso (ex.: matrículas antigas).
    if (!candidata && temDigito) candidata = `${m[1]}-${m[2]}-${m[3]}`;
  }
  return candidata;
}

function acharCategoria(texto: string): DespesaCategoria {
  const t = texto.toLowerCase();
  if (/\b(seguro|ap[óo]lice)\b/.test(t)) return "seguro";
  if (/\b(portagem|via\s?verde)\b/.test(t)) return "portagem";
  if (/\b(coima|multa|contraorden)/.test(t)) return "coima";
  if (/\b(gps|localizador|rastreador)\b/.test(t)) return "gps";
  if (/[óo]leo|manuten|revis|pneu|trav[ãa]|filtro|bateria|corrente|subst|repara/.test(t))
    return "manutencao";
  return "outro";
}

/** Descrição do serviço: a linha mais parecida com um item de trabalho. */
function acharDescricao(texto: string): string | null {
  const linhas = texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const chave = /([óo]leo|subst|pneu|revis|trav[ãa]|filtro|bateria|corrente|manuten|repara)/i;
  for (const l of linhas) {
    if (chave.test(l) && l.length >= 6 && l.length <= 120 && /[a-zA-Z]/.test(l)) {
      // Remove preços/percentagens que às vezes ficam colados à linha.
      return l.replace(/\s*\d+[.,]\d{2}\s*€?.*$/, "").replace(/\s+/g, " ").trim() || l;
    }
  }
  return null;
}

export function interpretarFatura(textoBruto: string): FaturaCampos {
  const texto = textoBruto.replace(/\r/g, "");

  // Valor: preferir "Total do documento", depois "Total", senão o maior € do doc.
  let valor =
    numeroPT(primeiro(texto, /total\s+do\s+documento\s*:?\s*€?\s*([\d.,]+)/i) ?? "") ??
    numeroPT(primeiro(texto, /\btotal\s*:?\s*€?\s*([\d.,]+)/i) ?? "");
  if (!valor) {
    const valores = [...texto.matchAll(/([\d.]{1,9},\d{2})\s*€/g)]
      .map((x) => Number(numeroPT(x[1]) ?? "0"))
      .filter((n) => n > 0);
    if (valores.length) valor = Math.max(...valores).toFixed(2);
  }

  // KM: "KM ENTRADA: 141658" ou genérico "KM: 141.658".
  const kmTexto =
    primeiro(texto, /km\s*(?:de\s*)?entrada\s*:?\s*([\d.\s]{3,})/i) ??
    primeiro(texto, /\bkm\b[^:\n]*:?\s*([\d.\s]{3,})/i);
  const km = kmTexto ? Number(kmTexto.replace(/[.\s]/g, "")) || null : null;

  return {
    matricula: acharMatricula(texto),
    data:
      dataISO(primeiro(texto, /\bdata\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)) ??
      dataISO(texto),
    data_vencimento: dataISO(
      primeiro(texto, /vencimento\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i),
    ),
    fornecedor: primeiro(texto, /^(.*\b(?:LDA|Lda|Unipessoal|S\.?A\.?)\b.*)$/m),
    referencia:
      primeiro(texto, /processo\s*n[ºo°.\s]*:?\s*([A-Za-z0-9/\-]+)/i) ??
      primeiro(texto, /\b(Pr\d{3,4}\/\d+)\b/i) ??
      primeiro(texto, /(?:fatura|recibo|documento)\s*n[ºo°.\s]*:?\s*([A-Za-z0-9/\-]+)/i),
    descricao: acharDescricao(texto),
    valor,
    km,
    proxima_troca: primeiro(
      texto,
      /pr[óo]xima\s+troca\s+de\s+[óo]leo\s*:?\s*([\d/.\sA-Za-z]+?)(?:\n|$)/i,
    ),
    categoria: acharCategoria(texto),
  };
}
