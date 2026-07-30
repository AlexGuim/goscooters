import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarRecibo } from "@/lib/reciboToken";
import { dataBR } from "@/lib/datas";
import { Logo } from "@/components/Logo";
import ImprimirRecibo from "./ImprimirRecibo";

interface Dano { zona?: string; nota?: string }
interface Material { rotulo?: string; qtd?: number; entregue?: boolean }
interface RegrasAceite { versao?: string; hash?: string; aceite?: boolean }

const DOC_TIPO: Record<string, string> = {
  cartao_cidadao: "Cartão de cidadão",
  titulo_residencia: "Título de residência",
  passaporte: "Passaporte",
  outro: "Documento de identificação",
};

async function sign(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from("privado").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * O texto EXATO das regras que o motorista aceitou na entrega — identificado
 * pelo HASH (SHA256 do conteúdo) guardado em vistoria.checklist.regras. As
 * regras são versionadas, por isso o hash reconstitui a versão exata mesmo que
 * as regras atuais mudem. Só se mostra texto por correspondência exata de hash:
 * a `versao` é apenas um rótulo-data e NÃO é única por idioma (PT e EN gravadas
 * no mesmo dia partilham versão), pelo que reconstituir por versão poderia
 * mostrar as regras da língua errada — inaceitável num documento contratual.
 * Sem hash (aceitações antigas), mostra-se só a versão, sem texto.
 */
async function regrasAceites(
  r: RegrasAceite | null | undefined,
): Promise<{ versao: string | null; conteudo: string } | null> {
  if (!r?.aceite) return null;
  if (r.hash) {
    const { data } = await supabaseAdmin
      .from("regras_aluguer")
      .select("versao, conteudo")
      .eq("hash", r.hash)
      .maybeSingle();
    if (data?.conteudo) return { versao: data.versao ?? r.versao ?? null, conteudo: data.conteudo };
  }
  return r.versao ? { versao: r.versao, conteudo: "" } : null;
}

export default async function ContratoRecibo({
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
    .select("numero, veiculo_id, motorista_id, preco_periodo, periodicidade, caucao, data_inicio")
    .eq("id", v.contrato_id as string)
    .maybeSingle();

  const [{ data: moto }, { data: mot }] = await Promise.all([
    c?.veiculo_id
      ? supabaseAdmin.from("moto").select("matricula, modelo").eq("id", c.veiculo_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c?.motorista_id
      ? supabaseAdmin
          .from("motorista")
          .select("nome, nif, doc_id_tipo, doc_id_numero, morada_linha1, codigo_postal, localidade, carta_numero, carta_categoria")
          .eq("id", c.motorista_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const checklist = (v.checklist ?? {}) as { danos?: Dano[]; materiais?: Material[]; regras?: RegrasAceite };
  const danos = checklist.danos ?? [];
  const materiais = (checklist.materiais ?? []).filter((m) => m.entregue !== false);
  const fotos = (await Promise.all(((v.foto_urls as string[]) ?? []).map(sign))).filter(Boolean) as string[];
  const assinatura = await sign((v.assinatura_cliente_url as string) ?? null);
  const km = (v.km as number) ?? null;
  const combustivel = (v.nivel_combustivel as number) ?? null;
  const regras = await regrasAceites(checklist.regras);

  const morada = [mot?.morada_linha1, [mot?.codigo_postal, mot?.localidade].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const docLabel = mot?.doc_id_tipo ? DOC_TIPO[mot.doc_id_tipo] ?? "Documento" : "Documento";
  const carta = [mot?.carta_numero, mot?.carta_categoria].filter(Boolean).join(" · ");
  const PERIODO: Record<string, string> = { semanal: "semana", quinzenal: "quinzena", mensal: "mês", diaria: "dia" };
  const periodo = c?.periodicidade ? PERIODO[c.periodicidade] ?? c.periodicidade : "";

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
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-500">
                Contrato de aluguer e entrega
              </p>
              <p className="text-sm text-slate-300">{v.realizada_em ? dataBR(v.realizada_em as string) : ""}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Partes */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Locadora</p>
              <p className="text-sm font-semibold text-slate-900">GoScooters</p>
              <p className="text-sm text-slate-600">Gestão e aluguer de motas · Lisboa</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Locatário (motorista)</p>
              <p className="text-sm font-semibold text-slate-900">{mot?.nome ?? "—"}</p>
              <div className="mt-1 space-y-0.5 text-sm text-slate-600">
                {mot?.nif && <p>NIF {mot.nif}</p>}
                {mot?.doc_id_numero && <p>{docLabel} {mot.doc_id_numero}</p>}
                {carta && <p>Carta {carta}</p>}
                {morada && <p>{morada}</p>}
              </div>
            </div>
          </section>

          {/* Objeto e condições */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Objeto e condições</p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Linha rotulo="Contrato" valor={c?.numero ?? "—"} />
              <Linha rotulo="Mota" valor={moto ? `${moto.matricula ?? "?"} · ${moto.modelo}` : "—"} />
              <Linha
                rotulo="Aluguer"
                valor={c?.preco_periodo ? `€${c.preco_periodo}${periodo ? ` / ${periodo}` : ""}` : "—"}
              />
              <Linha rotulo="Caução" valor={c && Number(c.caucao) ? `€${c.caucao}` : "—"} />
              <Linha rotulo="Início" valor={c?.data_inicio ? dataBR(c.data_inicio) : "—"} />
              <Linha rotulo="Km na entrega" valor={km != null ? `${km.toLocaleString("pt-PT")} km` : "—"} />
            </div>
          </section>

          {/* Regras aceites */}
          {regras && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Regras do aluguer aceites{regras.versao ? ` (v${regras.versao})` : ""}
              </p>
              {regras.conteudo ? (
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 print:max-h-none print:overflow-visible">
                  {regras.conteudo}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  O motorista aceitou as regras do aluguer{regras.versao ? ` (versão ${regras.versao})` : ""} na entrega.
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                Aceites pelo motorista na entrega{v.realizada_em ? `, em ${dataBR(v.realizada_em as string)}` : ""}.
              </p>
            </section>
          )}

          {/* Estado na entrega (recibo) */}
          <section className="space-y-4 border-t border-slate-100 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estado na entrega</p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Linha rotulo="Combustível" valor={combustivel != null ? `${combustivel}%` : "—"} />
              <Linha rotulo="Data" valor={v.realizada_em ? dataBR(v.realizada_em as string) : "—"} />
            </div>

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
          </section>

          {/* Assinatura */}
          {assinatura && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Assinatura do motorista</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assinatura} alt="Assinatura" className="h-24 rounded-xl border border-slate-200 bg-white object-contain p-2" />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">GoScooters · contrato de aluguer e recibo de entrega.</p>
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
