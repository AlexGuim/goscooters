// Testes de src/lib/manutencao/oleo.ts: o «Km na recolha» ao terminar um
// contrato — que data leva a leitura, quando é que o km entra sem perguntas e a
// frase que fecha o ecrã. Só dados fictícios, com o dia de hoje fixo.
// Correr: node --test src/lib/manutencao/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataDaLeituraDeRecolha,
  decidirKmDaRecolha,
  lerKmEscrito,
  textoContratoTerminado,
} from "./oleo.ts";

const HOJE = "2026-09-15";
const l = (data, km) => ({ data, km, fonte: "manual" });

// ── A data da leitura ───────────────────────────────────────────────────────

test("a leitura fica na data do fim do contrato", () => {
  assert.equal(dataDaLeituraDeRecolha("2026-09-10", HOJE), "2026-09-10");
  assert.equal(dataDaLeituraDeRecolha(HOJE, HOJE), HOJE);
});

test("um fim no futuro não põe a leitura à frente de hoje", () => {
  // O gatilho fn_km_atual grava esta data na mota: uma data à frente travava as
  // leituras seguintes.
  assert.equal(dataDaLeituraDeRecolha("2026-09-30", HOJE), HOJE);
});

test("uma data que não é data fica como está (quem chama é que a recusa)", () => {
  assert.equal(dataDaLeituraDeRecolha("", HOJE), "");
  assert.equal(dataDaLeituraDeRecolha("30-09-2026", HOJE), "30-09-2026");
});

// ── O que fazer com o km escrito ────────────────────────────────────────────

const decidir = (entrada) =>
  decidirKmDaRecolha({
    data: HOJE,
    ultimaValida: l("2026-09-10", 41230),
    leituras: [l("2026-08-20", 39200), l("2026-09-10", 41230)],
    ...entrada,
  });

test("campo vazio: o contrato termina como sempre", () => {
  assert.deepEqual(decidir({ km: lerKmEscrito("") }), { acao: "sem_km" });
});

test("um km normal entra sem perguntas", () => {
  assert.deepEqual(decidir({ km: lerKmEscrito("41.930") }), { acao: "gravar", km: 41930 });
});

test("sem leituras anteriores, qualquer km entra", () => {
  assert.deepEqual(
    decidirKmDaRecolha({ km: 41930, data: HOJE, ultimaValida: null, leituras: [] }),
    { acao: "gravar", km: 41930 },
  );
});

test("um km muito acima pede confirmação, e com ela grava", () => {
  // 41.230 km a 10/09 + 300 km/dia × 5 dias = 42.730 km é o máximo sem confirmar.
  const pedido = decidir({ km: 48000 });
  assert.equal(pedido.acao, "confirmar");
  assert.match(pedido.motivo, /48\.000 km/);
  assert.deepEqual(decidir({ km: 48000, confirmado: true }), { acao: "gravar", km: 48000 });
});

test("um km abaixo da última leitura pede confirmação", () => {
  assert.equal(decidir({ km: 40000 }).acao, "confirmar");
  // Até 50 km abaixo é a folga normal de quem lê o conta-km.
  assert.deepEqual(decidir({ km: 41200 }), { acao: "gravar", km: 41200 });
});

test("o que não é um número inteiro é recusado, mesmo confirmado", () => {
  const escrito = decidir({ km: lerKmEscrito("41,5"), confirmado: true });
  assert.equal(escrito.acao, "invalido");
  assert.equal(decidir({ km: 0, confirmado: true }).acao, "invalido");
  assert.equal(decidir({ km: -100, confirmado: true }).acao, "invalido");
});

test("a mesma leitura do mesmo dia não se repete", () => {
  // A vistoria de recolha ou a fatura da oficina podem já a ter gravado.
  const decisao = decidirKmDaRecolha({
    km: 41230,
    data: "2026-09-10",
    ultimaValida: l("2026-09-10", 41230),
    leituras: [l("2026-09-10", 41230)],
  });
  assert.deepEqual(decisao, { acao: "ja_registada", km: 41230 });
});

test("o mesmo km noutro dia é uma leitura nova (a mota esteve parada)", () => {
  assert.deepEqual(decidir({ km: 41230 }), { acao: "gravar", km: 41230 });
});

// ── A frase do fim ──────────────────────────────────────────────────────────

test("a frase do fim diz o que ficou anulado e o km", () => {
  assert.equal(
    textoContratoTerminado({ anuladas: 3, km: 41930 }),
    "Contrato terminado. 3 cobrança(s) futura(s) anulada(s). Km na recolha: 41.930 km.",
  );
  assert.equal(
    textoContratoTerminado({ anuladas: 0, km: 41930 }),
    "Contrato terminado. Km na recolha: 41.930 km.",
  );
});

test("sem km, a frase diz que a leitura ficou por fazer", () => {
  assert.equal(textoContratoTerminado({}), "Contrato terminado. Sem km na recolha.");
  assert.equal(
    textoContratoTerminado({ anuladas: 1, km: null }),
    "Contrato terminado. 1 cobrança(s) futura(s) anulada(s). Sem km na recolha.",
  );
});
