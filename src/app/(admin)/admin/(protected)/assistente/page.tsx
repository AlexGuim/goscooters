import { requireAdmin } from "@/lib/dal";
import AssistenteChat from "./AssistenteChat";

export default async function AssistentePage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Assistente</h1>
        <p className="mt-1 text-slate-600">
          Perguntas em linguagem natural sobre a frota — seguros, manutenção, dívidas, quem tinha uma moto.
        </p>
      </div>
      <AssistenteChat />
    </div>
  );
}
