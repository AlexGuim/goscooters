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
          <SairPortal />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
