import Link from "next/link";
import Image from "next/image";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  precosDisponiveis,
  formatarPreco,
  rotulosDe,
  PERIODOS,
  type RotulosPorPeriodo,
} from "@/lib/precos";
import FiltrosCatalogo, { type FiltrosAtivos } from "@/components/FiltrosCatalogo";
import { getHeroImagem } from "@/lib/heroImagem";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, type Dicionario, type Locale } from "@/lib/i18n";
import type { Moto, Periodo } from "@/types/db";

interface PageProps {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function getMotas(): Promise<Moto[]> {
  const { data, error } = await supabaseServer
    .from("moto")
    .select("*")
    .eq("ativo", true)
    .neq("estado", "manutencao")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

/** Lê um parâmetro do URL, ignorando repetições. */
function param(
  sp: Record<string, string | string[] | undefined>,
  nome: string,
): string | undefined {
  const valor = sp[nome];
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto?.trim() || undefined;
}

function cilindradaBate(moto: Moto, filtro: string): boolean {
  const cc = moto.cilindrada;
  if (cc === null) return false;

  if (filtro === "ate125") return cc <= 125;
  if (filtro === "126a250") return cc >= 126 && cc <= 250;
  if (filtro === "mais250") return cc > 250;
  return true;
}

/**
 * A filtragem acontece em memória e não na query: são poucas motas, e assim a
 * regra do preço máximo — que depende do período escolhido — fica num só sítio
 * legível, em vez de espalhada por condições SQL.
 */
function filtrar(
  motas: Moto[],
  filtros: FiltrosAtivos,
  rotulos: RotulosPorPeriodo,
): Moto[] {
  const precoMax = filtros.precoMax ? Number(filtros.precoMax) : null;
  const periodo = PERIODOS.includes(filtros.periodo as Periodo)
    ? (filtros.periodo as Periodo)
    : null;

  return motas.filter((moto) => {
    if (filtros.cilindrada && !cilindradaBate(moto, filtros.cilindrada)) {
      return false;
    }

    const precos = precosDisponiveis(moto, rotulos);

    // Com período escolhido, só interessam as motas que o oferecem.
    const relevantes = periodo ? precos.filter((p) => p.periodo === periodo) : precos;

    if (relevantes.length === 0) return false;

    if (precoMax !== null && !Number.isNaN(precoMax)) {
      // Basta um dos preços relevantes caber no orçamento.
      return relevantes.some((p) => Number(p.valor) <= precoMax);
    }

    return true;
  });
}

function formatEstado(moto: Moto, dic: Dicionario) {
  if (moto.estado === "disponivel") {
    return { label: dic.detalhe.disponivel, color: "bg-emerald-100 text-emerald-700" };
  }

  if (moto.estado === "alugada" && moto.disponivel_em) {
    return {
      label: `${dic.detalhe["disponivelA partir"]} ${moto.disponivel_em}`,
      color: "bg-amber-100 text-amber-700",
    };
  }

  return { label: moto.estado, color: "bg-slate-100 text-slate-700" };
}

export default async function Home({ params, searchParams }: PageProps) {
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);
  const rotulos = rotulosDe(dic);

  const sp = await searchParams;
  const filtros: FiltrosAtivos = {
    periodo: param(sp, "periodo"),
    cilindrada: param(sp, "cilindrada"),
    precoMax: param(sp, "precoMax"),
  };

  const todas = await getMotas();
  const motas = filtrar(todas, filtros, rotulos);
  const heroImagem = getHeroImagem();
  const whatsappNumber =
    process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-950">
        {/* Foto opcional: basta largar hero.jpg em public/. Sem ela fica o
            gradiente, exactamente como antes. */}
        {heroImagem && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heroImagem})` }}
          />
        )}

        {/* A cortina escura garante contraste do texto sobre qualquer foto —
            sem ela, uma imagem clara tornaria o título ilegível. */}
        <div
          aria-hidden
          className={
            heroImagem
              ? "absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/40"
              : "absolute inset-0 bg-gradient-to-br from-emerald-600/25 via-slate-950 to-slate-950"
          }
        />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-500">
              {dic.hero.sobretitulo}
            </p>
            <h1 className="mt-5 text-4xl font-extrabold uppercase italic leading-tight tracking-tight text-white sm:text-6xl">
              {dic.hero.titulo1}
              <br />
              {dic.hero.titulo2}
            </h1>
            <p className="mt-6 text-lg text-white/70">
              {dic.hero.subtitulo}
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-8 py-4 text-sm font-bold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-600"
                href="#motas"
              >
                {dic.hero.verMotas}
              </a>
              <a
                className="inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white/10"
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                {dic.hero.whatsapp}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Catálogo ─────────────────────────────────────────────────── */}
      <section
        id="motas"
        className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6 lg:px-8"
      >
        <h2 className="text-3xl font-extrabold uppercase italic tracking-tight text-slate-950">
          {dic.catalogo.titulo}
        </h2>

        <div className="mt-6">
          <FiltrosCatalogo
            locale={locale}
            dic={dic}
            ativos={filtros}
            total={motas.length}
          />
        </div>

        {motas.length === 0 ? (
          <div className="mt-8 rounded-3xl bg-white p-12 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              {dic.catalogo.vazioComFiltros}
            </p>
            <p className="mt-2 text-slate-600">
              {todas.length > 0
                ? dic.catalogo.vazioComFiltrosAjuda
                : dic.catalogo.vazioSemMotasAjuda}
            </p>
            {todas.length > 0 && (
              <Link
                className="mt-6 inline-flex rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                href={`/${locale}`}
              >
                {dic.catalogo.limparFiltros}
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {motas.map((moto) => {
              const estado = formatEstado(moto, dic);
              const precos = precosDisponiveis(moto, rotulos);

              return (
                <Link
                  key={moto.id}
                  href={`/${locale}/moto/${moto.id}`}
                  className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="relative overflow-hidden bg-slate-100">
                    {moto.foto_urls?.[0] ? (
                      <Image
                        src={moto.foto_urls[0]}
                        alt={moto.modelo}
                        width={640}
                        height={480}
                        // Três colunas no máximo: pede-se ao browser a largura
                        // real de apresentação, não a da imagem original.
                        sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        className="block h-56 w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center text-slate-500">
                        {dic.catalogo.semImagem}
                      </div>
                    )}

                    {/* Selo de vídeo: só quando a mota tem um. */}
                    {moto.video_url && (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/75 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                        <span className="h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
                        {dic.video.selo}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-xl font-bold text-slate-950">{moto.modelo}</h3>
                      <span
                        className={`flex-none rounded-full px-3 py-1 text-xs font-semibold ${estado.color}`}
                      >
                        {estado.label}
                      </span>
                    </div>

                    {moto.cilindrada && (
                      <p className="mt-1 text-sm text-slate-500">{moto.cilindrada} cc</p>
                    )}

                    {/* Só aparecem os períodos com preço definido. */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {precos.map((preco) => (
                        <span
                          key={preco.periodo}
                          className="rounded-2xl bg-slate-100 px-3 py-2 text-sm"
                        >
                          <span className="font-semibold text-slate-950">
                            {formatarPreco(preco.valor, locale)}
                          </span>
                          <span className="text-slate-500">
                            {" "}
                            / {preco.rotulos.unidade}
                          </span>
                        </span>
                      ))}
                    </div>

                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
                      {dic.catalogo.verDetalhes}
                      <span aria-hidden className="transition group-hover:translate-x-1">
                        →
                      </span>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
