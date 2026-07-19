import "server-only";

import type { Dicionario, Locale } from "@/lib/i18n";

/**
 * Carrega o dicionário do idioma. As importações são dinâmicas de propósito:
 * só o idioma pedido vai parar ao bundle de cada pedido.
 */
const dicionarios = {
  pt: () => import("@/dictionaries/pt.json").then((m) => m.default),
  en: () => import("@/dictionaries/en.json").then((m) => m.default),
} satisfies Record<Locale, () => Promise<Dicionario>>;

export async function getDicionario(locale: Locale): Promise<Dicionario> {
  return dicionarios[locale]();
}
