import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Avaliacao, Motorista } from "@/types/db";
import MotoristasList, { type MotoristaComAvaliacoes } from "./MotoristasList";

async function getMotoristas(): Promise<MotoristaComAvaliacoes[]> {
  const { data, error } = await supabaseAdmin
    .from("motorista")
    .select("*, avaliacao(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return (data ?? []).map((m) => {
    const { avaliacao, ...motorista } = m as Motorista & { avaliacao: Avaliacao[] };
    const avaliacoes = [...(avaliacao ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    return { ...(motorista as Motorista), avaliacoes };
  });
}

export default async function MotoristasAdminPage() {
  await requireAdmin();
  const motoristas = await getMotoristas();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Motoristas</h1>
        <p className="mt-1 text-slate-600">
          Registo privado do histórico e da conduta dos motoristas a quem alugaste.
        </p>
      </div>

      <MotoristasList inicial={motoristas} />
    </div>
  );
}
