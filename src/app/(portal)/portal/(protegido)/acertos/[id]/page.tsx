import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePartner } from "@/lib/dal";
import { acertoDoParceiro } from "@/lib/portal/queries";
import { formatarPreco } from "@/lib/precos";
import { ExtratoAcerto } from "@/components/ExtratoAcerto";
import type { SemanaMoto } from "@/types/db";
import { dataBR } from "@/lib/datas";
import { Badge } from "@/components/ui";
import ImprimirBotao from "./ImprimirBotao";

function nomeMes(competencia: string): string {
  const [ano, mes] = competencia.slice(0, 7).split("-");
  const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[Number(mes)]} ${ano}`;
}

export default async function PortalAcertoDetalhe({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { proprietarioId, nome } = await requirePartner();

  // A posse é validada dentro da query (proprietario_id da sessão). Um id de
  // outro parceiro devolve null → 404.
  const res = await acertoDoParceiro(proprietarioId, id);
  if (!res) notFound();
  const { acerto, linhas } = res;

  // Linha do tempo congelada no fecho (acertos antigos não a têm: fica vazia).
  const semanas = (Array.isArray(acerto.semanas) ? acerto.semanas : []) as SemanaMoto[];
  const liq = Number(acerto.liquido);
  const aReceber = liq >= 0;


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Link href="/portal/acertos" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
          ← Acertos
        </Link>
        <ImprimirBotao />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-950">
                Acerto de {nomeMes(acerto.competencia_mes)}
              </h1>
              <Badge tom={acerto.estado === "pago" ? "success" : "neutral"}>
                {acerto.estado === "pago" ? "Pago" : "Fechado"}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              {nome}
              {acerto.fechado_em ? ` · fechado em ${dataBR(acerto.fechado_em)}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <Tile rotulo="Receita" valor={Number(acerto.receita_total)} cor="text-slate-950" />
          <Tile rotulo="Comissão" valor={-Number(acerto.comissao_total)} cor="text-amber-700" />
          <Tile rotulo="Despesas" valor={-Number(acerto.despesa_total)} cor="text-red-600" />
          <Tile
            rotulo={aReceber ? "A receber" : "A pagar à GoScooters"}
            valor={Math.abs(liq)}
            cor={aReceber ? "text-emerald-700" : "text-red-600"}
            forte
          />
        </div>

        {acerto.pago_direto && (
          <p className="mt-4 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
            Parte da renda foi recebida diretamente na tua conta. Por isso o acerto reflete a
            comissão (e despesas) que deves à GoScooters.
          </p>
        )}

        <div className="mt-6 space-y-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Extrato</h2>

          {/* Exatamente o mesmo componente do admin e do link público. */}
          <ExtratoAcerto
            semanas={semanas}
            linhas={linhas.map((l) => ({
              tipo: l.tipo,
              descricao: l.descricao,
              matricula: l.matricula_snapshot,
              valor: Number(l.valor),
              documento_url: l.documento_url,
            }))}
            totais={{
              receita_total: Number(acerto.receita_total),
              receita_goscooters: Number(acerto.receita_goscooters),
              comissao_total: Number(acerto.comissao_total),
              despesa_total: Number(acerto.despesa_total),
              liquido: liq,
            }}
          />

          <div className="mt-1 print:hidden">
            <Link href="/portal/despesas" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
              Ver todas as despesas das minhas motas →
            </Link>
          </div>
        </div>

        <p className="mt-6 text-xs text-slate-400">
          Extrato congelado no fecho — os valores deste mês não mudam. O <strong>ver documento</strong>
          {" "}abre a fatura, portagem, coima ou apólice correspondente.
        </p>
      </div>
    </div>
  );
}

function Tile({
  rotulo,
  valor,
  cor,
  forte,
}: {
  rotulo: string;
  valor: number;
  cor: string;
  forte?: boolean;
}) {
  return (
    <div className={`rounded-2xl bg-slate-50 p-4 ${forte ? "ring-1 ring-emerald-200" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 ${forte ? "text-2xl" : "text-xl"} font-bold ${cor}`}>
        {formatarPreco(valor)}
      </p>
    </div>
  );
}
