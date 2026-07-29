import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import DanoForm from "./DanoForm";
import ReciboBotao from "./ReciboBotao";

interface Dano { zona?: string; nota?: string }
interface Material { key?: string; rotulo?: string; qtd?: number; entregue?: boolean; devolvido?: boolean }
interface VistoriaPrep {
  realizada_em: string;
  km: number | null;
  combustivel: number | null;
  notas: string | null;
  danos: Dano[];
  materiais: Material[];
  fotos: string[];
  video: string | null;
  assinatura: string | null;
}

async function sign(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("privado").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

async function prep(v: Record<string, unknown> | null): Promise<VistoriaPrep | null> {
  if (!v) return null;
  const checklist = (v.checklist ?? {}) as { danos?: Dano[]; materiais?: Material[] };
  const fotos = (await Promise.all(((v.foto_urls as string[]) ?? []).map(sign))).filter(Boolean) as string[];
  return {
    realizada_em: v.realizada_em as string,
    km: (v.km as number) ?? null,
    combustivel: (v.nivel_combustivel as number) ?? null,
    notas: (v.notas as string) ?? null,
    danos: checklist.danos ?? [],
    materiais: checklist.materiais ?? [],
    fotos,
    video: await sign((v.video_url as string) ?? null),
    assinatura: await sign((v.assinatura_cliente_url as string) ?? null),
  };
}

export default async function VistoriaComparacao({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, caucao, veiculo_id, motorista_id")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: vistorias }, { data: danosDesp }, { data: moto }] = await Promise.all([
    supabaseAdmin.from("vistoria").select("*").eq("contrato_id", id).in("tipo", ["entrega", "recolha"]),
    supabaseAdmin.from("despesa").select("valor_total, descricao").eq("contrato_id", id).eq("imputar_a", "motorista"),
    c.veiculo_id ? supabaseAdmin.from("moto").select("matricula, modelo").eq("id", c.veiculo_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const entrega = await prep((vistorias ?? []).find((v) => v.tipo === "entrega") ?? null);
  const recolha = await prep((vistorias ?? []).find((v) => v.tipo === "recolha") ?? null);

  const totalDanos = (danosDesp ?? []).reduce((s, d) => s + Number(d.valor_total), 0);
  const caucao = Number(c.caucao ?? 0);
  const aDevolver = Math.round((caucao - totalDanos) * 100) / 100;
  const kmRodados = entrega?.km != null && recolha?.km != null ? recolha.km - entrega.km : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/contratos" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">← Contratos</Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">Vistoria · {c.numero}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {moto ? `${moto.matricula ?? "?"} · ${moto.modelo}` : ""}
            {kmRodados != null ? ` · ${kmRodados.toLocaleString("pt-PT")} km rodados` : ""}
          </p>
        </div>
        {entrega && <ReciboBotao contratoId={c.id} />}
      </div>

      {/* Caução */}
      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile rotulo="Caução" valor={caucao} cor="text-slate-950" />
          <Tile rotulo="Danos imputados" valor={-totalDanos} cor="text-red-600" />
          <Tile rotulo="A devolver ao motorista" valor={aDevolver} cor={aDevolver >= 0 ? "text-emerald-700" : "text-red-600"} forte />
        </div>
        {(danosDesp ?? []).length > 0 && (
          <ul className="space-y-1 text-sm text-slate-600">
            {(danosDesp ?? []).map((d, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{d.descricao}</span>
                <span className="text-red-600">−{formatarPreco(d.valor_total)}</span>
              </li>
            ))}
          </ul>
        )}
        {recolha ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Registar dano novo (sai da caução)</p>
            <DanoForm contratoId={c.id} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">Ainda não há recolha — os danos registam-se depois da devolução.</p>
        )}
      </section>

      {/* Comparação */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Coluna titulo="Entrega" v={entrega} />
        <Coluna titulo="Recolha" v={recolha} recolha />
      </div>
    </div>
  );
}

function Coluna({ titulo, v, recolha }: { titulo: string; v: VistoriaPrep | null; recolha?: boolean }) {
  return (
    <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-950">{titulo}</h2>
        {v && <span className="text-xs text-slate-500">{dataBR(v.realizada_em)}</span>}
      </div>
      {!v ? (
        <p className="text-sm text-slate-400">Ainda não feita.</p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {v.km != null ? `${v.km.toLocaleString("pt-PT")} km` : "—"}
            {v.combustivel != null ? ` · combustível ${v.combustivel}%` : ""}
          </p>
          {v.fotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {v.fotos.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`foto ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover" />
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            {v.video && <a href={v.video} target="_blank" rel="noreferrer" className="font-semibold text-emerald-600 hover:text-emerald-700">ver vídeo</a>}
            {v.assinatura && <a href={v.assinatura} target="_blank" rel="noreferrer" className="font-semibold text-slate-600 hover:text-slate-900">ver assinatura</a>}
          </div>
          {v.danos.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Danos registados</p>
              {v.danos.map((d, i) => (
                <p key={i} className="text-sm text-slate-600">• {[d.zona, d.nota].filter(Boolean).join(" — ")}</p>
              ))}
            </div>
          )}
          {v.materiais.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Materiais</p>
              {v.materiais.map((m, i) => {
                const emFalta = recolha && m.entregue !== false && !m.devolvido;
                return (
                  <p key={i} className={`flex justify-between gap-3 text-sm ${emFalta ? "text-red-600" : "text-slate-600"}`}>
                    <span>{m.rotulo || "—"}{m.qtd && m.qtd > 1 ? ` ×${m.qtd}` : ""}</span>
                    <span>{recolha ? (m.devolvido ? "devolvido" : "em falta") : m.entregue === false ? "não entregue" : "entregue"}</span>
                  </p>
                );
              })}
            </div>
          )}
          {v.notas && <p className="text-sm text-slate-500">{v.notas}</p>}
        </>
      )}
    </div>
  );
}

function Tile({ rotulo, valor, cor, forte }: { rotulo: string; valor: number; cor: string; forte?: boolean }) {
  return (
    <div className={`rounded-2xl bg-slate-50 p-4 ${forte ? "ring-1 ring-emerald-200" : ""}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`mt-1 ${forte ? "text-2xl" : "text-xl"} font-bold ${cor}`}>{formatarPreco(valor)}</p>
    </div>
  );
}
