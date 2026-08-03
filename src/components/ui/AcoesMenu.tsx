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
 * ser cortado por um ancestral com `overflow-hidden` (cartões, tabelas). Posição
 * CONSCIENTE DO ESPAÇO: abre para baixo se couber, senão para cima; encosta às
 * margens laterais; e ganha scroll interno se for mais alto que o espaço (nunca
 * corta opções). Fecha ao scroll da PÁGINA/resize para não mostrar posição obsoleta.
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
const ITEM = 44; // altura estimada por item (só para decidir cima vs baixo)
const M = 8; // margem à janela

type Estilo = { left: number; maxHeight: number; top?: number; bottom?: number };

export function AcoesMenu({ acoes, alinhar = "right" }: { acoes: AcaoMenu[]; alinhar?: "right" | "left" }) {
  const itens = acoes.filter((a) => !a.oculta);
  const [aberto, setAberto] = useState(false);
  const [estilo, setEstilo] = useState<Estilo | null>(null);
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
    // Fecha ao scroll da página — MAS não quando o scroll é DENTRO do próprio
    // menu (senão um menu com scroll interno fechava-se ao tentar rolá-lo).
    const aoScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (t && menuRef.current?.contains(t)) return;
      setAberto(false);
    };
    const aoResize = () => setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", aoScroll, true);
    window.addEventListener("resize", aoResize);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", aoScroll, true);
      window.removeEventListener("resize", aoResize);
    };
  }, [aberto]);

  const alternar = () => {
    if (aberto) {
      setAberto(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const menuH = itens.length * ITEM + 12; // estimativa (só para a decisão)
      const espacoAbaixo = vh - r.bottom - M;
      const espacoAcima = r.top - M;

      let left = alinhar === "right" ? r.right - LARGURA : r.left;
      left = Math.min(Math.max(M, Math.round(left)), Math.round(vw - LARGURA - M));

      // Abre para baixo se couber, ou se houver mais espaço em baixo; senão, cima.
      const paraBaixo = menuH <= espacoAbaixo || espacoAbaixo >= espacoAcima;
      setEstilo(
        paraBaixo
          ? { top: Math.round(r.bottom + M), left, maxHeight: Math.max(120, Math.round(espacoAbaixo)) }
          : { bottom: Math.round(vh - r.top + M), left, maxHeight: Math.max(120, Math.round(espacoAcima)) },
      );
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
        estilo &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              left: estilo.left,
              top: estilo.top,
              bottom: estilo.bottom,
              width: LARGURA,
              maxHeight: estilo.maxHeight,
            }}
            className="z-50 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg"
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
