// Testes de src/lib/inicioCobranca.ts (as duas contas do bloco Cobrança do Início).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { emAtraso, semanaDeRendas } from "./inicioCobranca.ts";

test("em atraso: soma o que falta e conta as cobranças", () => {
  assert.deepEqual(emAtraso([{ em_falta: "40.00" }, { em_falta: "35.50" }, { em_falta: 12 }]), {
    valor: 87.5,
    n: 3,
  });
});

test("em atraso: sem nada em atraso é mesmo zero, e zero cobranças", () => {
  assert.deepEqual(emAtraso([]), { valor: 0, n: 0 });
});

test("em atraso: soma ao cêntimo, sem as sobras da vírgula flutuante", () => {
  const r = emAtraso([{ em_falta: "0.1" }, { em_falta: "0.2" }]);
  assert.equal(r.valor, 0.3);
});

/** Uma renda por liquidar, com valores por omissão. */
const renda = (campos) => ({
  valor_devido: "50",
  valor_pago: "0",
  desconto: "0",
  em_falta: "50",
  estado_liquidacao: "por_liquidar",
  ...campos,
});

test("a semana: recebido de quanto, e o que falta", () => {
  const r = semanaDeRendas([
    renda({ valor_pago: "50", em_falta: "0", estado_liquidacao: "liquidada" }),
    renda({ valor_pago: "20", em_falta: "30", estado_liquidacao: "parcial" }),
    renda({}),
  ]);
  assert.deepEqual(r, { devido: 150, recebido: 70, falta: 80, n: 3 });
});

test("a semana: o desconto abate ao devido — não se cobra a mota que esteve na oficina", () => {
  const r = semanaDeRendas([renda({ desconto: "20", valor_pago: "30", em_falta: "0", estado_liquidacao: "liquidada" })]);
  assert.deepEqual(r, { devido: 30, recebido: 30, falta: 0, n: 1 });
});

test("a semana: uma renda anulada nunca foi devida — fica fora de tudo", () => {
  const r = semanaDeRendas([renda({}), renda({ estado_liquidacao: "anulada", em_falta: "0" })]);
  assert.deepEqual(r, { devido: 50, recebido: 0, falta: 50, n: 1 });
});

test("a semana: uma perda continua a ter sido devida, mas já não falta", () => {
  const r = semanaDeRendas([renda({ estado_liquidacao: "incobravel", em_falta: "0" })]);
  assert.deepEqual(r, { devido: 50, recebido: 0, falta: 0, n: 1 });
});

test("a semana: sem rendas, tudo a zero", () => {
  assert.deepEqual(semanaDeRendas([]), { devido: 0, recebido: 0, falta: 0, n: 0 });
});

test("um valor estragado não vira NaN no ecrã", () => {
  const r = semanaDeRendas([renda({ valor_devido: null, desconto: undefined, valor_pago: "abc", em_falta: "10" })]);
  assert.deepEqual(r, { devido: 0, recebido: 0, falta: 10, n: 1 });
  assert.equal(emAtraso([{ em_falta: "" }]).valor, 0);
});
