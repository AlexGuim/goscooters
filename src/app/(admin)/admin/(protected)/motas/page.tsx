import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import { dataDeHojeEmLisboa } from "@/lib/datas";
import { linhasOleoDaFrota, type LinhaOleoFrota } from "@/lib/manutencao/dados";
import type { Moto, Proprietario } from "@/types/db";
import MotasAbas from "./MotasAbas";

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

/**
 * O estado do óleo de cada mota, para a sub-aba Manutenção. Se não conseguir ler,
 * devolve null: a lista dos veículos abre na mesma e só a manutenção avisa.
 */
async function getOleo(motas: Moto[]): Promise<LinhaOleoFrota[] | null> {
  try {
    return await linhasOleoDaFrota(motas, dataDeHojeEmLisboa());
  } catch (erro) {
    console.error("getOleo:", erro);
    return null;
  }
}

export default async function MotosAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  await requireAdmin();

  const [{ aba }, { motas, proprietarios }] = await Promise.all([searchParams, getDados()]);
  const oleo = await getOleo(motas);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Frota</h1>
        <p className="mt-1 text-slate-600">
          Veículos, donos e o que aparece no catálogo público.
        </p>
      </div>

      <MotasAbas
        abaInicial={aba === "manutencao" ? "manutencao" : "motas"}
        motas={motas}
        proprietarios={proprietarios}
        oleo={oleo}
      />
    </div>
  );
}
