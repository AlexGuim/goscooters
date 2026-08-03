import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { acertosDoParceiro } from "@/lib/portal/queries";
import { formatarPreco } from "@/lib/precos";
import { Badge } from "@/components/ui";

function nomeMes(competencia: string): string {
  const [ano, mes] = competencia.slice(0, 7).split("-");
  const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(mes)]} ${ano}`;
}

export default async function PortalAcertosPage() {
  const { proprietarioId } = await requirePartner();
  const acertos = await acertosDoParceiro(proprietarioId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Acertos</h1>
        <p className="mt-1 text-slate-600">O fecho de cada mês. Clica para ver o extrato.</p>
      </div>

      {acertos.length === 0 ? (
        <div className="rounded-3xl bg-white p-8 text-center text-slate-600 shadow-sm">
          Ainda não há acertos fechados.
        </div>
      ) : (
        <div className="space-y-3">
          {acertos.map((a) => {
            const liq = Number(a.liquido);
            const aReceber = liq >= 0;
            return (
              <Link
                key={a.id}
                href={`/portal/acertos/${a.id}`}
                className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <p className="font-semibold text-slate-950">{nomeMes(a.competencia_mes)}</p>
                  <Badge tom={a.estado === "pago" ? "success" : "neutral"}>
                    {a.estado === "pago" ? "Pago" : "Fechado"}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {aReceber ? "A receber" : "A pagar à GoScooters"}
                  </p>
                  <p className={`text-lg font-bold tabular-nums ${aReceber ? "text-emerald-700" : "text-red-600"}`}>
                    {formatarPreco(Math.abs(liq))}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
