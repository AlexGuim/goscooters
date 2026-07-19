import type pt from "@/dictionaries/pt.json";

export const LOCALES = ["pt", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_PADRAO: Locale = "pt";

/** O dicionário português é a referência: qualquer outro tem de ter as mesmas chaves. */
export type Dicionario = typeof pt;

export const NOMES_LOCALE: Record<Locale, string> = {
  pt: "Português",
  en: "English",
};

/** Usado no atributo lang do <html> e nas etiquetas hreflang. */
export const TAGS_HTML: Record<Locale, string> = {
  pt: "pt-PT",
  en: "en",
};

export function isLocale(valor: string | undefined): valor is Locale {
  return LOCALES.includes(valor as Locale);
}

/**
 * Escolhe o idioma a partir do cabeçalho Accept-Language do browser.
 * Sem correspondência, fica o português.
 */
export function negociarLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return LOCALE_PADRAO;

  const preferencias = acceptLanguage
    .split(",")
    .map((parte) => {
      const [tag, q] = parte.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of preferencias) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }

  return LOCALE_PADRAO;
}

/** Substitui marcadores {chave} numa frase do dicionário. */
export function preencher(
  texto: string,
  valores: Record<string, string | number>,
): string {
  return texto.replace(/\{(\w+)\}/g, (_, chave: string) =>
    chave in valores ? String(valores[chave]) : `{${chave}}`,
  );
}
