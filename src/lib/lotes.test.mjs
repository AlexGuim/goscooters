// Testes de src/lib/lotes.ts (os ids das consultas .in() vão aos bocados).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { partirEmLotes } from "./lotes.ts";

const ids = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);

test("lista vazia: nenhum lote (e nenhuma consulta)", () => {
  assert.deepEqual(partirEmLotes([], 100), []);
});

test("124 ids (as rendas pagas de 2026 hoje) vão em 2 lotes: 100 + 24, pela mesma ordem", () => {
  const lista = ids(124);
  const lotes = partirEmLotes(lista, 100);
  assert.deepEqual(lotes.map((l) => l.length), [100, 24]);
  assert.deepEqual(lotes.flat(), lista);
});

test("múltiplo exato do tamanho: sem lote vazio no fim", () => {
  assert.deepEqual(partirEmLotes(ids(200), 100).map((l) => l.length), [100, 100]);
});

test("nenhum lote passa do tamanho, mesmo acima dos ~250 que o gateway recusa", () => {
  const lotes = partirEmLotes(ids(301), 100);
  assert.deepEqual(lotes.map((l) => l.length), [100, 100, 100, 1]);
  assert.ok(lotes.every((l) => l.length <= 100));
});

test("lista mais pequena que o lote: um só lote com tudo", () => {
  assert.deepEqual(partirEmLotes(["a", "b"], 100), [["a", "b"]]);
});

test("não altera a lista original", () => {
  const lista = ids(5);
  const copia = [...lista];
  const lotes = partirEmLotes(lista, 2);
  lotes[0].push("intruso");
  assert.deepEqual(lista, copia);
});

test("tamanho inválido recusa-se em vez de entrar em ciclo infinito", () => {
  for (const t of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => partirEmLotes(ids(3), t), RangeError, String(t));
  }
});
