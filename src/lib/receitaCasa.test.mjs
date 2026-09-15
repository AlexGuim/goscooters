// Testes de src/lib/receitaCasa.ts (quanto de cada renda paga é receita da casa).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogoDeMotas, parteDaCasa, receitaDaCasa } from "./receitaCasa.ts";

// As motas e os donos como vêm da base: percentagens e valores em texto.
const DONOS = [
  { id: "dono-gs", comissao_valor: null, eh_goscooters: true },
  { id: "dono-p", comissao_valor: "25.00", eh_goscooters: false },
  { id: "dono-q", comissao_valor: "20.00", eh_goscooters: false },
];
const MOTAS = [
  { id: "mota-propria", proprietario_id: "dono-gs", comissao_valor_override: null },
  { id: "mota-parceiro", proprietario_id: "dono-p", comissao_valor_override: null },
  { id: "mota-com-override", proprietario_id: "dono-p", comissao_valor_override: "30.00" },
  { id: "mota-sem-dono", proprietario_id: null, comissao_valor_override: "30.00" },
];
const CATALOGO = catalogoDeMotas(MOTAS, DONOS);

const renda = (veiculo_id, valor_pago) => ({ veiculo_id, valor_pago });

test("frota própria: a renda inteira é receita da casa", () => {
  assert.deepEqual(parteDaCasa(renda("mota-propria", "80.00"), CATALOGO), {
    veiculo_id: "mota-propria",
    dono_id: "dono-gs",
    eh_propria: true,
    pago: 80,
    receita: 80,
  });
});

test("mota de parceiro: a receita é a renda × a comissão do dono", () => {
  const p = parteDaCasa(renda("mota-parceiro", "80.00"), CATALOGO);
  assert.equal(p.receita, 20);
  assert.equal(p.eh_propria, false);
  assert.equal(p.dono_id, "dono-p");
  assert.equal(p.pago, 80);
});

test("a comissão da própria mota manda sobre a do dono", () => {
  assert.equal(parteDaCasa(renda("mota-com-override", "80.00"), CATALOGO).receita, 24);
});

test("mota sem dono atribuído: não é receita de ninguém, nem com comissão própria", () => {
  const p = parteDaCasa(renda("mota-sem-dono", "80.00"), CATALOGO);
  assert.equal(p.receita, 0);
  assert.equal(p.dono_id, null);
  assert.equal(p.eh_propria, false);
  assert.equal(p.pago, 80); // a renda existiu: continua a contar para o turnover
});

test("mota que já não existe na base: também não é receita", () => {
  assert.equal(parteDaCasa(renda("mota-apagada", "80.00"), CATALOGO).receita, 0);
});

test("renda sem mota não conta para nada", () => {
  assert.equal(parteDaCasa(renda(null, "80.00"), CATALOGO), null);
});

test("um dono que não existe na lista é como não ter dono", () => {
  const catalogo = catalogoDeMotas([{ id: "mota-x", proprietario_id: "dono-que-sumiu" }], DONOS);
  assert.equal(parteDaCasa(renda("mota-x", "80.00"), catalogo).receita, 0);
});

test("a receita de um mês é a soma das partes, ao cêntimo", () => {
  const mes = [
    renda("mota-propria", "80.00"),
    renda("mota-parceiro", "80.00"),
    renda("mota-com-override", "33.33"),
    renda("mota-sem-dono", "80.00"),
    renda(null, "80.00"),
  ];
  // 80 + 20 + 9,999 + 0 + 0
  assert.equal(receitaDaCasa(mes, CATALOGO), 110);
  assert.equal(receitaDaCasa([], CATALOGO), 0);
});

test("dois meses somam-se em separado: cada um tem a sua receita", () => {
  const agosto = [renda("mota-parceiro", "80.00"), renda("mota-propria", "80.00")];
  const setembro = [renda("mota-parceiro", "40.00")];
  assert.equal(receitaDaCasa(agosto, CATALOGO), 100);
  assert.equal(receitaDaCasa(setembro, CATALOGO), 10);
});

test("comissão sem valor é 0%, e um valor estragado não vira NaN", () => {
  const catalogo = catalogoDeMotas(
    [
      { id: "m1", proprietario_id: "sem-taxa" },
      { id: "m2", proprietario_id: "taxa-estragada" },
    ],
    [
      { id: "sem-taxa", comissao_valor: null, eh_goscooters: false },
      { id: "taxa-estragada", comissao_valor: "vinte", eh_goscooters: false },
    ],
  );
  assert.equal(parteDaCasa(renda("m1", "80.00"), catalogo).receita, 0);
  assert.equal(parteDaCasa(renda("m2", "80.00"), catalogo).receita, 0);
  assert.equal(parteDaCasa(renda("m1", "oitenta"), catalogo).pago, 0);
});
