/**
 * O nome com que um motorista é criado antes de estar confirmado (lead, registo
 * por link, etc.). NÃO é um nome real — é um marcador de "ainda por preencher".
 */
export const NOME_PLACEHOLDER = "Motorista (por confirmar)";

/** True quando o "nome" é o placeholder (ou vazio) — não um nome confirmado. */
export function ehNomePlaceholder(nome: string | null | undefined): boolean {
  const n = (nome ?? "").trim();
  return n === "" || /por confirmar/i.test(n);
}

/**
 * Valor inicial de um campo de nome num formulário: vazio quando o guardado é o
 * placeholder, para o campo `required` obrigar a introduzir um nome real (a IA
 * ao ler o documento, ou a pessoa à mão) em vez de reenviar o placeholder.
 */
export function nomeInicial(nome: string | null | undefined): string {
  return ehNomePlaceholder(nome) ? "" : (nome ?? "").trim();
}
