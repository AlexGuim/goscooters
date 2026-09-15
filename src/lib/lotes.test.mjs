// Testes de src/lib/lotes.ts (os ids das consultas .in() vão aos bocados, e as
// leituras grandes vão página a página).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { partirEmLotes, intervaloDaPagina } from "./lotes.ts";

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

test("a 1.ª página começa na linha 0 e o fim é inclusivo, como o .range() do Supabase", () => {
  assert.deepEqual(intervaloDaPagina(0, 1000), { de: 0, ate: 999 });
});

test("as páginas seguintes encaixam sem saltar nem repetir nenhuma linha", () => {
  const p0 = intervaloDaPagina(0, 1000);
  const p1 = intervaloDaPagina(1, 1000);
  const p2 = intervaloDaPagina(2, 1000);
  assert.equal(p1.de, p0.ate + 1);
  assert.equal(p2.de, p1.ate + 1);
  assert.deepEqual(p2, { de: 2000, ate: 2999 });
});

test("página ou tamanho inválidos recusam-se em vez de ler o intervalo errado", () => {
  for (const t of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => intervaloDaPagina(0, t), RangeError, `tamanho ${t}`);
  }
  for (const i of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => intervaloDaPagina(i, 1000), RangeError, `página ${i}`);
  }
});
