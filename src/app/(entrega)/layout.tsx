import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GoScooters",
  description: "Aluguer de motas · Lisboa",
  // NÃO usar noindex aqui: o crawler do WhatsApp/Facebook (facebookexternalhit)
  // suprime o preview em páginas noindex. Os tokens são inadivinháveis e expiram,
  // por isso o risco de indexação é desprezável (link inválido → "Link indisponível").
};

/** Layout raiz do self-service de entrega (link público, sem conta). */
export default function EntregaRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-PT"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50">{children}</body>
    </html>
  );
}
