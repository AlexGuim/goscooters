// Testes de src/lib/manutencao/oleo.ts: a regra do óleo por modelo e o que conta
// como troca de óleo. Só dados fictícios.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { origemTrocaDeOleo, regraOleoDoModelo, termosDeOleo } from "./oleo.ts";

test("PCX: 2.200 km ou 21 dias, com as várias grafias do modelo", () => {
  for (const modelo of ["PCX", "Honda PCX 125", "honda pcx125", "PCX-125 (2019)", "Pcx 125cc", "HONDA  P.C.X"]) {
    const r = regraOleoDoModelo(modelo);
    assert.equal(r?.codigo, "pcx", modelo);
    assert.equal(r.km, 2200);
    assert.equal(r.dias, 21);
    assert.equal(r.porConfirmar, false);
  }
});

test("Jet 14: 1.000 km ou 21 dias, por confirmar e sem avaliação enquanto inativa", () => {
  for (const modelo of ["Jet 14", "SYM Jet14", "JET-14 125", "sym jet 14 (a ar)"]) {
    const r = regraOleoDoModelo(modelo);
    assert.equal(r?.codigo, "jet14", modelo);
    assert.equal(r.km, 1000);
    assert.equal(r.dias, 21);
    assert.equal(r.porConfirmar, true);
    assert.equal(r.avaliaInativa, false);
  }
});

test("outros modelos: sem regra", () => {
  for (const modelo of ["Yamaha NMAX 125", "SYM Jet X", "Jet 4", "Renault Clio", "", null, undefined]) {
    assert.equal(regraOleoDoModelo(modelo), null, String(modelo));
  }
});

test("a regra devolvida é uma cópia: mexer nela não muda a das outras motas", () => {
  regraOleoDoModelo("PCX").km = 9999;
  assert.equal(regraOleoDoModelo("PCX").km, 2200);
});

test("conta como troca: o tipo «óleo», diga o texto o que disser", () => {
  assert.equal(origemTrocaDeOleo({ tipo: "oleo" }), "tipo");
  assert.equal(origemTrocaDeOleo({ tipo: "oleo", textos: ["Óleo da transmissão"] }), "tipo");
});

test("conta como troca: um sinónimo inequívoco do óleo do motor, com ou sem acentos", () => {
  for (const texto of [
    "Mudança de óleo e filtro",
    "TROCA DE OLEO",
    "Óleo do motor 10W40",
    "óleo motor",
    "Óleo + filtro",
    "Substituição do óleo",
    "Revisão: muda de óleo, pastilhas",
    "Revisão dos 40.000 km com troca de óleo",
  ]) {
    assert.equal(origemTrocaDeOleo({ tipo: "outro", textos: [texto] }), "texto", texto);
  }
});

test("não conta: óleo da transmissão, dos travões, o nível do óleo, ou «óleo» sozinho", () => {
  for (const texto of [
    "Óleo da transmissão",
    "Troca de óleo da transmissão",
    "Substituição do óleo da transmissão",
    "Mudança de óleo dos travões",
    "óleo travões",
    "Verificação do nível do óleo do motor",
    "Revisão geral (óleo, filtros e velas)",
    "Pastilhas de travão",
    "",
    null,
  ]) {
    assert.equal(origemTrocaDeOleo({ tipo: "revisao", textos: [texto] }), null, String(texto));
  }
});

test("com vários sinónimos ganha o mais comprido", () => {
  assert.deepEqual(termosDeOleo("Troca de óleo da transmissão"), [
    { termo: "troca de oleo da transmissao", motor: false },
  ]);
  // «mudança de óleo» (15) tapa «óleo e filtro» (13), que se sobrepõe no «óleo».
  assert.deepEqual(termosDeOleo("Mudança de óleo e filtro"), [{ termo: "mudanca de oleo", motor: true }]);
  // Sem sobreposição ficam os dois: trocaram-se os dois óleos, e o do motor conta.
  assert.deepEqual(termosDeOleo("Mudança de óleo e óleo da transmissão"), [
    { termo: "mudanca de oleo", motor: true },
    { termo: "oleo da transmissao", motor: false },
  ]);
  assert.equal(origemTrocaDeOleo({ tipo: "outro", textos: ["Mudança de óleo e óleo da transmissão"] }), "texto");
});

test("só palavras inteiras: «filtros» não é «filtro»", () => {
  assert.deepEqual(termosDeOleo("óleo e filtros"), [{ termo: "oleo e filtros", motor: true }]);
  assert.deepEqual(termosDeOleo("óleo motorizada"), []);
});

test("procura em todos os textos da manutenção", () => {
  assert.equal(origemTrocaDeOleo({ tipo: "outro", textos: [null, "Pastilhas de travão", "troca de óleo"] }), "texto");
  assert.equal(origemTrocaDeOleo({ tipo: "pneus", textos: ["Pneu traseiro"] }), null);
  assert.equal(origemTrocaDeOleo({ tipo: "outro" }), null);
});
