// Testes do texto de coima de src/lib/lembretes.ts (a mensagem ao motorista sem IA).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { textoCoima } from "./lembretes.ts";

const BASE = { nome: "Ana", matricula: "AA-00-BB", data: "12/07/2026", valor: "30 €" };

test("coima: leva data, local e valor — em pt e em en", () => {
  const pt = textoCoima({ ...BASE, local: "A5, Oeiras" }, "pt");
  assert.match(pt, /12\/07\/2026, em A5, Oeiras — valor 30 €/);
  const en = textoCoima({ ...BASE, local: "A5, Oeiras" }, "en");
  assert.match(en, /dated 12\/07\/2026 at A5, Oeiras — amount 30 €/);
});

test("coima sem local: o texto de sempre (quem já o usava não muda)", () => {
  assert.equal(
    textoCoima(BASE, "pt"),
    "Olá Ana, a GoScooters recebeu uma coima da mota AA-00-BB referente a 12/07/2026 — valor 30 €. Este montante fica na tua conta. Qualquer dúvida, fala connosco.",
  );
  assert.equal(textoCoima({ ...BASE, local: null }, "en"), textoCoima(BASE, "fr"));
  assert.doesNotMatch(textoCoima({ ...BASE, local: "" }, "en"), / at /);
});

test("coima: nunca leva link", () => {
  for (const idioma of ["pt", "en"]) {
    assert.doesNotMatch(textoCoima({ ...BASE, local: "Lisboa" }, idioma), /https?:\/\//);
  }
});
