"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./estilos";

/**
 * Menu de overflow (⋯) para linhas de ação densas. Recebe uma lista de ações
 * secundárias e agrupa-as num popover — as 1-2 ações primárias ficam de fora,
 * visíveis como Botão. Resolve a poluição da "linha de ações" sem esconder nada.
 */
export interface AcaoMenu {
  rotulo: string;
  onClick?: () => void;
  href?: string;
  perigo?: boolean; // vermelho (ex.: Terminar)
  oculta?: boolean; // não aplicável a este estado
}

export function AcoesMenu({ acoes, alinhar = "right" }: { acoes: AcaoMenu[]; alinhar?: "right" | "left" }) {
  const itens = acoes.filter((a) => !a.oculta);
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  if (!itens.length) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Mais ações"
        className="inline-grid h-9 w-9 place-items-center rounded-2xl border border-slate-200 text-lg leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ⋯
      </button>
      {aberto && (
        <div
          role="menu"
          className={cx(
            "absolute top-full z-40 mt-2 min-w-[190px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg",
            alinhar === "right" ? "right-0" : "left-0",
          )}
        >
          {itens.map((a, i) => {
            const cls = cx(
              "block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition",
              a.perigo ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
            );
            return a.href ? (
              <a key={i} href={a.href} role="menuitem" onClick={() => setAberto(false)} className={cls}>
                {a.rotulo}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAberto(false);
                  a.onClick?.();
                }}
                className={cls}
              >
                {a.rotulo}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
