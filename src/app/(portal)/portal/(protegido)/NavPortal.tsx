"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/estilos";

// Despesas e Acertos vivem DENTRO de Financeiro (ver SubNavFinanceiro), por isso
// "Financeiro" fica ativo em toda essa área.
const LINKS = [
  { href: "/portal", rotulo: "Início", match: (p: string) => p === "/portal" },
  {
    href: "/portal/financeiro",
    rotulo: "Financeiro",
    match: (p: string) =>
      p.startsWith("/portal/financeiro") ||
      p.startsWith("/portal/despesas") ||
      p.startsWith("/portal/acertos"),
  },
  { href: "/portal/palavra-passe", rotulo: "Palavra-passe", match: (p: string) => p.startsWith("/portal/palavra-passe") },
];

/** Navegação do portal com o separador ativo destacado (pill ink). */
export default function NavPortal() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {LINKS.map((l) => {
        const ativo = l.match(pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cx(
              "rounded-lg px-3 py-1.5 transition",
              ativo
                ? "bg-slate-950 text-slate-50"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
