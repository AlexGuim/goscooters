import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
