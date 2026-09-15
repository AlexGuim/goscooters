// Testes de src/lib/manutencao/oleo.ts: a lista da frota — que motas passam em
// cada filtro e por que ordem aparecem. Só dados fictícios, com o dia de hoje fixo.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROTULO_FILTRO_OLEO,
  avaliarOleo,
  compararUrgenciaOleo,
  passaFiltroOleo,
  urgenciaOleo,
} from "./oleo.ts";

const HOJE = "2026-09-15";
const antes = (n) => new Date(Date.UTC(2026, 8, 15 - n)).toISOString().slice(0, 10);
const leitura = (diasAntes, km) => ({ data: antes(diasAntes), km, fonte: "manual" });
const troca = (diasAntes, km) => ({ id: `m${diasAntes}`, tipo: "oleo", data: antes(diasAntes), km });

const avaliar = (entrada) =>
  avaliarOleo({
    modelo: "Honda PCX 125",
    estadoOperacional: "ocupado",
    leituras: [],
    manutencoes: [],
    hoje: HOJE,
    ...entrada,
  });

// As motas de exemplo, uma por situação.
const SEM_TROCA = avaliar({ leituras: [leitura(0, 41000)] });
const VENCIDA_9_DIAS = avaliar({ manutencoes: [troca(30, 40000)], leituras: [leitura(0, 41000)] });
const VENCIDA_640_KM = avaliar({ manutencoes: [troca(10, 40000)], leituras: [leitura(0, 42840)] });
const A_APROXIMAR = avaliar({ manutencoes: [troca(10, 40000)], leituras: [leitura(0, 42020)] });
const OK = avaliar({ manutencoes: [troca(5, 40000)], leituras: [leitura(0, 41000)] });
const SEM_DADOS = avaliar({ estadoOperacional: "disponivel" });
const SEM_REGRA = avaliar({ modelo: "Toyota Yaris", manutencoes: [troca(10, 40000)] });

test("os estados de exemplo são os que se espera", () => {
  assert.equal(SEM_TROCA.estado, "vencida");
  assert.equal(VENCIDA_9_DIAS.estado, "vencida");
  assert.equal(VENCIDA_640_KM.estado, "vencida");
  assert.equal(A_APROXIMAR.estado, "a_aproximar");
  assert.equal(OK.estado, "ok");
  assert.equal(SEM_DADOS.estado, "sem_dados");
  assert.equal(SEM_REGRA.estado, "sem_regra");
});

test("os filtros são Vencidas, A aproximar e Todas", () => {
  assert.deepEqual(Object.values(ROTULO_FILTRO_OLEO), ["Vencidas", "A aproximar", "Todas"]);
});

test("«Vencidas» só mostra as vencidas", () => {
  assert.equal(passaFiltroOleo("vencida", "vencidas"), true);
  for (const estado of ["a_aproximar", "ok", "sem_dados", "sem_regra"]) {
    assert.equal(passaFiltroOleo(estado, "vencidas"), false, estado);
  }
});

test("«A aproximar» só mostra as que estão a chegar", () => {
  assert.equal(passaFiltroOleo("a_aproximar", "a_aproximar"), true);
  for (const estado of ["vencida", "ok", "sem_dados", "sem_regra"]) {
    assert.equal(passaFiltroOleo(estado, "a_aproximar"), false, estado);
  }
});

test("«Todas» não esconde nada, nem os carros sem regra", () => {
  for (const estado of ["vencida", "a_aproximar", "ok", "sem_dados", "sem_regra"]) {
    assert.equal(passaFiltroOleo(estado, "todas"), true, estado);
  }
});

test("a urgência é a parte do intervalo que falta, pelo que aperta mais", () => {
  // Troca hoje: falta o intervalo inteiro, por km e por dias.
  assert.equal(urgenciaOleo(avaliar({ manutencoes: [troca(0, 41000)], leituras: [leitura(0, 41000)] })), 1);
  // Metade dos dias andados e quase nenhum km: manda o tempo.
  const meio = avaliar({ manutencoes: [troca(11, 40000)], leituras: [leitura(0, 40100)] });
  assert.ok(Math.abs(urgenciaOleo(meio) - 10 / 21) < 1e-9);
  // Vencida sem troca registada vai à frente de todas; sem regra fica no fim.
  assert.equal(urgenciaOleo(SEM_TROCA), -Infinity);
  assert.equal(urgenciaOleo(SEM_REGRA), Infinity);
});

test("a lista põe à frente o que aperta mais, e no fim o que não se avalia", () => {
  const motas = [
    { id: "ok", a: OK },
    { id: "sem_regra", a: SEM_REGRA },
    { id: "vencida_km", a: VENCIDA_640_KM },
    { id: "sem_dados", a: SEM_DADOS },
    { id: "a_aproximar", a: A_APROXIMAR },
    { id: "sem_troca", a: SEM_TROCA },
    { id: "vencida_dias", a: VENCIDA_9_DIAS },
  ];
  const ordenadas = [...motas].sort((x, y) => compararUrgenciaOleo(x.a, y.a)).map((m) => m.id);
  assert.deepEqual(ordenadas, [
    "sem_troca",
    "vencida_dias",
    "vencida_km",
    "a_aproximar",
    "ok",
    "sem_dados",
    "sem_regra",
  ]);
});

test("com a mesma urgência, a ordem não muda (o desempate é de quem chama)", () => {
  assert.equal(compararUrgenciaOleo(OK, OK), 0);
  assert.equal(compararUrgenciaOleo(SEM_TROCA, SEM_TROCA), 0, "duas vencidas sem registo");
  assert.equal(compararUrgenciaOleo(SEM_REGRA, SEM_REGRA), 0, "dois carros sem regra");
});
