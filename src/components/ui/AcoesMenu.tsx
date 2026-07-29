"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./estilos";

/**
 * Menu de overflow (⋯) para linhas de ação densas. Recebe uma lista de ações
 * secundárias e agrupa-as num popover — as 1-2 ações primárias ficam de fora,
 * visíveis como Botão. Resolve a poluição da "linha de ações" sem esconder nada.
 *
 * O popover é renderizado num PORTAL (document.body) com posição fixa, para não
 * ser cortado por um ancestral com `overflow-hidden` (cartões, tabelas). Fecha ao
 * scroll/resize para nunca mostrar uma posição obsoleta.
 */
export interface AcaoMenu {
  rotulo: string;
  onClick?: () => void;
  href?: string;
  externo?: boolean; // href abre em nova aba (ex.: ver documento)
  perigo?: boolean; // vermelho (ex.: Terminar)
  oculta?: boolean; // não aplicável a este estado
}

const LARGURA = 208; // w-52

export function AcoesMenu({ acoes, alinhar = "right" }: { acoes: AcaoMenu[]; alinhar?: "right" | "left" }) {
  const itens = acoes.filter((a) => !a.oculta);
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    // `true` para apanhar o scroll de qualquer contentor, não só o da janela.
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const alternar = () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = alinhar === "right" ? r.right - LARGURA : r.left;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.round(left)) });
    }
    setAberto(true);
  };

  if (!itens.length) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={alternar}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Mais ações"
        className="inline-grid h-9 w-9 place-items-center rounded-2xl border border-slate-200 text-lg leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
      >
        ⋯
      </button>
      {aberto &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: LARGURA }}
            className="z-50 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg"
          >
            {itens.map((a, i) => {
              const cls = cx(
                "block w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition",
                a.perigo ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
              );
              return a.href ? (
                <a
                  key={i}
                  href={a.href}
                  role="menuitem"
                  onClick={() => setAberto(false)}
                  className={cls}
                  {...(a.externo ? { target: "_blank", rel: "noreferrer" } : {})}
                >
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
          </div>,
          document.body,
        )}
    </>
  );
}
