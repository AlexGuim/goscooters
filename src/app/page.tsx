import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import type { Moto } from "@/types/db";

const cilindradaOptions = [
  { label: "Todas", min: 0, max: Infinity },
  { label: "125 cc", min: 0, max: 125 },
  { label: "126-250 cc", min: 126, max: 250 },
  { label: "> 250 cc", min: 251, max: Infinity },
];

async function getMotas(): Promise<Moto[]> {
  const { data, error } = await supabaseServer
    .from("moto")
    .select("*")
    .eq("ativo", true)
    .neq("estado", "manutencao")
    .order("preco_mes", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

function formatEstado(moto: Moto) {
  if (moto.estado === "disponivel") {
    return { label: "Disponível", color: "bg-emerald-100 text-emerald-700" };
  }

  if (moto.estado === "alugada" && moto.disponivel_em) {
    return {
      label: `Disponível a partir de ${moto.disponivel_em}`,
      color: "bg-amber-100 text-amber-700",
    };
  }

  return { label: moto.estado, color: "bg-slate-100 text-slate-700" };
}

const whatsappNumber =
  process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

export default async function Home() {
  const motas = await getMotas();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 rounded-3xl bg-white px-5 py-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-500">GoScooters</p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-4xl">
              Aluguer de motas mensais para motoristas
            </h1>
          </div>
          <a
            className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir WhatsApp
          </a>
        </header>

        <section className="mb-8 rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">Filtrar motas</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-700">Cilindrada</span>
              <select className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500">
                {cilindradaOptions.map((option) => (
                  <option key={option.label} value={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-sm font-medium text-slate-700">Preço máximo</span>
              <input
                className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                type="number"
                placeholder="€ por mês"
              />
            </label>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Os filtros são visuais neste MVP; a página de catálogo carrega todas as motas ativas.
          </p>
        </section>

        <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {motas.length === 0 ? (
            <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
              <p className="text-lg font-semibold text-slate-900">Nenhuma mota disponível</p>
              <p className="mt-2 text-slate-600">Verifique mais tarde ou contacte-nos via WhatsApp.</p>
            </div>
          ) : (
            motas.map((moto) => {
              const estado = formatEstado(moto);

              return (
                <Link
                  key={moto.id}
                  href={`/moto/${moto.id}`}
                  className="group overflow-hidden rounded-3xl bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg flex flex-col"
                >
                  <div className="overflow-hidden rounded-t-3xl bg-slate-100 flex-shrink-0">
                    {moto.foto_urls?.[0] ? (
                      <img
                        src={moto.foto_urls[0]}
                        alt={moto.modelo}
                        className="block h-60 w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-60 items-center justify-center text-slate-500">
                        Sem imagem
                      </div>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-500">{moto.modelo}</p>
                          <h3 className="mt-2 text-xl font-semibold text-slate-950">{moto.modelo}</h3>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${estado.color}`}>
                          {estado.label}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">{moto.cilindrada ?? "—"} cc</span>
                        <span className="rounded-2xl bg-slate-100 px-3 py-2">€{moto.preco_mes} / mês</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
