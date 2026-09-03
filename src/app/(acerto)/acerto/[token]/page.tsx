import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarAcerto } from "@/lib/reciboToken";
import { dataBR } from "@/lib/datas";
import { formatarPreco } from "@/lib/precos";
import { Logo } from "@/components/Logo";
import { ExtratoAcerto } from "@/components/ExtratoAcerto";
import type { SemanaMoto } from "@/types/db";
import ImprimirAcerto from "./ImprimirAcerto";

/**
 * Extrato do acerto — página pública, aberta por token assinado.
 *
 * Lê o acerto CONGELADO (linhas e linha do tempo gravadas no fecho), nunca as
 * tabelas vivas: o extrato que o parceiro recebeu não pode mudar porque
 * entretanto se corrigiu uma despesa ou se marcou uma semana como perda.
 *
 * É o mesmo `ExtratoAcerto` do admin e do portal — de propósito. Um extrato que
 * muda de forma conforme o sítio onde se lê convida à desconfiança.
 */

const MESES = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const mesPorExtenso = (iso: string) => {
  const [ano, mes] = iso.slice(0, 7).split("-");
  return `${MESES[Number(mes)] ?? mes} de ${ano}`;
};

export default async function ExtratoAcertoPublico({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const id = validarAcerto(token);
  if (!id) notFound();

  const { data: a } = await supabaseAdmin.from("acerto").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();

  const [{ data: linhasBrutas }, { data: dono }] = await Promise.all([
    supabaseAdmin.from("acerto_linha").select("*").eq("acerto_id", id),
    a.proprietario_id
      ? supabaseAdmin.from("proprietario").select("nome, nif").eq("id", a.proprietario_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // A fatura de cada despesa, para as linhas serem clicáveis (igual ao portal).
  const despesaIds = [
    ...new Set((linhasBrutas ?? []).map((l) => l.despesa_id).filter(Boolean) as string[]),
  ];
  const docDe = new Map<string, string | null>();
  if (despesaIds.length) {
    const { data: desps } = await supabaseAdmin
      .from("despesa")
      .select("id, detalhe")
      .in("id", despesaIds);
    for (const d of desps ?? []) {
      docDe.set(d.id, (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null);
    }
  }

  const semanas = (Array.isArray(a.semanas) ? a.semanas : []) as SemanaMoto[];
  const liq = Number(a.liquido);
  const aReceber = liq >= 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 print:py-0">
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm print:rounded-none print:shadow-none">
        {/* Cabeçalho de marca */}
        <div className="speed-cut print-exact relative overflow-hidden bg-slate-950 px-6 py-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-emerald-500/15 blur-3xl"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <Logo onDark />
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-500">
                Extrato do acerto
              </p>
              <p className="text-sm font-semibold text-slate-100">
                {mesPorExtenso(a.competencia_mes as string)}
              </p>
              <p className="text-xs text-slate-400">
                {a.periodo_inicio ? `${dataBR(a.periodo_inicio as string)} a ${dataBR(a.periodo_fim as string)}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Partes */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Gestão
              </p>
              <p className="text-sm font-semibold text-slate-900">GoScooters</p>
              <p className="text-sm text-slate-600">Gestão e aluguer de motas · Lisboa</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Parceiro
              </p>
              <p className="text-sm font-semibold text-slate-900">{dono?.nome ?? "—"}</p>
              {dono?.nif && <p className="mt-1 text-sm text-slate-600">NIF {dono.nif}</p>}
            </div>
          </section>

          {/* O número que importa */}
          <section
            className={`print-junto rounded-2xl border p-5 ${
              aReceber ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {aReceber ? "A receber" : "A pagar à GoScooters"}
            </p>
            <p
              className={`mt-1 font-display text-4xl font-bold tabular-nums tracking-tight ${
                aReceber ? "text-slate-950" : "text-red-700"
              }`}
            >
              {formatarPreco(Math.abs(liq))}
            </p>
            {a.pago_direto && (
              <p className="mt-2 text-xs text-slate-600">
                Parte da renda foi recebida diretamente na tua conta — por isso o extrato reflete
                a comissão e as despesas que ficam a acertar.
              </p>
            )}
          </section>

          {/* O extrato, igual ao do admin e ao do portal */}
          <ExtratoAcerto
            semanas={semanas}
            linhas={(linhasBrutas ?? []).map((l) => ({
              tipo: l.tipo,
              descricao: l.descricao,
              matricula: l.matricula_snapshot,
              valor: Number(l.valor),
              documento_url: l.despesa_id ? docDe.get(l.despesa_id) ?? null : null,
            }))}
            totais={{
              receita_total: Number(a.receita_total),
              receita_goscooters: Number(a.receita_goscooters),
              comissao_total: Number(a.comissao_total),
              despesa_total: Number(a.despesa_total),
              liquido: liq,
            }}
          />

          {/* O extrato mostra UM mês. Quem quer o histórico, as despesas e as
              motas tem-nos no portal — daí o convite, e não só o documento. */}
          <div className="print-junto rounded-2xl border border-slate-200 bg-slate-50 p-4 print:hidden">
            <p className="text-sm font-semibold text-slate-900">Vê tudo no teu portal</p>
            <p className="mt-0.5 text-sm text-slate-600">
              Este extrato é só de {mesPorExtenso(a.competencia_mes as string)}. No portal tens o
              histórico de todos os meses, as despesas de cada mota e o estado da frota.
            </p>
            <Link
              href="/portal/entrar"
              className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-slate-50 transition hover:bg-slate-900"
            >
              Entrar no portal do parceiro
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">
              GoScooters · extrato do acerto de {mesPorExtenso(a.competencia_mes as string)}.
              Documento de gestão entre a GoScooters e o parceiro.
            </p>
            <ImprimirAcerto />
          </div>
        </div>
      </div>
    </main>
  );
}
