import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

const display = Archivo({ variable: "--ff-display", subsets: ["latin"], weight: ["600", "700", "800"], display: "swap" });
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--ff-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

/**
 * Metadata ESTÁTICA de propósito: o link vai por WhatsApp e o preview não pode
 * expor o nome do motorista nem o montante dentro da conversa (nem ao crawler).
 */
export const metadata: Metadata = {
  title: "Comprovativo de pagamento | GoScooters",
  description: "Comprovativo de pagamento · GoScooters",
  robots: { index: false, follow: false },
};

/** Layout raiz do comprovativo (página pública com token, sem conta). */
export default function ComprovativoRootLayout({
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
