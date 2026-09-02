import { formatarPreco } from "@/lib/precos";
import type { SemanaEstado, SemanaMoto } from "@/types/db";
import { cx } from "@/components/ui/estilos";

/**
 * Linha do tempo semanal por moto — todas as semanas do mês, não só as que
 * geraram receita.
 *
 * O problema que resolve: no extrato antigo, uma moto que esteve parada e uma
 * moto cujo motorista não pagou apareciam exatamente da mesma maneira — como
 * ausência de linha. O parceiro via menos dinheiro e não sabia porquê. Aqui
 * cada semana diz o que aconteceu.
 *
 * Sem estado do React de propósito: serve o admin (componente cliente) e o
 * portal (componente servidor) sem duplicação.
 */

const ROTULO: Record<SemanaEstado, string> = {
  paga: "paga",
  parcial: "parcial",
  por_cobrar: "por cobrar",
  perda: "perda",
  isenta: "isenta",
  parada: "parada",
};

const TOM: Record<SemanaEstado, string> = {
  paga: "bg-emerald-100 text-emerald-800",
  parcial: "bg-amber-100 text-amber-800",
  por_cobrar: "bg-amber-100 text-amber-800",
  perda: "bg-red-100 text-red-800",
  isenta: "bg-slate-200 text-slate-700",
  parada: "bg-slate-100 text-slate-500",
};

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function SemanasMoto({ semanas }: { semanas: SemanaMoto[] }) {
  if (!semanas.length) return null;

  const porMoto = new Map<string, SemanaMoto[]>();
  for (const s of semanas) {
    const k = s.matricula ?? s.veiculo_id;
    const arr = porMoto.get(k) ?? [];
    arr.push(s);
    porMoto.set(k, arr);
  }

  return (
    <div className="space-y-3">
      {[...porMoto.entries()].map(([matricula, linhas]) => {
        const recebido = linhas.reduce((t, l) => t + l.valor, 0);
        const paradas = linhas.filter((l) => l.estado === "parada").length;
        return (
          <div key={matricula} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="font-mono text-sm font-semibold text-slate-900">{matricula}</p>
              <p className="text-xs text-slate-500">
                {formatarPreco(recebido)} recebido
                {paradas > 0 && ` · ${paradas} semana(s) parada`}
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {linhas.map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">
                      {l.rotulo}{" "}
                      <span className="text-slate-400">
                        ({dm(l.inicio)}–{dm(l.fim)})
                      </span>
                      <span
                        className={cx(
                          "ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          TOM[l.estado],
                        )}
                      >
                        {ROTULO[l.estado]}
                      </span>
                    </p>
                    {(l.motorista || l.nota || l.desconto > 0) && (
                      <p className="text-xs text-slate-500">
                        {[
                          l.motorista,
                          l.desconto > 0 ? `desconto ${formatarPreco(l.desconto)}` : null,
                          l.nota,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    {l.estado === "parada" && (
                      <p className="text-xs text-slate-400">Sem aluguer nesta semana</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={cx(
                        "text-sm font-semibold tabular-nums",
                        l.estado === "paga" || l.estado === "parcial"
                          ? "text-slate-950"
                          : l.estado === "perda"
                            ? "text-red-700"
                            : "text-slate-400",
                      )}
                    >
                      {l.valor > 0 ? formatarPreco(l.valor) : "—"}
                    </p>
                    {/* O que se deixou de receber, quando não foi tudo. */}
                    {l.devido > 0 && l.valor < l.devido - l.desconto - 0.005 && (
                      <p className="text-[11px] text-slate-400">
                        de {formatarPreco(l.devido - l.desconto)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
