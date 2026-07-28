import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

const display = Archivo({ variable: "--ff-display", subsets: ["latin"], weight: ["600", "700", "800"], display: "swap" });
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--ff-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

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
      className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50">{children}</body>
    </html>
  );
}
