import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { ContratoEstado, Notificacao } from "@/types/db";
import { HeroMarca } from "@/components/HeroMarca";
import { saudacaoLisboa } from "@/lib/datas";
import NotificacoesList from "./notificacoes/NotificacoesList";

/** Painel de entrada: a próxima ação de cada jornada + a caixa de notificações. */
export default async function AdminInicio() {
  await requireAdmin();

  const contarContratos = (estado: ContratoEstado) =>
    supabaseAdmin
      .from("contrato_aluguer")
      .select("id", { count: "exact", head: true })
      .eq("estado", estado);

  const [notifAbertas, preContratos, emAtraso, porRecolher, ativos, { data: notifs }] =
    await Promise.all([
      supabaseAdmin.from("notificacao").select("id", { count: "exact", head: true }).neq("estado", "feita"),
      contarContratos("pre_contrato"),
      // "Em atraso" = renda/extras vencidos; a caução (cobrada em mão) não conta,
      // para bater certo com a caixa de notificações e a lista de cobranças.
      supabaseAdmin
        .from("vw_cobranca_estado")
        .select("id", { count: "exact", head: true })
        .eq("em_atraso", true)
        .neq("tipo", "caucao"),
      contarContratos("pendente_fecho"),
      contarContratos("ativo"),
      supabaseAdmin
        .from("notificacao")
        .select("*")
        .neq("estado", "feita")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const tiles: { rotulo: string; n: number; href: string; cor: string }[] = [
    { rotulo: "Por resolver", n: notifAbertas.count ?? 0, href: "/admin/notificacoes", cor: "text-emerald-600" },
    { rotulo: "Pré-contratos", n: preContratos.count ?? 0, href: "/admin/contratos", cor: "text-indigo-600" },
    { rotulo: "Em atraso", n: emAtraso.count ?? 0, href: "/admin/cobrancas", cor: "text-red-600" },
    { rotulo: "Por recolher", n: porRecolher.count ?? 0, href: "/admin/contratos", cor: "text-amber-600" },
    { rotulo: "Contratos ativos", n: ativos.count ?? 0, href: "/admin/contratos", cor: "text-slate-950" },
  ];

  const { saudacao, data } = saudacaoLisboa();
  const porResolver = notifAbertas.count ?? 0;
  const atraso = emAtraso.count ?? 0;
  const partes: string[] = [];
  if (porResolver) partes.push(`${porResolver} ${porResolver === 1 ? "ação por resolver" : "ações por resolver"}`);
  if (atraso) partes.push(`${atraso} em atraso`);
  const resumo = partes.length ? partes.join(" · ") : "Sem pendências — está tudo em dia.";

  return (
    <div className="space-y-6">
      <HeroMarca eyebrow={data} titulo={saudacao} subtitulo={resumo} />

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Link
            key={t.rotulo}
            href={t.href}
            className="rounded-3xl bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <p className="text-sm text-slate-500">{t.rotulo}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${t.cor}`}>{t.n}</p>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">Caixa de próxima ação</h2>
        <NotificacoesList inicial={(notifs ?? []) as Notificacao[]} />
      </div>
    </div>
  );
}
