import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

const display = Archivo({ variable: "--ff-display", subsets: ["latin"], weight: ["600", "700", "800"], display: "swap" });
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--ff-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: "Portal do parceiro | GoScooters",
  robots: { index: false, follow: false },
};

/**
 * Layout raiz do portal do parceiro. Vive separado do admin e do site público
 * (cada um precisa do seu próprio <html lang>). Sempre em português por agora.
 */
export default function PortalRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-PT"
      className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50">{children}</body>
    </html>
  );
}
