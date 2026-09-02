import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

const display = Archivo({ variable: "--ff-display", subsets: ["latin"], weight: ["600", "700", "800"], display: "swap" });
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--ff-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

/**
 * Metadata ESTÁTICA de propósito: o link vai por WhatsApp e o preview não pode
 * expor o nome do parceiro nem o valor a receber dentro da conversa.
 */
export const metadata: Metadata = {
  title: "Extrato do acerto | GoScooters",
  description: "Extrato mensal do acerto · GoScooters",
  robots: { index: false, follow: false },
};

/** Layout raiz do extrato de acerto (página pública com token, sem conta). */
export default function AcertoRootLayout({
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
