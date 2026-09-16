// Testes de src/lib/inicioBlocos.ts (o catálogo dos blocos do Início).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCOS_INICIO, MAX_BLOCOS, blocosPorOmissao } from "./inicioBlocos.ts";

test("a ordem de fábrica é Números → Cobrança → Resultado → Caixa de próxima ação", () => {
  assert.deepEqual(
    blocosPorOmissao().map((b) => b.id),
    ["numeros", "cobranca", "resultado", "acao"],
  );
});

test("por omissão a Cobrança e o Resultado são meias — é assim que ficam lado a lado", () => {
  const largura = Object.fromEntries(blocosPorOmissao().map((b) => [b.id, b.largura]));
  assert.equal(largura.cobranca, "meia");
  assert.equal(largura.resultado, "meia");
  assert.equal(largura.numeros, "toda");
  assert.equal(largura.acao, "toda");
});

test("por omissão não há blocos escondidos", () => {
  assert.ok(blocosPorOmissao().every((b) => b.visivel === true));
});

test("cada bloco tem um id só seu e um rótulo para o painel", () => {
  const ids = BLOCOS_INICIO.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BLOCOS_INICIO.every((b) => b.rotulo.trim().length > 0));
});

test("o catálogo cabe no limite de blocos que se aceita guardar", () => {
  assert.ok(BLOCOS_INICIO.length <= MAX_BLOCOS);
});

test("cada chamada devolve uma lista nova — mexer nela não estraga o catálogo", () => {
  const a = blocosPorOmissao();
  a[0].visivel = false;
  assert.equal(blocosPorOmissao()[0].visivel, true);
});
