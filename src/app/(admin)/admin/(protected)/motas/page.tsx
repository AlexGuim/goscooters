import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Moto, Proprietario } from "@/types/db";
import MotosList from "./MotosList";

async function getDados(): Promise<{
  motas: Moto[];
  proprietarios: Proprietario[];
}> {
  const [motosRes, donosRes] = await Promise.all([
    supabaseAdmin.from("moto").select("*").order("created_at", { ascending: false }),
    supabaseAdmin.from("proprietario").select("*").order("nome"),
  ]);

  if (motosRes.error) console.error("getDados moto:", motosRes.error);
  if (donosRes.error) console.error("getDados proprietario:", donosRes.error);

  return { motas: motosRes.data ?? [], proprietarios: donosRes.data ?? [] };
}

export default async function MotosAdminPage() {
  await requireAdmin();

  const { motas, proprietarios } = await getDados();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Frota</h1>
        <p className="mt-1 text-slate-600">
          Veículos, donos e o que aparece no catálogo público.
        </p>
      </div>

      <MotosList initialMotas={motas} proprietarios={proprietarios} />
    </div>
  );
}
