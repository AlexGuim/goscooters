import { Suspense } from "react";
import Link from "next/link";
import SeletorIdioma from "./SeletorIdioma";
import type { Dicionario, Locale } from "@/lib/i18n";

/**
 * Cabeçalho do site público.
 *
 * A marca é composta tipograficamente em vez de usar Logo_goscooters.png: esse
 * ficheiro tem fundo cinzento opaco e formato quadrado, o que num cabeçalho
 * apareceria como uma caixa cinza sobre o escuro.
 */
export default function Header({
  locale,
  dic,
  whatsappNumber,
}: {
  locale: Locale;
  dic: Dicionario;
  whatsappNumber: string;
}) {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link href={`/${locale}`} className="flex items-center gap-2">
          <span className="text-xl font-extrabold uppercase italic tracking-tight text-white sm:text-2xl">
            <span className="text-emerald-500">Go</span>Scooters
          </span>
          <span className="hidden rounded-full border border-white/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/70 sm:inline">
            Lisboa
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-5">
          <Link
            className="hidden text-sm font-semibold uppercase tracking-wide text-white/80 transition hover:text-white sm:inline"
            href={`/${locale}#motas`}
          >
            {dic.nav.motas}
          </Link>

          {/* useSearchParams() obriga a fronteira Suspense; isolado aqui, o
              resto do cabeçalho continua a renderizar estaticamente. */}
          <Suspense fallback={<div className="w-14" />}>
            <SeletorIdioma locale={locale} rotulo={dic.nav.idioma} />
          </Suspense>

          <a
            className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-600 sm:px-5 sm:py-2.5 sm:text-sm"
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
          >
            {dic.nav.reservar}
          </a>
        </nav>
      </div>
    </header>
  );
}
