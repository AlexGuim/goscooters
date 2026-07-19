import { ImageResponse } from "next/og";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GoScooters";

/**
 * Cartão de pré-visualização usado quando o link é partilhado no WhatsApp,
 * Facebook ou LinkedIn. Gerado no servidor a partir da paleta da marca, para
 * não depender de nenhum ficheiro de imagem.
 */
export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  // `params` é uma Promise nesta versão — sem o await, lang saía undefined e as
  // duas línguas geravam a mesma imagem em português.
  const { lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #234023 0%, #1f2933 55%, #1f2933 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "#1f2933",
              border: "3px solid rgba(255,255,255,0.15)",
              fontSize: 38,
              fontWeight: 700,
            }}
          >
            <span style={{ color: "#84cc16" }}>G</span>
            <span style={{ color: "#ffffff" }}>S</span>
          </div>
          <span
            style={{
              fontSize: 40,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: -1,
            }}
          >
            <span style={{ color: "#84cc16" }}>Go</span>Scooters
          </span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1.1,
            marginTop: 48,
            maxWidth: 900,
          }}
        >
          {`${dic.hero.titulo1} ${dic.hero.titulo2}`}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "rgba(255,255,255,0.7)",
            marginTop: 28,
          }}
        >
          {dic.hero.sobretitulo}
        </div>
      </div>
    ),
    size,
  );
}
