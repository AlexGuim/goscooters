"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/estilos";

const LINKS = [
  { href: "/portal", rotulo: "Início" },
  { href: "/portal/financeiro", rotulo: "Financeiro" },
  { href: "/portal/despesas", rotulo: "Despesas" },
  { href: "/portal/acertos", rotulo: "Acertos" },
  { href: "/portal/palavra-passe", rotulo: "Palavra-passe" },
];

/** Navegação do portal com o separador ativo destacado (pill ink). */
export default function NavPortal() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {LINKS.map((l) => {
        const ativo = l.href === "/portal" ? pathname === "/portal" : pathname.startsWith(l.href);
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
