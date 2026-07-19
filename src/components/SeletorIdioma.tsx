"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LOCALES, type Locale } from "@/lib/i18n";

/**
 * Troca de idioma mantendo a página onde o utilizador está.
 *
 * Reescreve apenas o primeiro segmento do caminho, para quem estiver a ver uma
 * mota continuar a vê-la depois de mudar de língua — em vez de ser atirado para
 * a página inicial.
 */
export default function SeletorIdioma({
  locale,
  rotulo,
}: {
  locale: Locale;
  rotulo: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const caminhoPara = (destino: Locale) => {
    const segmentos = pathname.split("/").filter(Boolean);
    segmentos[0] = destino;
    const query = searchParams.toString();
    return `/${segmentos.join("/")}${query ? `?${query}` : ""}`;
  };

  return (
    <div className="flex items-center gap-1" aria-label={rotulo}>
      {LOCALES.map((l) => {
        const activo = l === locale;

        return (
          <Link
            key={l}
            href={caminhoPara(l)}
            hrefLang={l}
            aria-current={activo ? "true" : undefined}
            className={`rounded-full px-2 py-1 text-xs font-bold uppercase transition ${
              activo
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
          >
            {l}
          </Link>
        );
      })}
    </div>
  );
}
