// Testes de src/lib/manutencao/oleo.ts: o que aparece no ecrã — o km escrito à
// mão, a leitura repetida e os textos do estado e da próxima troca. Só dados
// fictícios, com o dia de hoje fixo.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarOleo,
  avisoDoKmConfirmado,
  lerKmEscrito,
  leituraJaRegistada,
  rotuloEstadoOleo,
  textoAposOleoTrocado,
  textoEstadoOleo,
  textoProximaTroca,
} from "./oleo.ts";

const HOJE = "2026-09-15";
/** A data `n` dias antes de HOJE. */
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

const estadoDe = (entrada) => textoEstadoOleo(avaliar(entrada));

// ── O km escrito à mão ──────────────────────────────────────────────────────

test("o campo do km aceita as grafias que o gestor escreve", () => {
  assert.equal(lerKmEscrito("41230"), 41230);
  assert.equal(lerKmEscrito("41.230"), 41230);
  assert.equal(lerKmEscrito(" 41 230 "), 41230);
  assert.equal(lerKmEscrito("41 230"), 41230);
});

test("campo vazio é «sem km», e o resto é inválido", () => {
  assert.equal(lerKmEscrito(""), null);
  assert.equal(lerKmEscrito("   "), null);
  assert.equal(lerKmEscrito(null), null);
  assert.ok(Number.isNaN(lerKmEscrito("41,5")));
  assert.ok(Number.isNaN(lerKmEscrito("abc")));
  assert.ok(Number.isNaN(lerKmEscrito("-5")));
});

test("a mesma leitura no mesmo dia não se grava outra vez", () => {
  const leituras = [leitura(3, 40000), leitura(0, 41230)];
  assert.equal(leituraJaRegistada(leituras, 41230, HOJE), true);
  // Com hora agarrada à data, é o mesmo dia.
  assert.equal(leituraJaRegistada([{ km: 41230, data: `${HOJE}T08:30:00Z` }], 41230, HOJE), true);
  assert.equal(leituraJaRegistada(leituras, 41231, HOJE), false, "km diferente");
  assert.equal(leituraJaRegistada(leituras, 41230, antes(1)), false, "dia diferente");
  assert.equal(leituraJaRegistada([], 41230, HOJE), false);
});

// ── A próxima troca ─────────────────────────────────────────────────────────

test("a próxima troca sai como «aos 43.430 km ou a 07/10»", () => {
  assert.equal(textoProximaTroca({ km: 43430, data: "2026-10-07" }), "aos 43.430 km ou a 07/10");
});

test("sem km fiável, a próxima troca é só a data", () => {
  assert.equal(textoProximaTroca({ km: null, data: "2026-10-07" }), "a 07/10");
  assert.equal(textoProximaTroca(null), null);
});

// ── O estado em poucas palavras ─────────────────────────────────────────────

test("vencida por tempo: «vencida há 9 dias»", () => {
  // Troca há 30 dias (mais 21 da regra: venceu há 9) e ainda longe do km.
  assert.equal(
    estadoDe({ manutencoes: [troca(30, 40000)], leituras: [leitura(0, 41000)] }),
    "vencida há 9 dias",
  );
});

test("vencida por km: «+640 km»", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(10, 40000)], leituras: [leitura(0, 42840)] }),
    "+640 km",
  );
});

test("vencida pelos dois: o tempo e o km, um ao lado do outro", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(25, 40000)], leituras: [leitura(0, 42320)] }),
    "vencida há 4 dias · +120 km",
  );
});

test("chegar ao km certo não é «+0 km»: diz-se que chegou", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(10, 40000)], leituras: [leitura(0, 42200)] }),
    "chegou ao km",
  );
});

test("a aproximar por km: «faltam 180 km»", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(10, 40000)], leituras: [leitura(0, 42020)] }),
    "faltam 180 km",
  );
});

test("a aproximar por tempo: «falta 1 dia», no singular", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(20, 40000)], leituras: [leitura(0, 41000)] }),
    "falta 1 dia",
  );
});

test("no próprio dia da troca prevista: «é hoje»", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(21, 40000)], leituras: [leitura(0, 41000)] }),
    "é hoje",
  );
});

test("OK: «faltam 1.200 km ou 16 dias»", () => {
  assert.equal(
    estadoDe({ manutencoes: [troca(5, 40000)], leituras: [leitura(0, 41000)] }),
    "faltam 1.200 km ou 16 dias",
  );
});

test("mota parada com a data passada: «passou há 9 dias», e não «vencida»", () => {
  assert.equal(
    estadoDe({
      estadoOperacional: "disponivel",
      manutencoes: [troca(30, 40000)],
      leituras: [leitura(0, 41000)],
    }),
    "passou há 9 dias",
  );
});

