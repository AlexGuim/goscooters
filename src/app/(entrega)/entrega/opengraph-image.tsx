import { ImageResponse } from "next/og";

// Cartão de pré-visualização do link de entrega/registo (WhatsApp, etc.).
// Wordmark "GoScooters" na paleta da marca — igual ao do site, sem imagem.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GoScooters";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          background: "linear-gradient(135deg, #234023 0%, #1f2933 55%, #1f2933 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 112,
              height: 112,
              borderRadius: 28,
              background: "#1f2933",
              border: "3px solid rgba(255,255,255,0.15)",
              fontSize: 58,
              fontWeight: 700,
            }}
          >
            <span style={{ color: "#84cc16" }}>G</span>
            <span style={{ color: "#ffffff" }}>S</span>
          </div>
          <span style={{ fontSize: 76, fontWeight: 800, color: "#ffffff", letterSpacing: -2 }}>
            <span style={{ color: "#84cc16" }}>Go</span>Scooters
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "rgba(255,255,255,0.7)" }}>
          Aluguer de motas · Lisboa
        </div>
      </div>
    ),
    size,
  );
}
