// Testes de src/lib/manutencao/oleo.ts: o estado do óleo de cada mota e a próxima
// troca prevista, de ponta a ponta (leituras → trocas → estado). Só dados
// fictícios, com o dia de hoje fixo.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  A_APROXIMAR_DIAS,
  A_APROXIMAR_KM,
  ROTULO_ESTADO_OLEO,
  avaliarOleo,
  proximaTroca,
  regraOleoDoModelo,
} from "./oleo.ts";

const HOJE = "2026-09-15";
/** A data `n` dias antes de HOJE (negativo: depois). */
const antes = (n) => new Date(Date.UTC(2026, 8, 15 - n)).toISOString().slice(0, 10);
const leitura = (diasAntes, km, fonte = "manual") => ({ data: antes(diasAntes), km, fonte });
const troca = (id, diasAntes, km, extra = {}) => ({ id, tipo: "oleo", data: antes(diasAntes), km, ...extra });

const avaliar = (entrada) =>
  avaliarOleo({
    modelo: "Honda PCX 125",
    estadoOperacional: "ocupado",
    leituras: [],
    manutencoes: [],
    hoje: HOJE,
    ...entrada,
  });

test("as constantes de «A aproximar» são 250 km e 3 dias", () => {
  assert.equal(A_APROXIMAR_KM, 250);
  assert.equal(A_APROXIMAR_DIAS, 3);
  assert.deepEqual(Object.values(ROTULO_ESTADO_OLEO), ["Vencida", "A aproximar", "OK", "Sem dados", "Sem regra"]);
});

test("OK: troca há 10 dias e 1.000 km andados", () => {
  const a = avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 41000)] });
  assert.equal(a.estado, "ok");
  assert.deepEqual(a.proxima, { km: 42200, data: "2026-09-26" });
  assert.equal(a.faltaKm, 1200);
  assert.equal(a.faltaDias, 11);
  assert.deepEqual(a.ultimaTroca, { manutencaoId: "t1", data: "2026-09-05", km: 40000, origem: "tipo" });
  assert.deepEqual(a.km, { ultimaValida: { km: 41000, data: HOJE, fonte: "manual" }, porConfirmar: false });
});

test("Vencida por tempo: mais de 21 dias desde a troca", () => {
  const a = avaliar({ manutencoes: [troca("t1", 25, 40000)], leituras: [leitura(0, 41500)] });
  assert.equal(a.estado, "vencida");
  assert.equal(a.faltaDias, -4);
  assert.equal(a.faltaKm, 700);
});

test("Vencida por km: ao chegar ao km da próxima troca", () => {
  assert.equal(avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 42200)] }).faltaKm, 0);
  assert.equal(avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 42200)] }).estado, "vencida");
  const a = avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 42300)] });
  assert.equal(a.estado, "vencida");
  assert.equal(a.faltaKm, -100);
});

test("A aproximar por km: faltam 250 km ou menos", () => {
  assert.equal(avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 41950)] }).estado, "a_aproximar");
  assert.equal(avaliar({ manutencoes: [troca("t1", 10, 40000)], leituras: [leitura(0, 41949)] }).estado, "ok");
});

test("A aproximar por dias: faltam 3 dias ou menos; no próprio dia ainda não está vencida", () => {
  const estadoHa = (dias) => avaliar({ manutencoes: [troca("t1", dias, 40000)] });
  assert.equal(estadoHa(17).faltaDias, 4);
  assert.equal(estadoHa(17).estado, "ok");
  assert.equal(estadoHa(18).estado, "a_aproximar");
  assert.equal(estadoHa(21).faltaDias, 0);
  assert.equal(estadoHa(21).estado, "a_aproximar");
  assert.equal(estadoHa(22).estado, "vencida");
});

test("leitura anómala de 250.655 km como última: «km por confirmar» e só se avalia por tempo", () => {
  const a = avaliar({
    manutencoes: [troca("t1", 5, 40000)],
    leituras: [leitura(2, 40300), leitura(1, 250655)],
  });
  assert.equal(a.km.porConfirmar, true);
  assert.equal(a.km.ultimaValida.km, 40300);
  assert.equal(a.faltaKm, null);
  assert.equal(a.faltaDias, 16);
  assert.equal(a.estado, "ok"); // pelo km seria «Vencida»
});

test("leitura isolada de 250.655 km: as trocas guardam o km real e desmentem-na", () => {
  // As faturas vieram depois e, com km mais baixo, não entraram em km_registo;
  // o km ficou só nas manutenções.
  const a = avaliar({
    leituras: [leitura(40, 250655, "manutencao")],
    manutencoes: [
      troca("t1", 30, 20100),
      { id: "t2", tipo: "outro", data: antes(8), km: 22150, textos: ["Troca de óleo e filtro"] },
    ],
  });
  assert.deepEqual(a.km, {
    ultimaValida: { km: 22150, data: antes(8), fonte: "manutencao" },
    porConfirmar: false,
  });
  assert.deepEqual(a.ultimaTroca, { manutencaoId: "t2", data: antes(8), km: 22150, origem: "texto" });
  assert.equal(a.faltaKm, 2200);
  assert.equal(a.estado, "ok");
});

test("Jet 14 inativa: não se avalia, com ou sem troca", () => {
  const semTroca = avaliar({ modelo: "SYM Jet 14", estadoOperacional: "inativo" });
  assert.equal(semTroca.estado, "sem_dados");
  assert.equal(semTroca.regra.codigo, "jet14");
  assert.equal(semTroca.proxima, null);
  assert.equal(semTroca.faltaDias, null);

  const comTroca = avaliar({ modelo: "SYM Jet 14", estadoOperacional: "inativo", manutencoes: [troca("t1", 60, 9000)] });
  assert.equal(comTroca.estado, "sem_dados");
  assert.equal(comTroca.proxima, null);
});

