import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarComprovativo } from "@/lib/reciboToken";
import { dataBR, dataCurtaBR } from "@/lib/datas";
import { formatarPreco } from "@/lib/precos";
import { Logo } from "@/components/Logo";
import type { ComprovativoSemana } from "@/types/db";
import ImprimirComprovativo from "./ImprimirComprovativo";

/**
 * Comprovativo de pagamento — página pública, aberta por token assinado.
 *
 * Lê SÓ o snapshot gravado na emissão (nunca as tabelas vivas): o papel que o
 * motorista guardou não pode mudar porque entretanto se corrigiu o recebedor,
 * o nome, ou se anulou uma cobrança.
 *
 * Não é fatura nem recibo fiscal — é um documento de gestão que confirma o que
 * foi recebido. O rodapé di-lo nas duas línguas, sempre.
 */

const METODO: Record<string, { pt: string; en: string }> = {
  transferencia: { pt: "Transferência bancária", en: "Bank transfer" },
  mbway: { pt: "MB WAY", en: "MB WAY" },
  numerario: { pt: "Numerário", en: "Cash" },
  multibanco: { pt: "Multibanco", en: "Multibanco" },
  outro: { pt: "Outro", en: "Other" },
};

const TIPO_SEMANA: Record<string, { pt: string; en: string }> = {
  renda: { pt: "Aluguer", en: "Rental" },
  caucao: { pt: "Caução", en: "Deposit" },
  extra: { pt: "Extra", en: "Extra" },
};

const T = {
  pt: {
    eyebrow: "Comprovativo de pagamento",
    referencia: "Referência",
    emitente: "Emitente",
    emitenteSub: "Gestão e aluguer de motas · Lisboa",
    recebidoDe: "Recebido de",
    nif: "NIF",
    total: "Total recebido",
    pagamentos: "Pagamentos",
    umPagamento: "Pagamento",
    semanas: "Períodos cobertos",
    semAlocacao: "Sem período associado",
    ref: "Ref.",
    anulado: "Documento anulado",
    anuladoNota: "Este comprovativo foi anulado e não serve como prova de pagamento.",
    imprimir: "Guardar / Imprimir PDF",
    emitidoEm: "Emitido em",
    rodape:
      "Documento interno de gestão emitido pela GoScooters a confirmar os valores recebidos. Não é fatura nem recibo para efeitos fiscais.",
    rodapeEn:
      "Internal management document issued by GoScooters confirming amounts received. It is not an invoice or a tax receipt.",
  },
  en: {
    eyebrow: "Payment confirmation",
    referencia: "Reference",
    emitente: "Issued by",
    emitenteSub: "Scooter rental & fleet management · Lisbon",
    recebidoDe: "Received from",
    nif: "Tax no.",
    total: "Total received",
    pagamentos: "Payments",
    umPagamento: "Payment",
    semanas: "Periods covered",
    semAlocacao: "No period allocated",
    ref: "Ref.",
    anulado: "Document cancelled",
    anuladoNota: "This confirmation has been cancelled and is not valid as proof of payment.",
    imprimir: "Save / Print PDF",
    emitidoEm: "Issued on",
    rodape:
      "Documento interno de gestão emitido pela GoScooters a confirmar os valores recebidos. Não é fatura nem recibo para efeitos fiscais.",
    rodapeEn:
      "Internal management document issued by GoScooters confirming amounts received. It is not an invoice or a tax receipt.",
  },
} as const;

