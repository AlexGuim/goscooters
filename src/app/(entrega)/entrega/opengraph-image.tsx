import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

// Cartão de pré-visualização do link de entrega/registo (WhatsApp, etc.).
// Usa o logo da marca (og-logo.png, colocado ao lado deste ficheiro).
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GoScooters";

export default async function OpenGraphImage() {
  const logo = await readFile(new URL("./og-logo.png", import.meta.url));
  const dataUri = `data:image/png;base64,${logo.toString("base64")}`;

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
          gap: 28,
          background: "linear-gradient(135deg, #234023 0%, #1f2933 60%)",
        }}
      >
        <div
          style={{
            display: "flex",
            padding: 24,
            borderRadius: 40,
            background: "#ffffff",
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          }}
        >
          <img src={dataUri} alt="GoScooters" width={360} height={360} style={{ borderRadius: 24 }} />
        </div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 36, fontWeight: 700 }}>
          GoScooters · Lisboa
        </div>
      </div>
    ),
    { ...size },
  );
}