test("Jet 14 a trabalhar: 1.000 km ou 21 dias, por confirmar", () => {
  const a = avaliar({ modelo: "SYM Jet 14", manutencoes: [troca("t1", 5, 10000)], leituras: [leitura(0, 10800)] });
  assert.equal(a.regra.porConfirmar, true);
  assert.deepEqual(a.proxima, { km: 11000, data: "2026-10-01" });
  assert.equal(a.faltaKm, 200);
  assert.equal(a.estado, "a_aproximar");
});

test("mota disponível, inativa ou em manutenção sem troca registada: Sem dados", () => {
  for (const estadoOperacional of ["disponivel", "inativo", "manutencao"]) {
    const a = avaliar({ estadoOperacional, leituras: [leitura(3, 30000)] });
    assert.equal(a.estado, "sem_dados", estadoOperacional);
    assert.equal(a.ultimaTroca, null);
  }
});

test("mota ocupada sem troca registada: Vencida, sem próxima para mostrar", () => {
  const a = avaliar({ manutencoes: [{ id: "p1", tipo: "pneus", data: antes(4), km: 30000 }] });
  assert.equal(a.estado, "vencida");
  assert.equal(a.ultimaTroca, null);
  assert.equal(a.proxima, null);
});

test("só as ocupadas ficam Vencida ou A aproximar: parada fica OK, com a próxima à vista", () => {
  const a = avaliar({ estadoOperacional: "disponivel", manutencoes: [troca("t1", 40, 30000)] });
  assert.equal(a.estado, "ok");
  assert.equal(a.faltaDias, -19);
  assert.deepEqual(a.proxima, { km: 32200, data: "2026-08-27" });
  assert.equal(avaliar({ estadoOperacional: "manutencao", manutencoes: [troca("t1", 19, 30000)] }).estado, "ok");
});

test("outros modelos: Sem regra, mesmo ocupados e com trocas", () => {
  const a = avaliar({ modelo: "Yamaha NMAX 125", manutencoes: [troca("t1", 60, 30000)] });
  assert.equal(a.estado, "sem_regra");
  assert.equal(a.regra, null);
  assert.equal(a.proxima, null);
  assert.equal(a.ultimaTroca.manutencaoId, "t1");
});

test("troca lida do texto, com o km da leitura do mesmo dia", () => {
  const a = avaliar({
    manutencoes: [{ id: "m1", tipo: "outro", data: antes(6), km: null, textos: ["Mudança de óleo e filtro"] }],
    leituras: [leitura(6, 40000, "manutencao"), leitura(0, 40600)],
  });
  assert.deepEqual(a.ultimaTroca, { manutencaoId: "m1", data: antes(6), km: 40000, origem: "texto" });
  assert.equal(a.proxima.km, 42200);
  assert.equal(a.faltaKm, 1600);
});

test("troca sem km: usa uma leitura de até 3 dias antes; sem ela, só a data", () => {
  const semKm = [troca("t1", 6, null)];
  const comLeitura = avaliar({ manutencoes: semKm, leituras: [leitura(9, 39500), leitura(0, 40000)] });
  assert.equal(comLeitura.ultimaTroca.km, 39500);
  assert.equal(comLeitura.faltaKm, 1700);

  const longe = avaliar({ manutencoes: semKm, leituras: [leitura(10, 39000), leitura(0, 40000)] });
  assert.equal(longe.ultimaTroca.km, null);
  assert.deepEqual(longe.proxima, { km: null, data: "2026-09-30" });
  assert.equal(longe.faltaKm, null);
  assert.equal(longe.estado, "ok");
});

test("um km de troca suspeito (412.300) não conta: vale a leitura válida do mesmo dia", () => {
  const a = avaliar({
    manutencoes: [troca("t1", 5, 412300)],
    leituras: [leitura(5, 41230, "manutencao"), leitura(1, 41500, "recolha")],
  });
  assert.equal(a.ultimaTroca.km, 41230);
  assert.equal(a.km.ultimaValida.km, 41500);
  assert.equal(a.km.porConfirmar, false);
  assert.equal(a.faltaKm, 1930);
});

test("a última troca é a mais recente, venham as manutenções pela ordem que vierem", () => {
  const a = avaliar({ manutencoes: [troca("nova", 5, 40000), troca("antiga", 30, 36000)] });
  assert.equal(a.ultimaTroca.manutencaoId, "nova");
});

test("próxima troca: km da troca + intervalo e data da troca + dias", () => {
  const pcx = regraOleoDoModelo("PCX");
  assert.deepEqual(proximaTroca(pcx, { km: 41230, data: "2026-09-12" }), { km: 43430, data: "2026-10-03" });
  assert.deepEqual(proximaTroca(pcx, { km: null, data: "2026-12-20" }), { km: null, data: "2027-01-10" });
});

test("o cálculo é puro: sem servidor, sem base de dados, sem relógio e só import type", () => {
  const codigo = fs
    .readFileSync(path.join(import.meta.dirname, "oleo.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /server-only/);
  assert.doesNotMatch(codigo, /supabase/i);
  assert.doesNotMatch(codigo, /Date\.now/);
  assert.doesNotMatch(codigo, /new Date\(\s*\)/);
  for (const linha of codigo.split("\n").filter((x) => /^\s*import\b/.test(x))) {
    assert.match(linha, /^import type /, linha);
  }
});
