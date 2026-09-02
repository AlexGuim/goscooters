import { formatarPreco } from "@/lib/precos";
import { SemanasMoto } from "@/components/SemanasMoto";
import type { AcertoLinhaTipo, SemanaMoto } from "@/types/db";
import { cx } from "@/components/ui/estilos";

/**
 * O extrato do acerto — a MESMA peça no admin, no portal do parceiro e no link
 * público. Um extrato que muda de forma conforme o sítio onde se lê convida à
 * desconfiança; este é literalmente o mesmo componente.
 *
 * A ordem conta uma história: primeiro o que ENTROU (semana a semana, por moto,
 * onde se vê também o que não entrou e porquê), depois o que foi DESCONTADO
 * (despesas, com a fatura à distância de um clique), e por fim a COMISSÃO.
 *
 * Antes havia duas consolidações da receita a dizer o mesmo — as linhas
 * agrupadas por moto e a linha do tempo. Ficou a linha do tempo: diz tudo o que
 * a outra dizia e mais o que faltava (semanas paradas, perdas, manutenção).
 *
 * Sem estado do React de propósito: serve componentes de servidor e de cliente.
 */

export interface LinhaExtrato {
  tipo: AcertoLinhaTipo;
  /** Nula em linhas antigas do acerto congelado. */
  descricao: string | null;
  matricula: string | null;
  valor: number;
  /** Fatura da despesa — torna a linha clicável. */
  documento_url: string | null;
}

export interface TotaisAcerto {
  receita_total: number;
  receita_goscooters: number;
  comissao_total: number;
  despesa_total: number;
  liquido: number;
}

export function ExtratoAcerto({
  semanas,
  linhas,
  totais,
}: {
  semanas: SemanaMoto[];
  linhas: LinhaExtrato[];
  totais: TotaisAcerto;
}) {
  const despesas = linhas.filter((l) => l.tipo === "despesa");
  const comissoes = linhas.filter((l) => l.tipo === "comissao");
  const ajustes = linhas.filter((l) => l.tipo === "ajuste");
  const perdas = linhas.filter((l) => l.tipo === "perda");
  // Renda que entrou direto na conta do parceiro: é receita, mas com sinal
  // negativo no acerto (já a recebeu, desconta-se ao que há a transferir).
  const receitaDireta = linhas.filter((l) => l.tipo === "receita" && l.valor < 0);
  // As rendas positivas só se listam quando não há linha do tempo (ver abaixo):
  // de outro modo seriam a segunda consolidação a dizer o mesmo.
  const receitaEntrada = linhas.filter((l) => l.tipo === "receita" && l.valor > 0);

  return (
    <div className="space-y-8">
      {/* ── 1. O QUE ENTROU ────────────────────────────────────────────── */}
      {semanas.length > 0 ? (
        <section className="print-junto">
          <Cabecalho titulo="Receita, semana a semana" total={totais.receita_total} />
          <SemanasMoto semanas={semanas} />
        </section>
      ) : (
        // Acertos fechados ANTES de a linha do tempo existir não a têm gravada.
        // Sem isto ficariam sem receita nenhuma à vista — pior do que o layout
        // antigo. Mostram-se as linhas de receita como estavam.
        receitaEntrada.length > 0 && (
          <section className="print-junto">
            <Cabecalho titulo="Receita" total={totais.receita_total} />
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {receitaEntrada.map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-slate-700">
                    {l.matricula && (
                      <span className="mr-2 font-mono text-xs font-semibold text-slate-900">
                        {l.matricula}
                      </span>
                    )}
                    {l.descricao ?? "—"}
                  </span>
                  <span className="tabular-nums font-semibold text-slate-950">
                    {formatarPreco(l.valor)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {/* ── 2. O QUE FOI DESCONTADO ────────────────────────────────────── */}
      {despesas.length > 0 && (
        <section className="print-junto">
          <Cabecalho titulo="Despesas do parceiro" total={-totais.despesa_total} negativo />
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {despesas.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0 text-sm text-slate-700">
                  {l.matricula && (
                    <span className="mr-2 font-mono text-xs font-semibold text-slate-900">
                      {l.matricula}
                    </span>
                  )}
                  {l.documento_url ? (
                    <a
                      href={l.documento_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted underline-offset-2 transition hover:text-slate-950"
                    >
                      {l.descricao ?? "documento"}
                      <IconeDoc />
                    </a>
                  ) : (
                    l.descricao ?? "—"
                  )}
                </span>
                <span className="tabular-nums font-semibold text-red-700">
                  {formatarPreco(l.valor)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-slate-400">
            Cada despesa liga à fatura que a comprova.
          </p>
        </section>
      )}

      {/* ── 3. A COMISSÃO ──────────────────────────────────────────────── */}
      {comissoes.length > 0 && (
        <section className="print-junto">
          <Cabecalho titulo="Comissão GoScooters" total={-totais.comissao_total} negativo />
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {comissoes.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-sm text-slate-700">
                  {l.matricula && (
                    <span className="mr-2 font-mono text-xs font-semibold text-slate-900">
                      {l.matricula}
                    </span>
                  )}
                  {l.descricao ?? "—"}
                </span>
                <span className="tabular-nums font-semibold text-red-700">
                  {formatarPreco(l.valor)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 4. O RESTO ─────────────────────────────────────────────────── */}
      {(receitaDireta.length > 0 || ajustes.length > 0) && (
        <section className="print-junto">
          <Cabecalho titulo="Outros movimentos" />
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {[...receitaDireta, ...ajustes].map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-sm text-slate-700">
                  {l.matricula && (
                    <span className="mr-2 font-mono text-xs font-semibold text-slate-900">
                      {l.matricula}
                    </span>
                  )}
                  {l.descricao ?? "—"}
                </span>
                <span
                  className={cx(
                    "tabular-nums font-semibold",
                    l.valor < 0 ? "text-red-700" : "text-emerald-700",
                  )}
                >
                  {formatarPreco(l.valor)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {perdas.length > 0 && (
        <section className="print-junto rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            Perdas · {formatarPreco(perdas.reduce((t, l) => t + l.valor, 0))}
          </p>
          <p className="mt-0.5 text-xs text-red-700">
            Semanas usadas que não foram pagas e não vão ser cobradas. Não entram nas contas
            deste acerto — nunca chegaram a ser receita —, ficam aqui para explicar a renda em
            falta.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {perdas.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="text-slate-700">
                  {l.matricula ? `${l.matricula} · ` : ""}
                  {l.descricao ?? "—"}
                </span>
                <span className="tabular-nums text-red-700">{formatarPreco(l.valor)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Cabecalho({
  titulo,
  total,
  negativo = false,
}: {
  titulo: string;
  total?: number;
  negativo?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      {total !== undefined && (
        <span
          className={cx(
            "text-sm font-bold tabular-nums",
            negativo ? "text-red-700" : "text-slate-950",
          )}
        >
          {formatarPreco(total)}
        </span>
      )}
    </div>
  );
}

/** Marca discreta de "isto abre um documento". */
function IconeDoc() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ml-1 inline-block align-baseline text-slate-400"
      aria-hidden
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
