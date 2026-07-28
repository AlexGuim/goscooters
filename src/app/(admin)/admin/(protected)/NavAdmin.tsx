"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Menu por ÁREAS (deixa de ser uma lista plana de abas): Início e Notificações
// ficam diretos; o resto agrupa-se em categorias com menu suspenso.
// Nova arquitetura de informação: agrupar pela cabeça do negócio.
//  Aluguer = quem alugo · Frota = o que tenho · Financeiro = quanto ganho ·
//  Definições = o que automatizo. (Motoristas sai da Frota; Cobrança junta-se ao
//  dinheiro; "Financeiro" (página) passa a "Resultado" para não colidir com o grupo.)
const GRUPOS: { cat: string; itens: { href: string; rotulo: string }[] }[] = [
  {
    cat: "Aluguer",
    itens: [
      { href: "/admin/pedidos", rotulo: "Pedidos" },
      { href: "/admin/motoristas", rotulo: "Motoristas" },
      { href: "/admin/contratos", rotulo: "Contratos" },
    ],
  },
  {
    cat: "Frota",
    itens: [
      { href: "/admin/motas", rotulo: "Motas" },
      { href: "/admin/proprietarios", rotulo: "Proprietários" },
    ],
  },
  {
    cat: "Financeiro",
    itens: [
      { href: "/admin/cobrancas", rotulo: "Cobrança" },
      { href: "/admin/despesas", rotulo: "Despesas" },
      { href: "/admin/acertos", rotulo: "Acertos" },
      { href: "/admin/financeiro", rotulo: "Resultado" },
    ],
  },
  {
    cat: "Definições",
    itens: [
      { href: "/admin/procedimentos", rotulo: "Procedimentos" },
      { href: "/admin/regras", rotulo: "Regras do aluguer" },
    ],
  },
];

export default function NavAdmin({ naoLidas = 0 }: { naoLidas?: number }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(null);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const ativoDe = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const cls = (ativo: boolean) =>
    `text-sm font-medium transition ${ativo ? "text-emerald-600" : "text-slate-600 hover:text-slate-950"}`;

  return (
    <nav ref={ref} className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Link href="/admin" aria-current={pathname === "/admin" ? "page" : undefined} className={cls(pathname === "/admin")}>
        Início
      </Link>

      <Link
        href="/admin/notificacoes"
        aria-current={ativoDe("/admin/notificacoes") ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 ${cls(ativoDe("/admin/notificacoes"))}`}
      >
        Notificações
        {naoLidas > 0 && (
          <span className="inline-grid min-w-[18px] place-items-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold leading-[18px] text-white">
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        )}
      </Link>

      <Link
        href="/admin/assistente"
        aria-current={ativoDe("/admin/assistente") ? "page" : undefined}
        className={cls(ativoDe("/admin/assistente"))}
      >
        Assistente
      </Link>

      {GRUPOS.map((g) => {
        const catAtiva = g.itens.some((i) => ativoDe(i.href));
        const estaAberto = aberto === g.cat;
        return (
          <div key={g.cat} className="relative">
            <button
              type="button"
              onClick={() => setAberto(estaAberto ? null : g.cat)}
              aria-haspopup="menu"
              aria-expanded={estaAberto}
              className={`inline-flex items-center gap-1 ${cls(catAtiva)}`}
            >
              {g.cat}
              <span className={`text-[10px] transition-transform ${estaAberto ? "rotate-180" : ""}`} aria-hidden>
                ▾
              </span>
            </button>
            {estaAberto && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 min-w-[190px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-lg"
              >
                {g.itens.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    role="menuitem"
                    onClick={() => setAberto(null)}
                    className={`block rounded-xl px-3 py-2 text-sm font-medium transition ${
                      ativoDe(i.href) ? "bg-emerald-50 text-emerald-700" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {i.rotulo}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
