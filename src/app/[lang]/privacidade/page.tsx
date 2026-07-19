import Link from "next/link";
import type { Metadata } from "next";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";

interface PageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);

  return { title: dic.privacidade.titulo };
}

export default async function PrivacidadePage({ params }: PageProps) {
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-semibold text-slate-950">
            {dic.privacidade.titulo}
          </h1>

          <div className="mt-8 space-y-8 text-slate-700">
            {dic.privacidade.seccoes.map((seccao) => (
              <section key={seccao.titulo} className="space-y-3">
                <h2 className="text-xl font-semibold text-slate-950">
                  {seccao.titulo}
                </h2>
                <p>{seccao.texto}</p>
              </section>
            ))}
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6">
            <Link
              className="text-sm font-medium text-emerald-600 transition hover:text-emerald-700"
              href={`/${locale}`}
            >
              {dic.privacidade.voltar}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
