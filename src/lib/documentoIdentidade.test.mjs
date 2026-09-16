// Testes de src/lib/documentoIdentidade.ts (n.º e data de emissão do documento, F306).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { dataDeDocumentoValida, mesmoDocumento, normalizarNumeroDocumento } from "./documentoIdentidade.ts";

test("normalizar: tira espaços, pontos, hífenes e barras e põe em maiúsculas", () => {
  assert.equal(normalizarNumeroDocumento(" 12345678 9 zz1 "), "123456789ZZ1");
  assert.equal(normalizarNumeroDocumento("FT-123.456"), "FT123456");
  assert.equal(normalizarNumeroDocumento("AB/12\t34"), "AB1234");
  assert.equal(normalizarNumeroDocumento(null), "");
  assert.equal(normalizarNumeroDocumento(undefined), "");
});

test("mesmo documento escrito de outra forma", () => {
  assert.equal(mesmoDocumento("12345678 9 ZZ1", "123456789zz1"), true);
  assert.equal(mesmoDocumento("FT-123.456", "FT123456"), true);
  assert.equal(mesmoDocumento("", null), true);
  assert.equal(mesmoDocumento(undefined, "  "), true);
});

test("outro documento: outro n.º, ou um n.º onde não havia", () => {
  assert.equal(mesmoDocumento("123456789ZZ1", "123456789ZZ2"), false);
  assert.equal(mesmoDocumento("FT123456", "FT1234567"), false);
  assert.equal(mesmoDocumento("P1", null), false);
  assert.equal(mesmoDocumento("", "P1"), false);
});

test("data de emissão: AAAA-MM-DD que existe no calendário", () => {
  assert.equal(dataDeDocumentoValida("2021-05-10"), "2021-05-10");
  assert.equal(dataDeDocumentoValida("2024-02-29"), "2024-02-29");
  assert.equal(dataDeDocumentoValida("2000-02-29"), "2000-02-29");
  assert.equal(dataDeDocumentoValida("2019-12-31"), "2019-12-31");
});

test("data de emissão: dias e meses que não existem ficam de fora", () => {
  assert.equal(dataDeDocumentoValida("2021-06-31"), null);
  assert.equal(dataDeDocumentoValida("2019-13-05"), null);
  assert.equal(dataDeDocumentoValida("2023-02-29"), null);
  assert.equal(dataDeDocumentoValida("1900-02-29"), null);
  assert.equal(dataDeDocumentoValida("2021-00-10"), null);
  assert.equal(dataDeDocumentoValida("2021-05-00"), null);
  assert.equal(dataDeDocumentoValida("0000-01-01"), null);
});

test("data de emissão: outras formas ou vazia ficam de fora", () => {
  assert.equal(dataDeDocumentoValida("04/03/2019"), null);
  assert.equal(dataDeDocumentoValida("2019-3-4"), null);
  assert.equal(dataDeDocumentoValida(" 2019-03-04"), null);
  assert.equal(dataDeDocumentoValida("2019-03-04T00:00:00Z"), null);
  assert.equal(dataDeDocumentoValida(""), null);
  assert.equal(dataDeDocumentoValida(null), null);
  assert.equal(dataDeDocumentoValida(undefined), null);
});
