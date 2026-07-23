import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import LogoutButton from "./LogoutButton";

/**
 * Layout das páginas protegidas da administração.
 *
 * Server Component: a verificação corre no servidor antes de qualquer HTML sair
 * daqui. A versão anterior fazia a verificação num useEffect do lado do cliente,
 * o que só escondia a interface — os dados já tinham sido enviados.
 *
 * O ecrã de login vive fora deste route group, por isso não há aqui nenhuma
 * excepção por pathname a poder falhar.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">Administração</h1>
              <p className="text-sm text-slate-600">{user.email}</p>
            </div>
            <div className="flex items-center gap-4">
              <nav className="flex gap-6">
                <Link
                  className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
                  href="/admin/motas"
                >
                  Frota
                </Link>
                <Link
                  className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
                  href="/admin/pedidos"
                >
                  Pedidos
                </Link>
                <Link
                  className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
                  href="/admin/motoristas"
                >
                  Motoristas
                </Link>
                <Link
                  className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
                  href="/admin/proprietarios"
                >
                  Proprietários
                </Link>
              </nav>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
