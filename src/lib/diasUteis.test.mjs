// Testes de src/lib/diasUteis.ts (prazo de 15 dias úteis para identificar o condutor).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { diasUteisAte, ehDiaUtil, feriadosNacionais, hojeEmLisboa, somarDiasUteis, textoDiasUteis } from "./diasUteis.ts";

test("texto do prazo: singular, plural, hoje e atraso", () => {
  assert.equal(textoDiasUteis(1), "falta 1 dia útil");
  assert.equal(textoDiasUteis(5), "faltam 5 dias úteis");
  assert.equal(textoDiasUteis(0), "acaba hoje");
  assert.equal(textoDiasUteis(-1), "passou há 1 dia útil");
});

test("hoje em Lisboa: às 23h30 UTC de verão já é o dia seguinte", () => {
  assert.equal(hojeEmLisboa(new Date("2026-07-14T23:30:00Z")), "2026-07-15");
  assert.equal(hojeEmLisboa(new Date("2026-01-14T23:30:00Z")), "2026-01-14");
});

test("feriados móveis de 2026: Sexta-feira Santa, Páscoa e Corpo de Deus", () => {
  const f = feriadosNacionais(2026);
  assert.ok(f.has("2026-04-03"));
  assert.ok(f.has("2026-04-05"));
  assert.ok(f.has("2026-06-04"));
  assert.equal(f.size, 13);
});

test("fim de semana e feriado não são dias úteis", () => {
  assert.equal(ehDiaUtil("2026-09-12"), false); // sábado
  assert.equal(ehDiaUtil("2026-10-05"), false); // Implantação da República (segunda)
  assert.equal(ehDiaUtil("2026-09-15"), true);
});

test("15 dias úteis: o próprio dia não conta e o 5 de Outubro salta-se", () => {
  // 15/09/2026 (terça) + 15 dias úteis, com o feriado de 05/10 pelo meio.
  assert.equal(somarDiasUteis("2026-09-15", 15), "2026-10-07");
});

test("prazo que cai num fim de semana passa para o dia útil seguinte", () => {
  // Sexta 11/12/2026 + 1 dia útil → segunda 14/12.
  assert.equal(somarDiasUteis("2026-12-11", 1), "2026-12-14");
});

test("dias úteis até ao prazo: positivo, zero no próprio dia e negativo depois", () => {
  assert.equal(diasUteisAte("2026-09-15", "2026-10-07"), 15);
  assert.equal(diasUteisAte("2026-10-07", "2026-10-07"), 0);
  assert.equal(diasUteisAte("2026-10-09", "2026-10-07"), -2);
});
