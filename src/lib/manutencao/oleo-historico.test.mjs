// Testes de src/lib/manutencao/oleo.ts: o histórico de manutenção de uma mota,
// com o «desde a anterior» e os selos «fora do intervalo» e «repetida?».
// Só dados fictícios.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { SELO_FORA_DO_INTERVALO, SELO_REPETIDA, TROCA_REPETIDA_DIAS, historicoManutencao } from "./oleo.ts";

const PCX = "Honda PCX 125";
const m = (id, data, tipo, km, textos) => ({ id, data, tipo, km, textos });
const historico = (manutencoes, extra = {}) => historicoManutencao({ modelo: PCX, leituras: [], manutencoes, ...extra });

test("os selos e a janela da troca repetida são os combinados", () => {
  assert.equal(SELO_FORA_DO_INTERVALO, "fora do intervalo");
  assert.equal(SELO_REPETIDA, "repetida?");
  assert.equal(TROCA_REPETIDA_DIAS, 3);
});

test("por km e data, cada linha com km · data · serviço · desde a anterior", () => {
  const h = historico([
    m("c", "2026-09-12", "oleo", 41230),
    m("a", "2026-08-03", "oleo", 36850),
    m("b", "2026-08-23", "outro", 39050, ["Mudança de óleo e filtro"]),
  ]);
  assert.deepEqual(
    h.map((x) => [x.km, x.data, x.servico, x.desdeAnterior]),
    [
      [36850, "2026-08-03", "Óleo do motor", null],
      [39050, "2026-08-23", "Óleo do motor", "+2.200 km / 20 dias desde a anterior"],
      [41230, "2026-09-12", "Óleo do motor", "+2.180 km / 20 dias desde a anterior"],
    ],
  );
  assert.deepEqual(h.map((x) => [x.kmDesdeAnterior, x.diasDesdeAnterior]), [[null, null], [2200, 20], [2180, 20]]);
  assert.ok(h.every((x) => !x.foraDoIntervalo && !x.repetida));
});

test("fora do intervalo: mais de 2.200 km ou mais de 21 dias desde a anterior; o limite certo não", () => {
  const h = historico([
    m("a", "2026-07-01", "oleo", 30000),
    m("b", "2026-07-22", "oleo", 32200), // 21 dias e 2.200 km: dentro
    m("c", "2026-08-13", "oleo", 33700), // 22 dias
    m("d", "2026-08-28", "oleo", 36000), // 2.300 km
  ]);
  assert.deepEqual(
    h.map((x) => [x.manutencaoId, x.foraDoIntervalo, x.desdeAnterior]),
    [
      ["a", false, null],
      ["b", false, "+2.200 km / 21 dias desde a anterior"],
      ["c", true, "+1.500 km / 22 dias desde a anterior"],
      ["d", true, "+2.300 km / 15 dias desde a anterior"],
    ],
  );
});

test("sem regra para o modelo, nada fica fora do intervalo", () => {
  const h = historico([m("a", "2026-06-01", "oleo", 30000), m("b", "2026-09-01", "oleo", 38000)], {
    modelo: "Yamaha NMAX 125",
  });
  assert.equal(h[1].desdeAnterior, "+8.000 km / 92 dias desde a anterior");
  assert.equal(h[1].foraDoIntervalo, false);
});

test("repetida?: duas trocas de óleo a 3 dias ou menos ficam as duas marcadas", () => {
  // «Óleo trocado» registado no dia e a fatura da oficina, 3 dias depois.
  const h = historico([
    m("a", "2026-08-12", "oleo", 37800),
    m("b", "2026-09-01", "oleo", 40000),
    m("c", "2026-09-04", "outro", 40250, ["Troca de óleo"]),
  ]);
  assert.deepEqual(h.map((x) => [x.manutencaoId, x.repetida]), [["a", false], ["b", true], ["c", true]]);
  assert.equal(h[2].desdeAnterior, "+250 km / 3 dias desde a anterior");
});

test("repetida?: a 4 dias já não", () => {
  const h = historico([m("a", "2026-09-01", "oleo", 40000), m("b", "2026-09-05", "oleo", 40300)]);
  assert.deepEqual(h.map((x) => x.repetida), [false, false]);
});

test("as outras manutenções aparecem com o seu tipo, sem contas nem selos; as contas saltam-nas", () => {
  const h = historico([
    m("a", "2026-08-01", "oleo", 30000),
    m("p", "2026-08-10", "pneus", 30900),
    m("r", "2026-08-15", "revisao", null, ["Revisão geral"]),
    m("b", "2026-08-20", "oleo", 32000),
  ]);
  assert.deepEqual(
    h.map((x) => [x.manutencaoId, x.servico, x.trocaDeOleo, x.desdeAnterior]),
    [
      ["a", "Óleo do motor", true, null],
      ["p", "Pneus (ambos)", false, null],
      ["r", "Revisão", false, null],
      ["b", "Óleo do motor", true, "+2.000 km / 19 dias desde a anterior"],
    ],
  );
});

test("uma revisão que inclui a troca de óleo diz as duas coisas e conta como troca", () => {
  const [linha] = historico([m("r", "2026-09-10", "revisao", 40000, ["Revisão dos 40.000 km com troca de óleo"])]);
  assert.equal(linha.servico, "Revisão + óleo do motor");
  assert.equal(linha.trocaDeOleo, true);
});

test("sem km: fica no lugar da sua data e mostra só os dias", () => {
  const h = historico([
    m("c", "2026-09-01", "oleo", 33000),
    m("b", "2026-08-15", "oleo", null),
    m("a", "2026-08-01", "oleo", 30000),
  ]);
  assert.deepEqual(
    h.map((x) => [x.manutencaoId, x.km, x.desdeAnterior]),
    [
      ["a", 30000, null],
      ["b", null, "14 dias desde a anterior"],
      ["c", 33000, "17 dias desde a anterior"],
    ],
  );
});

test("um km suspeito (412.300) dá lugar à leitura válida do mesmo dia", () => {
  const [linha] = historico([m("x", "2026-09-10", "oleo", 412300)], {
    leituras: [
      { data: "2026-09-10", km: 41230, fonte: "manutencao" },
      { data: "2026-09-14", km: 41500, fonte: "recolha" },
    ],
  });
  assert.equal(linha.km, 41230);
});

test("uma troca a 1 dia da anterior diz «1 dia»", () => {
  const h = historico([m("a", "2026-09-01", "oleo", 40000), m("b", "2026-09-02", "oleo", 40100)]);
  assert.equal(h[1].desdeAnterior, "+100 km / 1 dia desde a anterior");
});
