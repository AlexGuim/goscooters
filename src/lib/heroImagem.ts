import "server-only";

import fs from "node:fs";
import path from "node:path";

const CANDIDATOS = ["hero.jpg", "hero.jpeg", "hero.png", "hero.webp"];

/**
 * Procura uma imagem de fundo para o hero em public/.
 *
 * Devolve null quando não existe nenhuma, e nesse caso o hero fica só com o
 * gradiente da marca. Assim, acrescentar ou retirar a foto é largar um ficheiro
 * na pasta — sem tocar em código e sem risco de partir o layout.
 */
export function getHeroImagem(): string | null {
  const publicDir = path.join(process.cwd(), "public");

  for (const nome of CANDIDATOS) {
    try {
      if (fs.existsSync(path.join(publicDir, nome))) {
        return `/${nome}`;
      }
    } catch {
      // Sistema de ficheiros indisponível (build isolado, por exemplo):
      // segue-se sem imagem, que é o comportamento seguro.
    }
  }

  return null;
}
