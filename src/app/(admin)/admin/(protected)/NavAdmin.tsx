"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Ordem por uso diário: a cobrança é o ecrã que se abre todos os dias.
const LINKS: { href: string; rotulo: string }[] = [
  { href: "/admin/cobrancas", rotulo: "Cobrança" },
  { href: "/admin/contratos", rotulo: "Contratos" },
  { href: "/admin/motas", rotulo: "Frota" },
  { href: "/admin/motoristas", rotulo: "Motoristas" },
  { href: "/admin/proprietarios", rotulo: "Proprietários" },
  { href: "/admin/despesas", rotulo: "Despesas" },
  { href: "/admin/acertos", rotulo: "Acertos" },
  { href: "/admin/pedidos", rotulo: "Pedidos" },
];

export default function NavAdmin() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-2">
      {LINKS.map((l) => {
        const ativo = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={ativo ? "page" : undefined}
            className={`text-sm font-medium transition ${
              ativo
                ? "text-emerald-600"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
