import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import type { Moto } from "@/types/db";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getMoto(id: string): Promise<Moto | null> {
  const { data, error } = await supabaseServer
    .from("moto")
    .select("*")
    .eq("id", id)
    .eq("ativo", true)
    .neq("estado", "manutencao")
    .maybeSingle();

  if (error) {
    console.error("Supabase detail query error for id=", id, error);
    return null;
  }

  return data;
}

export default async function MotoPage({ params }: PageProps) {
  const resolvedParams = await params;
  const moto = await getMoto(resolvedParams.id);
  const whatsappNumber = process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

  if (!moto) {
    notFound();
  }

  const whatsappText = encodeURIComponent(
    `Olá, tenho interesse na moto ${moto.modelo}. Está disponível para aluguer mensal?`,
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex-1">
              <div className="overflow-hidden rounded-[2rem] bg-slate-100">
                {moto.foto_urls?.[0] ? (
                  <img
                    className="h-80 w-full object-cover"
                    src={moto.foto_urls[0]}
                    alt={moto.modelo}
                  />
                ) : (
                  <div className="flex h-80 items-center justify-center text-slate-500">
                    Sem imagem disponível
                  </div>
                )}
              </div>

              {(moto.foto_urls?.length ?? 0) > 1 ? (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {moto.foto_urls?.map((url, index) => (
                    <div key={index} className="overflow-hidden rounded-3xl bg-slate-100">
                      <img
                        className="h-24 w-full object-cover"
                        src={url}
                        alt={`${moto.modelo} ${index + 1}`}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 lg:w-96 lg:flex-none lg:p-6">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Modelo</p>
                <h1 className="mt-3 text-3xl font-semibold text-slate-950">{moto.modelo}</h1>
              </div>

              <div className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Cilindrada</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{moto.cilindrada ?? "—"} cc</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Preço / mês</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">€{moto.preco_mes}</p>
                  </div>
                </div>

                <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  {moto.estado === "disponivel" ? (
                    <p className="font-semibold text-emerald-700">Disponível</p>
                  ) : moto.estado === "alugada" && moto.disponivel_em ? (
                    <p className="font-semibold text-amber-700">
                      Disponível a partir de {moto.disponivel_em}
                    </p>
                  ) : (
                    <p className="font-semibold text-slate-700">{moto.estado}</p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <a
                  className="inline-flex w-full items-center justify-center rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={`/moto/${moto.id}/pedido?modelo=${encodeURIComponent(moto.modelo)}`}
                >
                  Pedir aluguer
                </a>
                <a
                  className="inline-flex w-full items-center justify-center rounded-3xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:border-slate-400 hover:bg-slate-50"
                  href={`https://wa.me/${whatsappNumber}?text=${whatsappText}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Falar no WhatsApp
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Descrição</h2>
            <p className="text-slate-700">{moto.descricao ?? "Sem descrição disponível."}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
