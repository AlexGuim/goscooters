import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import SairPortal from "./SairPortal";

/**
 * Layout protegido do portal: `requirePartner()` corre no servidor ANTES de
 * emitir qualquer HTML. Sem parceiro válido, redirecciona para /portal/entrar.
 */
export default async function PortalProtegidoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const parceiro = await requirePartner();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-lg font-semibold text-slate-950">GoScooters</p>
            <p className="text-xs text-slate-500">Portal do parceiro · {parceiro.nome}</p>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
              <Link href="/portal" className="hover:text-slate-900">Início</Link>
              <Link href="/portal/acertos" className="hover:text-slate-900">Acertos</Link>
              <Link href="/portal/palavra-passe" className="hover:text-slate-900">Palavra-passe</Link>
            </nav>
            <SairPortal />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
