import { requireAdmin } from "@/lib/dal";
import { listarProcedimentos } from "@/actions/procedimentoActions";
import ProcedimentosList from "./ProcedimentosList";

export default async function ProcedimentosPage() {
  await requireAdmin();
  const procedimentos = await listarProcedimentos();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Procedimentos</h1>
        <p className="mt-1 text-slate-600">
          Regras automáticas: quando um evento acontece (coima, portagem, nova apólice…), o sistema
          comunica ou alerta — em modo manual (confirmas) ou automático.
        </p>
      </div>
      <ProcedimentosList inicial={procedimentos} />
    </div>
  );
}
