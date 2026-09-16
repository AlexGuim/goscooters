// Testes de src/lib/inicioResultado.ts (o gráfico do Resultado no Início).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  competenciasAte,
  graficoDoResultado,
  nomeDoMes,
  nomeDoMesEmMaiuscula,
  ultimoFechado,
} from "./inicioResultado.ts";

test("seis meses a acabar em setembro: cinco fechados mais o mês em curso", () => {
  assert.deepEqual(competenciasAte("2026-09", 6), [
    "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
  ]);
});

test("a janela atravessa a virada do ano", () => {
  assert.deepEqual(competenciasAte("2027-02", 6), [
    "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
  ]);
});

test("uma competência estragada não devolve meses inventados", () => {
  assert.deepEqual(competenciasAte("", 6), []);
  assert.deepEqual(competenciasAte("2026-09", 0), []);
});

test("os nomes dos meses saem em português, e com maiúscula quando abrem a frase", () => {
  assert.equal(nomeDoMes("2026-08"), "agosto");
  assert.equal(nomeDoMesEmMaiuscula("2026-08"), "Agosto");
  assert.equal(nomeDoMes("2026-13"), "");
  assert.equal(nomeDoMesEmMaiuscula("xx"), "");
});

const meses = (valores, de = 4) =>
  valores.map((resultado, i) => ({ competencia: `2026-${String(de + i).padStart(2, "0")}`, resultado }));

test("só com meses positivos, a linha do zero está no fundo e o maior enche o gráfico", () => {
  const g = graficoDoResultado(meses([500, 1000]), "2026-05");
  assert.equal(g.zero, 0);
  assert.deepEqual(
    g.colunas.map((c) => [c.altura, c.base]),
    [[50, 0], [100, 0]],
  );
});

test("com um mês negativo, a escala abre por baixo e essa coluna pendura-se da linha do zero", () => {
  const g = graficoDoResultado(meses([1000, -1000]), "2026-05");
  assert.equal(g.zero, 50);
  assert.deepEqual(
    g.colunas.map((c) => [c.altura, c.base]),
    [[50, 50], [50, 0]],
  );
});

test("só com meses negativos, a linha do zero está no topo", () => {
  const g = graficoDoResultado(meses([-200, -100]), "2026-05");
  assert.equal(g.zero, 100);
  assert.deepEqual(
    g.colunas.map((c) => [c.altura, c.base]),
    [[100, 0], [50, 50]],
  );
});

test("um mês muito pequeno continua a ver-se; um mês a zero não desenha coluna", () => {
  const g = graficoDoResultado(meses([10000, 1, 0]), "2026-06");
  assert.equal(g.colunas[1].altura, 1.5);
  assert.equal(g.colunas[2].altura, 0);
});

test("meses todos a zero não rebentam a escala", () => {
  const g = graficoDoResultado(meses([0, 0]), "2026-05");
  assert.equal(g.zero, 0);
  assert.ok(g.colunas.every((c) => c.altura === 0 && c.base === 0));
});

test("sem meses nenhuns o gráfico fica vazio, sem erro", () => {
  assert.deepEqual(graficoDoResultado([], "2026-09"), { colunas: [], zero: 0 });
});

test("só o mês de hoje leva «em curso», e cada coluna sabe o mês que é", () => {
  const g = graficoDoResultado(meses([100, 200]), "2026-05");
  assert.deepEqual(g.colunas.map((c) => c.em_curso), [false, true]);
  assert.deepEqual(g.colunas.map((c) => c.curto), ["abr", "mai"]);
  assert.deepEqual(g.colunas.map((c) => c.nome), ["abril", "maio"]);
});

test("a frase do último fechado: agosto face a julho", () => {
  // 5 meses fechados (abr..ago) + setembro em curso.
  const u = ultimoFechado(meses([700, 800, 900, 1188, 965, 300]), "2026-09");
  assert.deepEqual(u, {
    competencia: "2026-08",
    nome: "Agosto",
    resultado: 965,
    variacao: -223,
    percentagem: -19,
    nome_anterior: "julho",
  });
});

test("a percentagem sobe quando o mês foi melhor", () => {
  const u = ultimoFechado(meses([100, 150, 0]), "2026-06");
  assert.equal(u.variacao, 50);
  assert.equal(u.percentagem, 50);
});

test("com o mês anterior a zero não se inventa percentagem", () => {
  const u = ultimoFechado(meses([0, 150, 0]), "2026-06");
  assert.equal(u.variacao, 150);
  assert.equal(u.percentagem, null);
});

test("um mês anterior negativo compara-se pela distância, não pelo sinal", () => {
  // De −200 para −100 melhorou 100 €, que são 50% de 200.
  const u = ultimoFechado(meses([-200, -100, 0]), "2026-06");
  assert.equal(u.variacao, 100);
  assert.equal(u.percentagem, 50);
});

test("com um só mês fechado não há com quem comparar", () => {
  const u = ultimoFechado(meses([900, 0]), "2026-05");
  assert.equal(u.competencia, "2026-04");
  assert.equal(u.variacao, null);
  assert.equal(u.percentagem, null);
  assert.equal(u.nome_anterior, "");
});

test("sem nenhum mês fechado não há frase nenhuma", () => {
  assert.equal(ultimoFechado(meses([300]), "2026-04"), null);
  assert.equal(ultimoFechado([], "2026-09"), null);
});
