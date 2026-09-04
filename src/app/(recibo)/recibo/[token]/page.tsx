import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validarRecibo } from "@/lib/reciboToken";
import { dataBR } from "@/lib/datas";
import { Logo } from "@/components/Logo";
import ImprimirRecibo from "./ImprimirRecibo";

interface Dano { zona?: string; nota?: string }
interface Material { rotulo?: string; qtd?: number; entregue?: boolean }
interface RegrasAceite { versao?: string; hash?: string; aceite?: boolean }

type Lang = "pt" | "en";

const DOC_TIPO: Record<Lang, Record<string, string>> = {
  pt: {
    cartao_cidadao: "Cartão de cidadão",
    titulo_residencia: "Título de residência",
    passaporte: "Passaporte",
    outro: "Documento de identificação",
  },
  en: {
    cartao_cidadao: "National ID card",
    titulo_residencia: "Residence permit",
    passaporte: "Passport",
    outro: "Identity document",
  },
};

/**
 * O contrato sai na língua do motorista (`idioma_preferido`). Não é cortesia: é
 * o documento que ele assina, e as regras que aceita já existem nas duas
 * línguas. Um contrato numa língua que a pessoa não lê é frágil se um dia
 * houver disputa.
 */
const T = {
  pt: {
    eyebrow: "Contrato de aluguer e entrega",
    locadora: "Locadora",
    locadoraSub: "Gestão e aluguer de motas · Lisboa",
    locatario: "Locatário (motorista)",
    nif: "NIF",
    carta: "Carta",
    objeto: "Objeto e condições",
    contrato: "Contrato",
    mota: "Mota",
    aluguer: "Aluguer",
    caucao: "Caução",
    inicio: "Início",
    kmEntrega: "Km na entrega",
    seguroTitulo: "Seguro da mota",
    seguradora: "Seguradora",
    apolice: "Apólice",
    cobertura: "Cobertura",
    validoAte: "Válido até",
    verApolice: "Ver / guardar a apólice",
    rc: "Responsabilidade civil",
    danosProprios: "Danos próprios",
    outraCobertura: "Outra",
    regrasTitulo: "Regras do aluguer aceites",
    regrasAceites: (v: string | null, d: string) =>
      `O motorista aceitou as regras do aluguer${v ? ` (versão ${v})` : ""} na entrega${d ? `, em ${d}` : ""}.`,
    regrasRodape: (d: string) => `Aceites pelo motorista na entrega${d ? `, em ${d}` : ""}.`,
    estado: "Estado na entrega",
    combustivel: "Combustível",
    data: "Data",
    fotos: "Fotografias da entrega",
    danos: "Danos assinalados",
    materiais: "Materiais entregues",
    assinatura: "Assinatura do motorista",
    rodape: "GoScooters · contrato de aluguer e recibo de entrega.",
    imprimir: "Guardar / Imprimir PDF",
    foto: "Foto",
    periodo: { semanal: "semana", quinzenal: "quinzena", mensal: "mês", diaria: "dia" } as Record<string, string>,
  },
  en: {
    eyebrow: "Rental contract and handover",
    locadora: "Lessor",
    locadoraSub: "Scooter rental & fleet management · Lisbon",
    locatario: "Lessee (rider)",
    nif: "Tax no.",
    carta: "Licence",
    objeto: "Subject and terms",
    contrato: "Contract",
    mota: "Scooter",
    aluguer: "Rent",
    caucao: "Deposit",
    inicio: "Start",
    kmEntrega: "Km at handover",
    seguroTitulo: "Scooter insurance",
    seguradora: "Insurer",
    apolice: "Policy no.",
    cobertura: "Cover",
    validoAte: "Valid until",
    verApolice: "View / save the policy",
    rc: "Third-party liability",
    danosProprios: "Comprehensive",
    outraCobertura: "Other",
    regrasTitulo: "Rental rules accepted",
    regrasAceites: (v: string | null, d: string) =>
      `The rider accepted the rental rules${v ? ` (version ${v})` : ""} at handover${d ? `, on ${d}` : ""}.`,
    regrasRodape: (d: string) => `Accepted by the rider at handover${d ? `, on ${d}` : ""}.`,
    estado: "Condition at handover",
    combustivel: "Fuel",
    data: "Date",
    fotos: "Handover photos",
    danos: "Damage noted",
    materiais: "Items handed over",
    assinatura: "Rider's signature",
    rodape: "GoScooters · rental contract and handover receipt.",
    imprimir: "Save / Print PDF",
    foto: "Photo",
    periodo: { semanal: "week", quinzenal: "fortnight", mensal: "month", diaria: "day" } as Record<string, string>,
  },
} as const;

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
          .select("nome, nif, doc_id_tipo, doc_id_numero, morada_linha1, codigo_postal, localidade, carta_numero, carta_categoria, idioma_preferido")
          .eq("id", c.motorista_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Seguro em vigor à data da entrega. O motorista tem direito a saber com que
  // cobertura anda na estrada — e a ter o comprovativo à mão numa fiscalização.
  const { data: seguro } = c?.veiculo_id
    ? await supabaseAdmin
        .from("seguro")
        .select("seguradora, apolice, tipo, data_fim, detalhe")
        .eq("veiculo_id", c.veiculo_id)
        .eq("estado", "ativa")
        .order("data_fim", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const seguroDoc =
    (seguro?.detalhe as { documento_url?: string } | null)?.documento_url ?? null;

  const lang: Lang = (mot?.idioma_preferido ?? "pt") === "en" ? "en" : "pt";
  const t = T[lang];

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
  const docLabel = mot?.doc_id_tipo ? DOC_TIPO[lang][mot.doc_id_tipo] ?? DOC_TIPO[lang].outro : DOC_TIPO[lang].outro;
  const carta = [mot?.carta_numero, mot?.carta_categoria].filter(Boolean).join(" · ");
  const periodo = c?.periodicidade ? t.periodo[c.periodicidade] ?? c.periodicidade : "";

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
                {t.eyebrow}
              </p>
              <p className="text-sm text-slate-300">{v.realizada_em ? dataBR(v.realizada_em as string) : ""}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Partes */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.locadora}</p>
              <p className="text-sm font-semibold text-slate-900">GoScooters</p>
              <p className="text-sm text-slate-600">{t.locadoraSub}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.locatario}</p>
              <p className="text-sm font-semibold text-slate-900">{mot?.nome ?? "—"}</p>
              <div className="mt-1 space-y-0.5 text-sm text-slate-600">
                {mot?.nif && <p>{t.nif} {mot.nif}</p>}
                {mot?.doc_id_numero && <p>{docLabel} {mot.doc_id_numero}</p>}
                {carta && <p>{t.carta} {carta}</p>}
                {morada && <p>{morada}</p>}
              </div>
            </div>
          </section>

          {/* Objeto e condições */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.objeto}</p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Linha rotulo={t.contrato} valor={c?.numero ?? "—"} />
              <Linha rotulo={t.mota} valor={moto ? `${moto.matricula ?? "?"} · ${moto.modelo}` : "—"} />
              <Linha
                rotulo={t.aluguer}
                valor={c?.preco_periodo ? `€${c.preco_periodo}${periodo ? ` / ${periodo}` : ""}` : "—"}
              />
              <Linha rotulo={t.caucao} valor={c && Number(c.caucao) ? `€${c.caucao}` : "—"} />
              <Linha rotulo={t.inicio} valor={c?.data_inicio ? dataBR(c.data_inicio) : "—"} />
              <Linha rotulo={t.kmEntrega} valor={km != null ? `${km.toLocaleString(lang === "en" ? "en-IE" : "pt-PT")} km` : "—"} />
            </div>
          </section>

          {/* Seguro */}
          {seguro && (
            <section className="print-junto rounded-2xl border border-slate-200 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.seguroTitulo}
              </p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Linha rotulo={t.seguradora} valor={seguro.seguradora ?? "—"} />
                <Linha rotulo={t.apolice} valor={seguro.apolice ?? "—"} />
                <Linha
                  rotulo={t.cobertura}
                  valor={
                    seguro.tipo === "danos_proprios"
                      ? t.danosProprios
                      : seguro.tipo === "responsabilidade_civil"
                        ? t.rc
                        : t.outraCobertura
                  }
                />
                <Linha rotulo={t.validoAte} valor={seguro.data_fim ? dataBR(seguro.data_fim) : "—"} />
              </div>
              {seguroDoc && (
                <a
                  href={seguroDoc}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-50 transition hover:bg-slate-900 print:hidden"
                >
                  {t.verApolice}
                </a>
              )}
            </section>
          )}

          {/* Regras aceites */}
          {regras && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.regrasTitulo}{regras.versao ? ` (v${regras.versao})` : ""}
              </p>
              {regras.conteudo ? (
                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 print:max-h-none print:overflow-visible">
                  {regras.conteudo}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  {t.regrasAceites(regras.versao, "")}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                {t.regrasRodape(v.realizada_em ? dataBR(v.realizada_em as string) : "")}
              </p>
            </section>
          )}

          {/* Estado na entrega (recibo) */}
          <section className="space-y-4 border-t border-slate-100 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.estado}</p>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <Linha rotulo={t.combustivel} valor={combustivel != null ? `${combustivel}%` : "—"} />
              <Linha rotulo={t.data} valor={v.realizada_em ? dataBR(v.realizada_em as string) : "—"} />
            </div>

            {fotos.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.fotos}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {fotos.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt={`${t.foto} ${i + 1}`} className="aspect-[4/3] w-full rounded-xl object-cover" />
                  ))}
                </div>
              </div>
            )}

            {danos.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.danos}</p>
                <ul className="space-y-0.5 text-sm text-slate-600">
                  {danos.map((d, i) => (
                    <li key={i}>• {[d.zona, d.nota].filter(Boolean).join(" — ") || "—"}</li>
                  ))}
                </ul>
              </div>
            )}

            {materiais.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.materiais}</p>
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
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.assinatura}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assinatura} alt="Assinatura" className="h-24 rounded-xl border border-slate-200 bg-white object-contain p-2" />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-400">{t.rodape}</p>
            <ImprimirRecibo rotulo={t.imprimir} />
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
