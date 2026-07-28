import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "../globals.css";

// Identidade "Asfalto & Volt": Archivo (display/títulos/nav), Inter (UI/corpo,
// cobertura multilingue + algarismos tabulares), IBM Plex Mono (IDs/valores).
const display = Archivo({
  variable: "--ff-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});
const ui = Inter({ variable: "--ff-ui", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Administração | GoScooters",
  // A administração nunca deve aparecer em resultados de pesquisa.
  robots: { index: false, follow: false },
};

/**
 * Layout raiz da administração.
 *
 * Vive separado do site público porque este fica sempre em português — é usado
 * só por quem gere a plataforma — enquanto o público muda de idioma. Cada um
 * precisa do seu próprio <html lang>, e só um layout raiz o pode definir.
 */
export default function AdminRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-PT"
      className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