export default async function ComprovativoPagamento({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const id = validarComprovativo(token);
  if (!id) notFound();

  const { data: c } = await supabaseAdmin
    .from("comprovativo_pagamento")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const { data: itens } = await supabaseAdmin
    .from("comprovativo_pagamento_item")
    .select("*")
    .eq("comprovativo_id", id)
    .order("data_recebimento", { ascending: true });

  const lang: "pt" | "en" = c.idioma === "en" ? "en" : "pt";
  const t = T[lang];
  const linhas = itens ?? [];
  const anulado = !!c.anulado_em;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 print:py-0">
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm print:rounded-none print:shadow-none">
        {/* Cabeçalho de marca */}
        <div className="speed-cut print-exact relative overflow-hidden bg-slate-950 px-6 py-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-emerald-500/15 blur-3xl"
          />
          <div className="relative flex items-center justify-between gap-4">
            <Logo onDark />
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-500">
                {t.eyebrow}
              </p>
              <p className="font-mono text-sm text-slate-100">{c.numero}</p>
              <p className="text-xs text-slate-400">
                {t.emitidoEm} {dataBR(c.data_emissao)}
              </p>
            </div>
          </div>
        </div>

        {anulado && (
          <div className="print-exact border-b border-red-200 bg-red-50 px-6 py-3">
            <p className="text-sm font-semibold text-red-700">{t.anulado}</p>
            <p className="text-xs text-red-600">
              {t.anuladoNota}
              {c.anulado_motivo ? ` — ${c.anulado_motivo}` : ""}
            </p>
          </div>
        )}

        <div className="space-y-6 p-6">
          {/* Partes */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.emitente}</p>
              <p className="text-sm font-semibold text-slate-900">GoScooters</p>
              <p className="text-sm text-slate-600">{t.emitenteSub}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.recebidoDe}</p>
              <p className="text-sm font-semibold text-slate-900">{c.motorista_nome}</p>
              {c.motorista_nif && (
                <p className="mt-1 text-sm text-slate-600">
                  {t.nif} {c.motorista_nif}
                </p>
              )}
            </div>
          </section>

          {/* Total — o herói do documento */}
          <section className="print-junto rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.total}</p>
            <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-slate-950">
              {formatarPreco(c.valor_total, lang)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {linhas.length === 1
                ? `1 ${t.umPagamento.toLowerCase()}`
                : `${linhas.length} ${t.pagamentos.toLowerCase()}`}
            </p>
          </section>

          {/* Detalhe: uma secção por pagamento, com os períodos que cobriu */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {linhas.length === 1 ? t.umPagamento : t.pagamentos}
            </p>
            {linhas.map((it) => {
              const semanas = (it.semanas ?? []) as ComprovativoSemana[];
              const metodo = it.metodo ? METODO[it.metodo]?.[lang] ?? it.metodo : null;
              // Quando o pagamento cobre mais do que os períodos somam (adiantamento),
              // mostrar os valores linha a linha convidava a uma subtração que o
              // documento não explica. Nesse caso listam-se só os períodos — que é
              // o que o título promete, e continua a ser verdade.
              const somaSemanas = semanas.reduce((t, s) => t + Number(s.valor), 0);
              const reconcilia = Math.abs(somaSemanas - Number(it.valor)) < 0.01;
              return (
                <div key={it.id} className="print-junto rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{dataBR(it.data_recebimento)}</p>
                      <p className="text-xs text-slate-500">
                        {[metodo, it.referencia ? `${t.ref} ${it.referencia}` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums text-slate-950">
                      {formatarPreco(it.valor, lang)}
                    </p>
                  </div>

                  {semanas.length > 0 ? (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {t.semanas}
                      </p>
                      <ul className="space-y-1">
                        {semanas.map((s, i) => (
                          <li key={i} className="flex justify-between gap-3 text-sm">
                            <span className="text-slate-600">
                              {[
                                s.matricula,
                                `${dataCurtaBR(s.inicio)}–${dataCurtaBR(s.fim)}`,
                                s.tipo && s.tipo !== "renda" ? TIPO_SEMANA[s.tipo]?.[lang] ?? s.tipo : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {reconcilia && (
                              <span className="tabular-nums text-slate-500">
                                {formatarPreco(s.valor, lang)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">{t.semAlocacao}</p>
                  )}
                </div>
              );
            })}
          </section>

          {/* Rodapé: o enquadramento sai SEMPRE nas duas línguas */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="space-y-1">
              {(lang === "en" ? [t.rodapeEn, t.rodape] : [t.rodape, t.rodapeEn]).map((linha) => (
                <p key={linha} className="text-xs text-slate-400">
                  {linha}
                </p>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[11px] text-slate-400">{c.numero}</p>
              <ImprimirComprovativo rotulo={t.imprimir} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
