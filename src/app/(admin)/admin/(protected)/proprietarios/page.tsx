import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Proprietario } from "@/types/db";
import ProprietariosList, { type ProprietarioComContagem } from "./ProprietariosList";

async function getProprietarios(): Promise<ProprietarioComContagem[]> {
  const [{ data: donos }, { data: motos }] = await Promise.all([
    supabaseAdmin.from("proprietario").select("*").order("nome"),
    supabaseAdmin.from("moto").select("proprietario_id"),
  ]);

  const contagem = new Map<string, number>();
  for (const m of motos ?? []) {
    if (m.proprietario_id) {
      contagem.set(m.proprietario_id, (contagem.get(m.proprietario_id) ?? 0) + 1);
    }
  }

  return (donos ?? []).map((d: Proprietario) => ({
    ...d,
    num_veiculos: contagem.get(d.id) ?? 0,
  }));
}

export default async function ProprietariosAdminPage() {
  await requireAdmin();
  const proprietarios = await getProprietarios();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Proprietários</h1>
        <p className="mt-1 text-slate-600">
          Parceiros donos dos veículos e a comissão de cada um.
        </p>
      </div>

      <ProprietariosList inicial={proprietarios} />
    </div>
  );
}
