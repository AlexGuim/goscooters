import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

const display = Archivo({ variable: "--ff-display", subsets: ["latin"], weight: ["600", "700", "800"], display: "swap" });
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--ff-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: "Recibo de entrega | GoScooters",
  description: "Recibo de entrega da mota · GoScooters",
};

/** Layout raiz do recibo de entrega (página pública com token, sem conta). */
export default function ReciboRootLayout({
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
