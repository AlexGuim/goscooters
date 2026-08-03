"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/estilos";

const TABS = [
  { href: "/portal/financeiro", rotulo: "Resumo", match: (p: string) => p === "/portal/financeiro" },
  { href: "/portal/despesas", rotulo: "Despesas", match: (p: string) => p.startsWith("/portal/despesas") },
  { href: "/portal/acertos", rotulo: "Acertos", match: (p: string) => p.startsWith("/portal/acertos") },
];

/** Sub-navegação da área Financeiro: Resumo · Despesas · Acertos. */
export default function SubNavFinanceiro() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
      {TABS.map((t) => {
        const ativo = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "flex-1 rounded-xl px-3 py-1.5 text-center transition",
              ativo ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {t.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
