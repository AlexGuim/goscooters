import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { precosDisponiveis, formatarPreco, rotulosDe } from "@/lib/precos";
import GaleriaMota from "@/components/GaleriaMota";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, preencher, type Locale } from "@/lib/i18n";
import type { Moto } from "@/types/db";

interface PageProps {
  params: Promise<{ id: string; lang: string }>;
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
  const { id, lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);
  const moto = await getMoto(id);
  const whatsappNumber = process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

  if (!moto) {
    notFound();
  }

  const precos = precosDisponiveis(moto, rotulosDe(dic));

  const whatsappText = encodeURIComponent(
    preencher(dic.detalhe.mensagemWhatsapp, { modelo: moto.modelo }),
  );

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex-1">
              <GaleriaMota
                fotos={moto.foto_urls ?? []}
                modelo={moto.modelo}
                dic={dic}
              />
            </div>

            <div className="space-y-6 rounded-3xl border border-slate-200 bg-slate-50 p-5 lg:w-96 lg:flex-none lg:p-6">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-500">
                  {dic.detalhe.modelo}
                </p>
                <h1 className="mt-3 text-3xl font-semibold text-slate-950">{moto.modelo}</h1>
              </div>

              <div className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
                <div>
                  <p className="text-sm text-slate-500">{dic.detalhe.cilindrada}</p>
                  <p className="mt-1 text-xl font-semibold text-slate-950">
                    {moto.cilindrada ? `${moto.cilindrada} cc` : "—"}
                  </p>
                </div>

                {/* A grelha ajusta-se ao número de períodos oferecidos. */}
                <div>
                  <p className="text-sm text-slate-500">
                    {precos.length === 1 ? dic.detalhe.preco : dic.detalhe.precos}
                  </p>
                  <div
                    className={`mt-2 grid gap-2 ${
                      precos.length === 1 ? "grid-cols-1" : "grid-cols-2"
                    }`}
                  >
                    {precos.map((preco) => (
                      <div
                        key={preco.periodo}
                        className="rounded-2xl bg-slate-50 px-4 py-3"
                      >
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                          {preco.rotulos.nome}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          {formatarPreco(preco.valor, locale)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {dic.detalhe.por} {preco.rotulos.unidade}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  {moto.estado === "disponivel" ? (
                    <p className="font-semibold text-emerald-700">{dic.detalhe.disponivel}</p>
                  ) : moto.estado === "alugada" && moto.disponivel_em ? (
                    <p className="font-semibold text-amber-700">
                      {dic.detalhe["disponivelA partir"]} {moto.disponivel_em}
                    </p>
                  ) : (
                    <p className="font-semibold text-slate-700">{moto.estado}</p>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <a
                  className="inline-flex w-full items-center justify-center rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={`/${locale}/moto/${moto.id}/pedido`}
                >
                  {dic.detalhe.pedirAluguer}
                </a>
                <a
                  className="inline-flex w-full items-center justify-center rounded-3xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:border-slate-400 hover:bg-slate-50"
                  href={`https://wa.me/${whatsappNumber}?text=${whatsappText}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dic.detalhe.whatsapp}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">{dic.detalhe.descricao}</h2>
            <p className="text-slate-700">{moto.descricao ?? dic.detalhe.semDescricao}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
