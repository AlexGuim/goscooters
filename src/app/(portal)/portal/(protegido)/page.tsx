import { requirePartner } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ESTADO_ROTULO: Record<string, string> = {
  disponivel: "Disponível",
  ocupado: "Alugada",
  manutencao: "Em manutenção",
  inativo: "Inativa",
};

export default async function PortalDashboard() {
  // O âmbito vem SEMPRE da sessão (proprietarioId), nunca do URL. A query filtra
  // por proprietario_id — regra de ouro do isolamento entre parceiros.
  const { proprietarioId, nome } = await requirePartner();

  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo, estado_operacional")
    .eq("proprietario_id", proprietarioId)
    .order("matricula");

  const lista = motos ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          Olá, {nome.split(" ")[0]}
        </h1>
        <p className="mt-1 text-slate-600">
          Aqui vais acompanhar as tuas motos, os acertos e o histórico de cada ativo.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          As minhas motos ({lista.length})
        </h2>
        {lista.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
            Ainda não há motos associadas a ti.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lista.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5"
              >
                <div>
                  <p className="font-mono font-semibold text-slate-950">
                    {m.matricula ?? "—"}
                  </p>
                  <p className="text-sm text-slate-500">{m.modelo}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {ESTADO_ROTULO[m.estado_operacional] ?? m.estado_operacional}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="rounded-3xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
        Em breve: os teus <strong>acertos mensais</strong> com extrato, e o{" "}
        <strong>histórico financeiro</strong> de cada moto (receita, custos e retorno).
      </p>
    </div>
  );
}