// ── O selo do estado ────────────────────────────────────────────────────────

test("mota parada com o óleo já passado: «Parada», e não um «OK» verde", () => {
  const parada = avaliar({
    estadoOperacional: "disponivel",
    manutencoes: [troca(30, 40000)],
    leituras: [leitura(0, 41000)],
  });
  assert.equal(parada.estado, "ok");
  assert.equal(parada.passou, true);
  assert.equal(rotuloEstadoOleo(parada), "Parada");
});

test("com a troca ainda longe, a mota parada continua «OK»", () => {
  const parada = avaliar({
    estadoOperacional: "disponivel",
    manutencoes: [troca(5, 40000)],
    leituras: [leitura(0, 41000)],
  });
  assert.equal(parada.passou, false);
  assert.equal(rotuloEstadoOleo(parada), "OK");
});

test("numa mota ocupada, o rótulo é o estado de sempre", () => {
  const vencida = avaliar({ manutencoes: [troca(30, 40000)], leituras: [leitura(0, 41000)] });
  assert.equal(rotuloEstadoOleo(vencida), "Vencida");
  assert.equal(rotuloEstadoOleo(avaliar({})), "Vencida");
  assert.equal(rotuloEstadoOleo(avaliar({ estadoOperacional: "disponivel" })), "Sem dados");
});

// ── O aviso da caixa «Confirmo este km» ─────────────────────────────────────

test("o km confirmado passa a ser o da mota quando é a leitura mais recente", () => {
  const frase = "Ao gravar, passa a ser o km da mota.";
  assert.equal(avisoDoKmConfirmado(HOJE, { km: 41230, data: antes(3) }), frase);
  assert.equal(avisoDoKmConfirmado(HOJE, { km: 41230, data: HOJE }), frase, "no mesmo dia ainda manda");
  assert.equal(avisoDoKmConfirmado(HOJE, null), frase);
});

test("numa data antiga, o km fica no histórico e não muda o km atual", () => {
  assert.equal(
    avisoDoKmConfirmado(antes(7), { km: 41230, data: antes(2) }),
    "Fica no histórico da mota, mas não muda o km atual (há leituras mais recentes).",
  );
});

test("sem troca registada, diz-se isso mesmo", () => {
  assert.equal(estadoDe({ leituras: [leitura(0, 41000)] }), "sem troca registada");
  assert.equal(estadoDe({ estadoOperacional: "disponivel" }), "sem troca registada");
});

test("Jet 14 inativa: não se avalia enquanto estiver parada", () => {
  assert.equal(
    estadoDe({ modelo: "SYM Jet 14", estadoOperacional: "inativo", manutencoes: [troca(10, 40000)] }),
    "não se avalia enquanto inativa",
  );
});

test("modelo sem regra: «sem regra para o modelo»", () => {
  assert.equal(estadoDe({ modelo: "Toyota Yaris", manutencoes: [troca(10, 40000)] }), "sem regra para o modelo");
});

test("com a última leitura suspeita, o km não conta e diz-se «km por confirmar»", () => {
  assert.equal(
    estadoDe({
      manutencoes: [troca(10, 40000)],
      leituras: [leitura(5, 41000), leitura(0, 250655)],
    }),
    "faltam 11 dias · km por confirmar",
  );
});

// ── A frase depois de gravar ────────────────────────────────────────────────

test("depois de gravar, a próxima troca vem em km e em data", () => {
  const a = avaliar({ manutencoes: [troca(0, 41000)], leituras: [leitura(0, 41000)] });
  assert.equal(textoAposOleoTrocado(a), "Próxima troca aos 43.200 km ou a 06/10");
});

test("sem km na troca, a próxima é só a data", () => {
  const a = avaliar({ manutencoes: [{ id: "m1", tipo: "oleo", data: HOJE, km: null }] });
  assert.equal(textoAposOleoTrocado(a), "Próxima troca a 06/10");
});

test("sem regra ou com a mota inativa, diz-se porque não há próxima", () => {
  const semRegra = avaliar({ modelo: "Toyota Yaris", manutencoes: [troca(0, 41000)] });
  assert.equal(textoAposOleoTrocado(semRegra), "Sem próxima troca prevista: o modelo não tem regra do óleo");
  const inativa = avaliar({
    modelo: "SYM Jet 14",
    estadoOperacional: "inativo",
    manutencoes: [troca(0, 41000)],
  });
  assert.equal(textoAposOleoTrocado(inativa), "Sem próxima troca prevista enquanto a mota estiver inativa");
});
