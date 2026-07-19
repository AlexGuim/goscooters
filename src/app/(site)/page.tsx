import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { precosDisponiveis, formatarPreco, PERIODOS } from "@/lib/precos";
import FiltrosCatalogo, { type FiltrosAtivos } from "@/components/FiltrosCatalogo";
import { getHeroImagem } from "@/lib/heroImagem";
import type { Moto, Periodo } from "@/types/db";

interface PageProps {
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
function filtrar(motas: Moto[], filtros: FiltrosAtivos): Moto[] {
  const precoMax = filtros.precoMax ? Number(filtros.precoMax) : null;
  const periodo = PERIODOS.includes(filtros.periodo as Periodo)
    ? (filtros.periodo as Periodo)
    : null;

  return motas.filter((moto) => {
    if (filtros.cilindrada && !cilindradaBate(moto, filtros.cilindrada)) {
      return false;
    }

    const precos = precosDisponiveis(moto);

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

function formatEstado(moto: Moto) {
  if (moto.estado === "disponivel") {
    return { label: "Disponível", color: "bg-emerald-100 text-emerald-700" };
  }

  if (moto.estado === "alugada" && moto.disponivel_em) {
    return {
      label: `A partir de ${moto.disponivel_em}`,
      color: "bg-amber-100 text-amber-700",
    };
  }

  return { label: moto.estado, color: "bg-slate-100 text-slate-700" };
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filtros: FiltrosAtivos = {
    periodo: param(sp, "periodo"),
    cilindrada: param(sp, "cilindrada"),
    precoMax: param(sp, "precoMax"),
  };

  const todas = await getMotas();
  const motas = filtrar(todas, filtros);
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
              Aluguer de motas em Lisboa
            </p>
            <h1 className="mt-5 text-4xl font-extrabold uppercase italic leading-tight tracking-tight text-white sm:text-6xl">
              A tua mota,
              <br />
              pelo tempo que precisares
            </h1>
            <p className="mt-6 text-lg text-white/70">
              Aluguer diário, semanal ou mensal para motoristas da Uber, Bolt e
              Glovo. Escolhe o modelo, faz o pedido e começa a trabalhar.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-8 py-4 text-sm font-bold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-600"
                href="#motas"
              >
                Ver motas
              </a>
              <a
                className="inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white/10"
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                Falar no WhatsApp
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
          Escolhe a tua mota
        </h2>

        <div className="mt-6">
          <FiltrosCatalogo ativos={filtros} total={motas.length} />
        </div>

        {motas.length === 0 ? (
          <div className="mt-8 rounded-3xl bg-white p-12 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              Nenhuma mota corresponde à procura
            </p>
            <p className="mt-2 text-slate-600">
              {todas.length > 0
                ? "Tenta alargar os filtros ou fala connosco."
                : "Volta mais tarde ou contacta-nos via WhatsApp."}
            </p>
            {todas.length > 0 && (
              <Link
                className="mt-6 inline-flex rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                href="/"
              >
                Limpar filtros
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {motas.map((moto) => {
              const estado = formatEstado(moto);
              const precos = precosDisponiveis(moto);

              return (
                <Link
                  key={moto.id}
                  href={`/moto/${moto.id}`}
                  className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="overflow-hidden bg-slate-100">
                    {moto.foto_urls?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={moto.foto_urls[0]}
                        alt={moto.modelo}
                        className="block h-56 w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-56 items-center justify-center text-slate-500">
                        Sem imagem
                      </div>
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
                            {formatarPreco(preco.valor)}
                          </span>
                          <span className="text-slate-500">
                            {" "}
                            / {preco.rotulos.unidade}
                          </span>
                        </span>
                      ))}
                    </div>

                    <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
                      Ver detalhes
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
