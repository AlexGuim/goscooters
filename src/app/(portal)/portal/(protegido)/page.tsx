import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { motoristaAtualDasMotos, acertosDoParceiro } from "@/lib/portal/queries";
import { Badge, type BadgeTom } from "@/components/ui";
import { HeroMarca } from "@/components/HeroMarca";
import { saudacaoLisboa, dataBR } from "@/lib/datas";
import { formatarPreco } from "@/lib/precos";

function nomeMes(competencia: string): string {
  const [ano, mes] = competencia.slice(0, 7).split("-");
  const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(mes)]} ${ano}`;
}

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

  // Quem está com cada moto agora (só primeiro nome + desde quando; ver query).
  const motoristas = await motoristaAtualDasMotos(proprietarioId, ids);

  // Acerto mais recente (o cartão no fundo mostra-o em vez de só linkar).
  const ultimoAcerto = (await acertosDoParceiro(proprietarioId))[0] ?? null;

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
              const mot = motoristas.get(m.id);
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
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {est === "ocupado"
                        ? mot
                          ? `Motorista: ${mot.primeiroNome}${mot.desde ? ` · desde ${dataBR(mot.desde)}` : ""}`
                          : "Alugada"
                        : "Sem motorista"}
                    </p>
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

      {ultimoAcerto ? (
        <Link
          href={`/portal/acertos/${ultimoAcerto.id}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Acerto mais recente</p>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="font-semibold text-slate-950">{nomeMes(ultimoAcerto.competencia_mes)}</p>
              <Badge tom={ultimoAcerto.estado === "pago" ? "success" : "neutral"}>
                {ultimoAcerto.estado === "pago" ? "Pago" : "Fechado"}
              </Badge>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">
              {Number(ultimoAcerto.liquido) >= 0 ? "A receber" : "A pagar à GoScooters"}
            </p>
            <p
              className={`text-lg font-bold tabular-nums ${
                Number(ultimoAcerto.liquido) >= 0 ? "text-emerald-700" : "text-red-600"
              }`}
            >
              {formatarPreco(Math.abs(Number(ultimoAcerto.liquido)))}
            </p>
          </div>
        </Link>
      ) : (
        <Link
          href="/portal/financeiro"
          className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
        >
          <div>
            <p className="font-semibold text-slate-950">Financeiro</p>
            <p className="text-sm text-slate-500">
              Receita, despesas e o fecho de cada mês (acertos).
            </p>
          </div>
          <span className="shrink-0 text-slate-300">→</span>
        </Link>
      )}
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
