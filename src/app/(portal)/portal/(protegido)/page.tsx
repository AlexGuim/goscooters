import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Badge, type BadgeTom } from "@/components/ui";
import { HeroMarca } from "@/components/HeroMarca";
import { saudacaoLisboa } from "@/lib/datas";

const ESTADO: Record<string, { rotulo: string; tom: BadgeTom }> = {
  disponivel: { rotulo: "Disponível", tom: "success" },
  ocupado: { rotulo: "Alugada", tom: "info" },
  manutencao: { rotulo: "Em manutenção", tom: "warning" },
  inativo: { rotulo: "Inativa", tom: "neutral" },
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

  // O estado mostrado é DERIVADO dos contratos em curso — uma moto com contrato
  // ativo/pendente_fecho está ocupada, independentemente do valor guardado em
  // estado_operacional (que pode ficar dessincronizado). Só a manutenção/inativo
  // vêm do campo guardado. Assim o portal nunca diverge dos contratos.
  const ids = lista.map((m) => m.id);
  let ocupadas = new Set<string>();
  if (ids.length > 0) {
    const { data: cts } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("veiculo_id")
      .in("veiculo_id", ids)
      .in("estado", ["ativo", "pendente_fecho"]);
    ocupadas = new Set((cts ?? []).map((c) => c.veiculo_id as string));
  }
  const estadoDe = (m: (typeof lista)[number]): string =>
    ocupadas.has(m.id) ? "ocupado" : m.estado_operacional;

  const alugadas = lista.filter((m) => estadoDe(m) === "ocupado").length;
  const manutencao = lista.filter((m) => estadoDe(m) === "manutencao").length;

  const { data } = saudacaoLisboa();
  const resumo =
    lista.length === 0
      ? "Ainda sem motas associadas a ti."
      : `${lista.length} ${lista.length === 1 ? "mota" : "motas"} · ${alugadas} ${alugadas === 1 ? "alugada" : "alugadas"}`;

  return (
    <div className="space-y-8">
      <HeroMarca eyebrow={data} titulo={`Olá, ${nome.split(" ")[0]}`} subtitulo={resumo} />

      {lista.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Kpi rotulo="Motas" valor={lista.length} />
          <Kpi rotulo="Alugadas" valor={alugadas} destaque />
          <Kpi rotulo="Em manutenção" valor={manutencao} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          As minhas motas ({lista.length})
        </h2>
        {lista.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
            Ainda não há motas associadas a ti.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {lista.map((m) => {
              const est = estadoDe(m);
              const e = ESTADO[est] ?? { rotulo: est, tom: "neutral" as BadgeTom };
              return (
                <Link
                  key={m.id}
                  href={`/portal/motos/${m.id}`}
                  className="group flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-base font-semibold tabular-nums text-slate-950">
                      {m.matricula ?? "—"}
                    </p>
                    <p className="truncate text-sm text-slate-500">{m.modelo}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tom={e.tom}>{e.rotulo}</Badge>
                    <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                      →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <Link
        href="/portal/acertos"
        className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      >
        <div>
          <p className="font-semibold text-slate-950">Acertos mensais</p>
          <p className="text-sm text-slate-500">
            O fecho de cada mês: receita, comissão, despesas e o líquido a receber.
          </p>
        </div>
        <span className="shrink-0 text-slate-300">→</span>
      </Link>
    </div>
  );
}

function Kpi({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-3xl bg-white p-4 shadow-sm ${destaque ? "ring-1 ring-emerald-200" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="mt-1 font-display text-2xl font-extrabold tabular-nums text-slate-950">{valor}</p>
    </div>
  );
}
