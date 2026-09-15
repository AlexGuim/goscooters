import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { financeiroMes } from "@/lib/financeiro";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { CAT_ROTULO } from "@/lib/despesasMeta";
import { urlsDocumentosParaAdmin } from "@/lib/documentoDespesaServidor";
import type { DespesaCategoria } from "@/types/db";
import Cascata from "./Cascata";

// As despesas do negócio todo são da casa ou dos parceiros. As imputadas a
// motoristas são adiantamentos por conta deles e aparecem à parte.
const IMPUTACAO: Record<string, string> = {
  goscooters: "GoScooters",
  proprietario: "parceiros",
};

const MESES = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * O mês da GoScooters, aberto.
 *
 * A tabela anual dizia "Agosto: 904 €" e mais nada. Aqui vê-se de onde veio
 * cada euro: que motos da frota própria, que parceiros (e a que taxa), e que
 * despesas — com a fatura a um clique, como no extrato do parceiro.
 *
 * Vista VIVA: recalcula sempre dos dados. Corrigir um pagamento de agosto
 * corrige agosto. Se um dia for preciso congelar para a contabilidade,
 * acrescenta-se por cima sem deitar isto fora.
 */
export default async function MesFinanceiroPage({
  params,
}: {
  params: Promise<{ mes: string }>;
}) {
  await requireAdmin();
  const { mes: chave } = await params;
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  if (!m) notFound();
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) notFound();

  const mesBruto = await financeiroMes(ano, mes);
  // A fatura de cada despesa própria, pronta a abrir: o URL público, ou um URL
  // assinado quando o documento é privado (coima/portagem) — gerado aqui, no
  // servidor, depois do requireAdmin.
  const docs = await urlsDocumentosParaAdmin(mesBruto.despesas.map((x) => x.documento_url));
  const d = { ...mesBruto, despesas: mesBruto.despesas.map((x, i) => ({ ...x, documento_url: docs[i] })) };
  const anterior = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
  const seguinte = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/admin/financeiro?ano=${ano}`} className="text-sm font-medium text-emerald-700 hover:text-emerald-600">
            ← Resultado de {ano}
          </Link>
          <h1 className="mt-1 text-3xl font-semibold text-slate-950">
            {MESES[mes]} de {ano}
          </h1>
          <p className="mt-1 text-slate-600">
            De onde veio cada euro. Fecho de gestão: receita das semanas do mês e custos pela data da fatura.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/financeiro/${anterior}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ←
          </Link>
          <Link href={`/admin/financeiro/${seguinte}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            →
          </Link>
        </div>
      </div>

      {/* O fecho do mês em cascata, com o mês anterior ao lado */}
      <Cascata este={d.fecho} anterior={d.fecho_anterior} />
      <p className="text-xs text-slate-500">
        A receita é só a comissão e a renda da frota própria: a renda dos parceiros é dinheiro de
        passagem.{" "}
        {d.receita_via_acerto > 0.005 && (
          <>
            Dessa receita, <strong>{formatarPreco(d.receita_via_acerto)}</strong> é comissão sobre
            renda que o parceiro cobrou diretamente: está ganha, mas o dinheiro só chega pelo acerto
            do mês.
          </>
        )}
      </p>

      {/* ── O NEGÓCIO INTEIRO ──────────────────────────────────────────── */}
      <section className="print-junto rounded-3xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            O negócio todo
          </h2>
          <span className="text-xs text-slate-400">
            toda a frota · as despesas da casa e dos parceiros
          </span>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Renda de todas as motos</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-950">
              {formatarPreco(d.negocio.renda)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Despesas totais</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-red-600">
              −{formatarPreco(d.negocio.despesas)}
            </p>
            <ul className="mt-1 space-y-0.5">
              {d.negocio.despesas_por_imputacao.map((x) => (
                <li key={x.imputar_a} className="flex justify-between gap-2 text-xs">
                  <span className="text-slate-500">suporta: {IMPUTACAO[x.imputar_a] ?? x.imputar_a}</span>
                  <span className="tabular-nums text-slate-700">{formatarPreco(x.valor)}</span>
                </li>
              ))}
            </ul>
            {d.negocio.adiantado_motoristas > 0.005 && (
              <p className="mt-1 flex justify-between gap-2 text-xs text-slate-400">
                <span>Adiantado por conta de motoristas</span>
                <span className="tabular-nums">{formatarPreco(d.negocio.adiantado_motoristas)}</span>
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-500">Resultado do negócio</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${d.negocio.resultado >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {formatarPreco(d.negocio.resultado)}
            </p>
            <p className="mt-1 text-xs text-slate-400">antes de se repartir</p>
          </div>
        </div>
      </section>

      {/* ── POR DONO: os acertos todos lado a lado ─────────────────────── */}
      <section className="print-junto">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rendimento por dono
          </h2>
          <span className="text-xs text-slate-400">a mesma conta dos acertos, todos juntos</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Dono</th>
                <th className="px-4 py-2.5 text-right font-semibold">Renda</th>
                <th className="px-4 py-2.5 text-right font-semibold">Comissão GS</th>
                <th className="px-4 py-2.5 text-right font-semibold">Despesas</th>
                <th className="px-4 py-2.5 text-right font-semibold">Rendimento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {d.por_dono.map((l) => (
                <tr key={l.proprietario_id}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{l.nome}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {l.motos} {l.motos === 1 ? "mota" : "motas"}
                      {l.eh_propria ? " · própria" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatarPreco(l.renda)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {l.eh_propria ? "—" : `−${formatarPreco(l.comissao)}`}
                  </td>
                  <td className="px-4 py-3 text-right text-red-600">
                    {l.despesas > 0 ? `−${formatarPreco(l.despesas)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">
                    {formatarPreco(l.rendimento)}
                  </td>
                </tr>
              ))}
              {d.sem_dono.custos_empresa > 0.005 && (
                <LinhaSemDono rotulo="Custos da empresa (não são de nenhum dono)" valor={d.sem_dono.custos_empresa} />
              )}
              {d.sem_dono.casa_noutras_motas > 0.005 && (
                <LinhaSemDono rotulo="Custos da casa noutras motas" valor={d.sem_dono.casa_noutras_motas} />
              )}
              {d.sem_dono.proprietario_sem_dono > 0.005 && (
                <LinhaSemDono
                  rotulo="Despesas de proprietário sem dono atribuído"
                  valor={d.sem_dono.proprietario_sem_dono}
                />
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          <strong>Rendimento</strong> é o que fica para o dono: renda − comissão − despesas. Na
          frota própria não há comissão — é tudo da casa. O que há a <em>transferir</em> a cada
          parceiro pode diferir, conforme quem cobrou a renda; isso está no acerto dele.
        </p>
      </section>

      {/* Frota própria: renda inteira é receita */}
      <Seccao titulo="Frota própria" total={d.receita_frota} vazio="Nenhuma renda recebida de motos próprias neste mês.">
        {d.frota_propria.map((l) => (
          <Linha key={l.veiculo_id} esquerda={<span className="font-mono text-sm font-semibold text-slate-900">{l.matricula ?? "—"}</span>} valor={l.valor} />
        ))}
      </Seccao>

      {/* Comissões: a parte da casa sobre a renda dos parceiros */}
      <Seccao titulo="Comissões de parceiros" total={d.receita_comissao} vazio="Nenhuma comissão neste mês.">
        {d.comissoes.map((c) => (
          <Linha
            key={c.proprietario_id}
            esquerda={
              <span className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">{c.nome}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {formatarPreco(c.base)} de renda · {c.taxa_media.toFixed(c.taxa_media % 1 ? 1 : 0)}%
                </span>
              </span>
            }
            valor={c.comissao}
          />
        ))}
      </Seccao>

      {/* Os custos da casa (da frota e da empresa), com a fatura */}
      <Seccao titulo="Custos da casa" total={-d.despesas_gs} negativo vazio="Nenhum custo da casa neste mês.">
        {d.despesas.map((x) => (
          <Linha
            key={x.id}
            esquerda={
              <span className="min-w-0 text-sm text-slate-700">
                <span className="mr-2 text-xs text-slate-400">{dataBR(x.data)}</span>
                {x.matricula && <span className="mr-2 font-mono text-xs font-semibold text-slate-900">{x.matricula}</span>}
                {x.documento_url ? (
                  <a href={x.documento_url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-slate-950">
                    {x.descricao || CAT_ROTULO[x.categoria as DespesaCategoria] || x.categoria}
                  </a>
                ) : (
                  x.descricao || CAT_ROTULO[x.categoria as DespesaCategoria] || x.categoria
                )}
              </span>
            }
            valor={-x.valor}
            negativo
          />
        ))}
      </Seccao>
    </div>
  );
}

function Seccao({
  titulo,
  total,
  negativo = false,
  vazio,
  children,
}: {
  titulo: string;
  total: number;
  negativo?: boolean;
  vazio: string;
  children: React.ReactNode;
}) {
  const temLinhas = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h2>
        <span className={`text-sm font-bold tabular-nums ${negativo ? "text-red-700" : "text-slate-950"}`}>
          {formatarPreco(total)}
        </span>
      </div>
      {temLinhas ? (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">{children}</ul>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">{vazio}</p>
      )}
    </section>
  );
}

function Linha({ esquerda, valor, negativo = false }: { esquerda: React.ReactNode; valor: number; negativo?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
      {esquerda}
      <span className={`tabular-nums font-semibold ${negativo ? "text-red-700" : "text-slate-950"}`}>
        {formatarPreco(valor)}
      </span>
    </li>
  );
}

/**
 * Despesas da casa que não são de nenhum dono, numa linha à parte do «Rendimento
 * por dono» — sem elas, a soma da tabela deixava de bater com o negócio todo.
 */
function LinhaSemDono({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <tr>
      <td className="px-4 py-3 text-slate-600">{rotulo}</td>
      <td className="px-4 py-3 text-right text-slate-400">—</td>
      <td className="px-4 py-3 text-right text-slate-400">—</td>
      <td className="px-4 py-3 text-right text-red-600">−{formatarPreco(valor)}</td>
      <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatarPreco(-valor)}</td>
    </tr>
  );
}
