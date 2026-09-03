import { requirePartner } from "@/lib/dal";
import { Logo } from "@/components/Logo";
import NavPortal from "./NavPortal";
import SairPortal from "./SairPortal";
import BarraPrevisualizacao from "./BarraPrevisualizacao";

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
      {parceiro.preview && <BarraPrevisualizacao nome={parceiro.nome} />}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="hidden border-l border-slate-200 pl-3 sm:block">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Portal do parceiro
              </p>
              <p className="text-xs text-slate-600">{parceiro.nome}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <NavPortal />
            <SairPortal />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
