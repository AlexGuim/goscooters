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
  { href: "/admin/financeiro", rotulo: "Financeiro" },
  { href: "/admin/pedidos", rotulo: "Pedidos" },
  { href: "/admin/regras", rotulo: "Regras" },
];

export default function NavAdmin({ naoLidas = 0 }: { naoLidas?: number }) {
  const pathname = usePathname();
  const ativoDe = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Link
        href="/admin/notificacoes"
        aria-current={ativoDe("/admin/notificacoes") ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 text-sm font-medium transition ${
          ativoDe("/admin/notificacoes") ? "text-emerald-600" : "text-slate-600 hover:text-slate-950"
        }`}
      >
        Notificações
        {naoLidas > 0 && (
          <span className="inline-grid min-w-[18px] place-items-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold leading-[18px] text-white">
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </Link>
      {LINKS.map((l) => {
        const ativo = ativoDe(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={ativo ? "page" : undefined}
            className={`text-sm font-medium transition ${
              ativo ? "text-emerald-600" : "text-slate-600 hover:text-slate-950"
            }`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
