import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

/**
 * Faixa de destaque ("hero") com a linguagem "Asfalto & Volt": fundo asfalto,
 * canto cortado (speed-cut), brilho lima subtil e a marca em chip lima à direita.
 * Partilhado entre a dashboard do admin e o portal do parceiro — a mesma cara.
 */
export function HeroMarca({
  eyebrow,
  titulo,
  subtitulo,
  acao,
}: {
  eyebrow?: string;
  titulo: string;
  subtitulo?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <section className="speed-cut relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 sm:px-8 sm:py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-emerald-500/15 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-500">{eyebrow}</p>
          )}
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {titulo}
          </h1>
          {subtitulo && <p className="mt-2 text-sm text-slate-300">{subtitulo}</p>}
          {acao && <div className="mt-4">{acao}</div>}
        </div>
        <Logo chip wordmark={false} tamanho="lg" className="hidden sm:inline-flex" />
      </div>
    </section>
  );
}
