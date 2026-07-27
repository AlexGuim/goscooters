import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import AluguelWizard from "./AluguelWizard";

export default async function NovoAluguelPage() {
  await requireAdmin();

  const [{ data: motoristas }, { data: motos }] = await Promise.all([
    supabaseAdmin.from("motorista").select("id, nome, telefone").order("nome"),
    supabaseAdmin
      .from("moto")
      .select("id, matricula, modelo, proprietario_id, estado_operacional")
      .order("matricula"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Criar aluguer</h1>
        <p className="mt-1 text-slate-600">Do motorista à entrega da mota, num só fluxo.</p>
      </div>
      <AluguelWizard motoristas={motoristas ?? []} motos={motos ?? []} />
    </div>
  );
}
