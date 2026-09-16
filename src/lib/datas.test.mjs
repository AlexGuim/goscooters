// Testes de src/lib/datas.ts (o mês de hoje em Lisboa e a regra da quarta-feira).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesDeHojeEmLisboa, dataDeHojeEmLisboa, semanaDeHojeEmLisboa, mesDaSemana } from "./datas.ts";

test("um dia qualquer: o mês de Lisboa, com dois dígitos", () => {
  assert.equal(mesDeHojeEmLisboa(new Date("2026-09-15T12:00:00Z")), "2026-09");
  assert.equal(mesDeHojeEmLisboa(new Date("2026-01-02T12:00:00Z")), "2026-01");
});

test("no verão, a meia-noite e meia de Lisboa já é o mês novo (em UTC ainda não)", () => {
  // 31/08 às 23:30 UTC = 01/09 às 00:30 em Lisboa (verão, UTC+1).
  assert.equal(mesDeHojeEmLisboa(new Date("2026-08-31T23:30:00Z")), "2026-09");
});

test("no inverno Lisboa está em UTC: 31/12 às 23:30 ainda é dezembro", () => {
  assert.equal(mesDeHojeEmLisboa(new Date("2026-12-31T23:30:00Z")), "2026-12");
  assert.equal(mesDeHojeEmLisboa(new Date("2027-01-01T00:30:00Z")), "2027-01");
});

test("o formato serve para comparar com a competência de um mês", () => {
  const mes = mesDeHojeEmLisboa(new Date("2026-09-15T12:00:00Z"));
  assert.match(mes, /^\d{4}-\d{2}$/);
  const [ano, numero] = mes.split("-").map(Number);
  assert.equal(ano, 2026);
  assert.equal(numero, 9);
});

test("a semana pertence ao mês da sua quarta-feira, esteja ela de que lado estiver", () => {
  // Semana de domingo 30/08/2026 a sábado 05/09: a quarta é 02/09 → setembro.
  assert.equal(mesDaSemana("2026-08-30"), "2026-09");
  assert.equal(mesDaSemana("2026-09-05"), "2026-09");
  // Semana de 23/08 a 29/08: a quarta é 26/08 → agosto.
  assert.equal(mesDaSemana("2026-08-29"), "2026-08");
  assert.equal(mesDaSemana(null), null);
});

// ── A semana de hoje (domingo→sábado), em Lisboa ────────────────────────────

test("o dia de hoje em Lisboa vem completo, com dois dígitos", () => {
  assert.equal(dataDeHojeEmLisboa(new Date("2026-09-15T12:00:00Z")), "2026-09-15");
  assert.equal(dataDeHojeEmLisboa(new Date("2026-01-02T12:00:00Z")), "2026-01-02");
});

test("no verão, as 23:30 UTC já são do dia seguinte em Lisboa", () => {
  assert.equal(dataDeHojeEmLisboa(new Date("2026-09-15T23:30:00Z")), "2026-09-16");
});

test("a semana de hoje vai de domingo a sábado", () => {
  // 15/09/2026 é uma terça-feira: a semana é 13/09 (domingo) → 19/09 (sábado).
  assert.deepEqual(semanaDeHojeEmLisboa(new Date("2026-09-15T12:00:00Z")), {
    de: "2026-09-13",
    ate: "2026-09-19",
  });
});

test("num domingo, a semana começa nesse mesmo dia", () => {
  assert.deepEqual(semanaDeHojeEmLisboa(new Date("2026-09-13T09:00:00Z")), {
    de: "2026-09-13",
    ate: "2026-09-19",
  });
});

test("num sábado, a semana acaba nesse mesmo dia", () => {
  assert.deepEqual(semanaDeHojeEmLisboa(new Date("2026-09-19T09:00:00Z")), {
    de: "2026-09-13",
    ate: "2026-09-19",
  });
});

test("a semana pode atravessar a virada do mês e do ano", () => {
  // 31/12/2026 é uma quinta-feira: a semana vai de 27/12 a 02/01/2027.
  assert.deepEqual(semanaDeHojeEmLisboa(new Date("2026-12-31T12:00:00Z")), {
    de: "2026-12-27",
    ate: "2027-01-02",
  });
});

test("a semana é a de Lisboa: no verão, as 23:30 de sábado já são a semana seguinte", () => {
  // 19/09 às 23:30 UTC = 20/09 às 00:30 em Lisboa — domingo, semana nova.
  assert.deepEqual(semanaDeHojeEmLisboa(new Date("2026-09-19T23:30:00Z")), {
    de: "2026-09-20",
    ate: "2026-09-26",
  });
});
