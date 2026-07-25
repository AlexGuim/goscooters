import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Notificacao } from "@/types/db";
import NotificacoesList from "./NotificacoesList";

export default async function NotificacoesPage() {
  await requireAdmin();

  // Só as por resolver (nova + lida); as 'feita' saem da caixa.
  const { data } = await supabaseAdmin
    .from("notificacao")
    .select("*")
    .neq("estado", "feita")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Notificações</h1>
        <p className="mt-1 text-slate-600">O que precisa da tua atenção — a próxima ação de cada jornada.</p>
      </div>
      <NotificacoesList inicial={(data ?? []) as Notificacao[]} />
    </div>
  );
}
