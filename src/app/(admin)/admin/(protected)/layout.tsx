import NavAdmin from "./NavAdmin";
import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import LogoutButton from "./LogoutButton";
import { Logo } from "@/components/Logo";

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

  // Contagem de notificações por ler para o badge (tolerante se fase5 não migrada).
  let naoLidas = 0;
  const { count } = await supabaseAdmin
    .from("notificacao")
    .select("id", { count: "exact", head: true })
    .eq("estado", "nova");
  naoLidas = count ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Logo />
              <div className="hidden border-l border-slate-200 pl-3 sm:block">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Administração</p>
                <p className="text-xs text-slate-600">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <NavAdmin naoLidas={naoLidas} />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
