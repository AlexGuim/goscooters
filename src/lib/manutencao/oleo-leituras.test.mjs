// Testes de src/lib/manutencao/oleo.ts: as leituras de km suspeitas, o km de hoje
// e a validação do km escrito à mão. Só dados fictícios.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KM_MANUAL_ABAIXO_MAX,
  KM_POR_DIA_MAX,
  RECUO_SUSPEITO_KM,
  classificarLeituras,
  kmDeHoje,
  validarKmManual,
} from "./oleo.ts";

const l = (data, km, fonte = "manual") => ({ data, km, fonte });
const motivos = (leituras) => classificarLeituras(leituras).map((x) => [x.km, x.motivo]);

test("as constantes são as combinadas", () => {
  assert.equal(RECUO_SUSPEITO_KM, 1000);
  assert.equal(KM_POR_DIA_MAX, 300);
  assert.equal(KM_MANUAL_ABAIXO_MAX, 50);
});

test("série normal, fora de ordem: nenhuma suspeita e o km de hoje é a última leitura", () => {
  const leituras = [l("2026-09-10", 41230), l("2026-08-20", 39200), l("2026-09-01", 40300)];
  assert.deepEqual(motivos(leituras), [[39200, null], [40300, null], [41230, null]]);
  assert.deepEqual(kmDeHoje(leituras), {
    ultimaValida: { km: 41230, data: "2026-09-10", fonte: "manual" },
    porConfirmar: false,
  });
});

test("leitura anómala de 250.655 km no meio da série: suspeita e fora do km de hoje", () => {
  const leituras = [l("2026-08-01", 38000), l("2026-08-10", 250655), l("2026-08-20", 39900), l("2026-09-01", 41000)];
  assert.deepEqual(motivos(leituras), [[38000, null], [250655, "recuo"], [39900, null], [41000, null]]);
  const km = kmDeHoje(leituras);
  assert.equal(km.ultimaValida.km, 41000);
  assert.equal(km.porConfirmar, false);
});

test("leitura anómala de 250.655 km como última: conta a anterior e fica «km por confirmar»", () => {
  const leituras = [l("2026-08-20", 39900), l("2026-09-01", 41000), l("2026-09-10", 250655)];
  assert.deepEqual(motivos(leituras), [[39900, null], [41000, null], [250655, "salto"]]);
  const km = kmDeHoje(leituras);
  assert.equal(km.ultimaValida.km, 41000);
  assert.equal(km.porConfirmar, true);
});

test("salto: 300 km por dia desde a anterior ainda passa; 1 km a mais é suspeito", () => {
  assert.deepEqual(motivos([l("2026-09-01", 40000), l("2026-09-11", 43000)]), [[40000, null], [43000, null]]);
  assert.deepEqual(motivos([l("2026-09-01", 40000), l("2026-09-11", 43001)]), [[40000, null], [43001, "salto"]]);
});

test("salto: duas leituras no mesmo dia contam como 1 dia", () => {
  assert.deepEqual(motivos([l("2026-09-01", 40300), l("2026-09-01", 40000)]), [[40000, null], [40300, null]]);
  assert.deepEqual(motivos([l("2026-09-01", 40301), l("2026-09-01", 40000)]), [[40000, null], [40301, "salto"]]);
});

test("recuo: uma leitura posterior mais de 1.000 km abaixo torna a alta suspeita; 1.000 certos não", () => {
  assert.deepEqual(motivos([l("2026-09-01", 41000), l("2026-09-05", 40000)]), [[41000, null], [40000, null]]);
  assert.deepEqual(motivos([l("2026-09-01", 41001), l("2026-09-05", 40000)]), [[41001, "recuo"], [40000, null]]);
  // No mesmo dia não há «data posterior»: aí decide o salto.
  assert.deepEqual(motivos([l("2026-09-01", 41001), l("2026-09-01", 40000)]), [[40000, null], [41001, "salto"]]);
});

test("uma leitura suspeita não serve de anterior: a seguinte compara-se com a última válida", () => {
  // 45.400 fica a 400 km da suspeita, mas a 5.400 km (em 2 dias) da última válida.
  const leituras = [l("2026-09-01", 40000), l("2026-09-02", 45000), l("2026-09-03", 45400)];
  assert.deepEqual(motivos(leituras), [[40000, null], [45000, "salto"], [45400, "salto"]]);
  assert.deepEqual(kmDeHoje(leituras), {
    ultimaValida: { km: 40000, data: "2026-09-01", fonte: "manual" },
    porConfirmar: true,
  });
});

test("leituras sem km (ou com 0) ou sem data não contam", () => {
  const km = kmDeHoje([
    l("2026-09-01", 40000),
    l("2026-09-05", 0),
    { km: null, data: "2026-09-06" },
    l("", 41000),
    l("2026-09-07", Number.NaN),
  ]);
  assert.equal(km.ultimaValida.km, 40000);
  assert.equal(km.porConfirmar, false);
});

test("sem leituras: sem km de hoje e nada por confirmar", () => {
  assert.deepEqual(kmDeHoje([]), { ultimaValida: null, porConfirmar: false });
});

// ── Km escrito à mão ────────────────────────────────────────────────────────

const ULTIMA = { km: 41230, data: "2026-09-12" };

test("km manual: sem leitura anterior aceita-se", () => {
  assert.deepEqual(validarKmManual(41230, "2026-09-15", null), { resultado: "aceite" });
});

test("km manual: limite de baixo, a última leitura − 50 km", () => {
  assert.deepEqual(validarKmManual(41180, "2026-09-15", ULTIMA), { resultado: "aceite" });
  const r = validarKmManual(41179, "2026-09-15", ULTIMA);
  assert.equal(r.resultado, "precisa_confirmacao");
  assert.equal(r.minimo, 41180);
  assert.equal(r.motivo, "41.179 km é menos do que a última leitura (41.230 km a 12/09/2026).");
});

test("km manual: limite de cima, a última leitura + 300 km por cada dia desde ela", () => {
  // 3 dias depois: até 41.230 + 900 = 42.130.
  assert.deepEqual(validarKmManual(42130, "2026-09-15", ULTIMA), { resultado: "aceite" });
  const r = validarKmManual(42131, "2026-09-15", ULTIMA);
  assert.equal(r.resultado, "precisa_confirmacao");
  assert.equal(r.maximo, 42130);
  assert.equal(r.motivo, "42.131 km dá mais de 300 km por dia desde a última leitura (41.230 km a 12/09/2026).");
});

test("km manual: no dia da própria leitura conta no mínimo 1 dia", () => {
  assert.deepEqual(validarKmManual(41530, "2026-09-12", ULTIMA), { resultado: "aceite" });
  assert.equal(validarKmManual(41531, "2026-09-12", ULTIMA).resultado, "precisa_confirmacao");
  assert.equal(validarKmManual(41531, "2026-09-12", ULTIMA).maximo, 41530);
});

test("km manual: um dígito a mais (412.300 em vez de 41.230) pede confirmação", () => {
  const r = validarKmManual(412300, "2026-09-15", ULTIMA);
  assert.equal(r.resultado, "precisa_confirmacao");
  assert.match(r.motivo, /^412\.300 km dá mais de 300 km por dia/);
});

test("km manual: o que não é um km é inválido, não uma confirmação", () => {
  for (const km of [0, -10, 41230.5, Number.NaN]) {
    assert.equal(validarKmManual(km, "2026-09-15", ULTIMA).resultado, "invalido", String(km));
  }
});
