import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getDicionario } from "@/lib/dictionaries";
import { LOCALES, TAGS_HTML, isLocale, type Locale } from "@/lib/i18n";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

/** Pré-gera as duas versões do site em vez de as construir a pedido. */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;

  if (!isLocale(lang)) return {};

  const dic = await getDicionario(lang);

  // Sem metadataBase, canonical e hreflang saem relativos — os motores de busca
  // exigem URLs absolutos. Em produção define-se NEXT_PUBLIC_SITE_URL.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    metadataBase: new URL(siteUrl),
    title: { default: dic.meta.title, template: "%s | GoScooters" },
    description: dic.meta.description,
    // Diz aos motores de busca que estas páginas são traduções uma da outra,
    // em vez de conteúdo duplicado.
    alternates: {
      canonical: `/${lang}`,
      languages: Object.fromEntries(LOCALES.map((l) => [TAGS_HTML[l], `/${l}`])),
    },
  };
}

export default async function LangLayout({ children, params }: LayoutProps) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  const locale = lang as Locale;
  const dic = await getDicionario(locale);
  const whatsappNumber =
    process.env.WHATSAPP_NUMERO?.replace(/\D/g, "") || "351912345678";

  return (
    <html
      lang={TAGS_HTML[locale]}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen flex-col bg-slate-50">
          <Header locale={locale} dic={dic} whatsappNumber={whatsappNumber} />
          <div className="flex-1">{children}</div>
          <Footer locale={locale} dic={dic} whatsappNumber={whatsappNumber} />
        </div>
      </body>
    </html>
  );
}
