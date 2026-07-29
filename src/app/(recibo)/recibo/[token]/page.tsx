import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarRecibo } from "@/lib/reciboToken";
import { dataBR } from "@/lib/datas";
import { Logo } from "@/components/Logo";
import ImprimirRecibo from "./ImprimirRecibo";

interface Dano { zona?: string; nota?: string }
interface Material { rotulo?: string; qtd?: number; entregue?: boolean }

async function sign(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("privado").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export default async function ReciboEntrega({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const vistoriaId = validarRecibo(token);
  if (!vistoriaId) notFound();

  const { data: v } = await supabaseAdmin
    .from("vistoria")
    .select("*")
    .eq("id", vistoriaId)
    .eq("tipo", "entrega")
    .maybeSingle();
  if (!v) notFound();

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("numero, veiculo_id, motorista_id, preco_periodo, periodicidade, caucao")
    .eq("id", v.contrato_id as string)
    .maybeSingle();

  const [{ data: moto }, { data: mot }] = await Promise.all([
    c?.veiculo_id
      ? supabaseAdmin.from("moto").select("matricula, modelo").eq("id", c.veiculo_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c?.motorista_id
      ? supabaseAdmin.from("motorista").select("nome").eq("id", c.motorista_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const checklist = (v.checklist ?? {}) as { danos?: Dano[]; materiais?: Material[] };
  const danos = checklist.danos ?? [];
  const materiais = (checklist.materiais ?? []).filter((m) => m.entregue !== false);
  const fotos = (await Promise.all(((v.foto_urls as string[]) ?? []).map(sign))).filter(Boolean) as string[];
  const assinatura = await sign((v.assinatura_cliente_url as string) ?? null);
  const km = (v.km as number) ?? null;
  const combustivel = (v.nivel_combustivel as number) ?? null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 print:py-2">
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm print:rounded-none print:shadow-none">
        {/* Cabeçalho de marca */}
        <div className="speed-cut relative overflow-hidden bg-slate-950 px-6 py-6 print:bg-slate-950">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-emerald-500/15 blur-3xl"
          />
          <div className="relative flex items-center justify-between gap-4">
            <Logo onDark />
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-500">Recibo de entrega</p>
              <p className="text-sm text-slate-300">{v.realizada_em ? dataBR(v.realizada_em as string) : ""}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Resumo */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Linha rotulo="Contrato" valor={c?.numero ?? "—"} />
            <Linha rotulo="Motorista" valor={mot?.nome ?? "—"} />
            <Linha rotulo="Mota" valor={moto ? `${moto.matricula ?? "?"} · ${moto.modelo}` : "—"} />
            <Linha
              rotulo="Aluguer"
              valor={c ? `€${c.preco_periodo} / ${c.periodicidade}${Number(c.caucao) ? ` · caução €${c.caucao}` : ""}` : "—"}
            />
            <Linha rotulo="Km na entrega" valor={km != null ? `${km.toLocaleString("pt-PT")} km` : "—"} />
            <Linha rotulo="Combustível" valor={combustivel != null ? `${combustivel}%` : "—"} />
          </div>

          {/* Fotos */}
          {fotos.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Fotografias da entrega</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {fotos.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`Foto ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover" />
                ))}
              </div>
            </div>
          )}

          {/* Danos */}
          {danos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Danos assinalados</p>
              <ul className="space-y-0.5 text-sm text-slate-600">
                {danos.map((d, i) => (
                  <li key={i}>• {[d.zona, d.nota].filter(Boolean).join(" — ") || "—"}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Materiais */}
          {materiais.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Materiais entregues</p>
              <ul className="space-y-0.5 text-sm text-slate-600">
                {materiais.map((m, i) => (
                  <li key={i}>• {m.rotulo || "—"}{m.qtd && m.qtd > 1 ? ` ×${m.qtd}` : ""}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Assinatura */}
          {assinatura && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Assinatura</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assinatura} alt="Assinatura" className="h-24 rounded-xl border border-slate-200 bg-white object-contain p-2" />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">GoScooters · recibo de entrega da mota.</p>
            <ImprimirRecibo />
          </div>
        </div>
      </div>
    </main>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{rotulo}</span>
      <span className="text-right font-medium text-slate-900">{valor}</span>
    </div>
  );
}
