"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/estilos";

// "Financeiro" não navega — abre estas 3 opções.
const FINANCEIRO = [
  { href: "/portal/financeiro", rotulo: "Resumo" },
  { href: "/portal/despesas", rotulo: "Despesas" },
  { href: "/portal/acertos", rotulo: "Acertos" },
];

const emFinanceiro = (p: string) =>
  p.startsWith("/portal/financeiro") ||
  p.startsWith("/portal/despesas") ||
  p.startsWith("/portal/acertos");

const pill = (ativo: boolean) =>
  cx(
    "rounded-lg px-3 py-1.5 transition",
    ativo ? "bg-slate-950 text-slate-50" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );

/** Navegação do portal. "Financeiro" é um menu que abre Resumo/Despesas/Acertos. */
export default function NavPortal() {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora. (Ao escolher uma opção, o onClick do link fecha.)
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      <Link href="/portal" className={pill(pathname === "/portal")}>
        Início
      </Link>

      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-haspopup="menu"
          className={cx(pill(emFinanceiro(pathname)), "inline-flex items-center gap-1")}
        >
          Financeiro
          <span className={cx("text-[10px] transition", aberto && "rotate-180")} aria-hidden>
            ▾
          </span>
        </button>
        {aberto && (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          >
            {FINANCEIRO.map((l) => {
              const ativo =
                l.href === "/portal/financeiro"
                  ? pathname === "/portal/financeiro"
                  : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  role="menuitem"
                  onClick={() => setAberto(false)}
                  className={cx(
                    "block px-3 py-2 transition",
                    ativo
                      ? "bg-slate-100 font-semibold text-slate-950"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {l.rotulo}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <Link href="/portal/palavra-passe" className={pill(pathname.startsWith("/portal/palavra-passe"))}>
        Palavra-passe
      </Link>
    </nav>
  );
}
