import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { Moto } from "@/types/db";
import MotosList from "./MotosList";

async function getMotas(): Promise<Moto[]> {
  const { data, error } = await supabaseAdmin
    .from("moto")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

export default async function MotosAdminPage() {
  const motas = await getMotas();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">Motas</h1>
          <p className="mt-1 text-slate-600">Gestão do catálogo</p>
        </div>
        <button className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
          + Nova mota
        </button>
      </div>

      <MotosList initialMotas={motas} />
    </div>
  );
}
