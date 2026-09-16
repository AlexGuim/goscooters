// Testes de src/lib/coimasLista.ts (situação e ordem das coimas na tab Coimas).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ABERTAS,
  DIAS_ANTIGA_SEM_PROCESSO,
  DIAS_UTEIS_A_ACABAR,
  compararUrgencia,
  ehAntiga,
  situacaoDaCoima,
} from "./coimasLista.ts";

test("situação: enviada e não aplicável ganham a qualquer prazo", () => {
  assert.equal(situacaoDaCoima("enviada", -3), "enviada");
  assert.equal(situacaoDaCoima("nao_aplicavel", 1), "nao_aplicavel");
});

test("situação: sem processo ou sem prazo → sem data de notificação", () => {
  assert.equal(situacaoDaCoima(null, null), "sem_prazo");
  assert.equal(situacaoDaCoima("por_identificar", null), "sem_prazo");
});

test("situação: sem processo e com a infração antiga → anterior ao processo", () => {
  assert.equal(situacaoDaCoima(null, null, true), "anterior");
  // Com processo, a antiguidade não conta: o prazo é que manda.
  assert.equal(situacaoDaCoima("por_identificar", -10, true), "em_atraso");
});

test("situação pelos dias úteis: passou, acaba hoje, no limite do alerta, com folga", () => {
  assert.equal(situacaoDaCoima("por_identificar", -1), "em_atraso");
  assert.equal(situacaoDaCoima("gerada", 0), "a_acabar");
  assert.equal(situacaoDaCoima("assinada", DIAS_UTEIS_A_ACABAR), "a_acabar");
  assert.equal(situacaoDaCoima("por_identificar", DIAS_UTEIS_A_ACABAR + 1), "em_curso");
});

test("abertas: as quatro situações com trabalho por fazer", () => {
  assert.deepEqual([...ABERTAS].sort(), ["a_acabar", "em_atraso", "em_curso", "sem_prazo"]);
});

test("antiga: mais de DIAS_ANTIGA_SEM_PROCESSO dias desde a infração", () => {
  assert.equal(DIAS_ANTIGA_SEM_PROCESSO, 45);
  assert.equal(ehAntiga("2026-07-01", "2026-08-15"), false); // 45 dias
  assert.equal(ehAntiga("2026-07-01", "2026-08-16"), true); // 46 dias
  assert.equal(ehAntiga("sem data", "2026-08-16"), false);
});

test("ordem: prazo passado, a acabar, sem data, em curso, enviadas, anteriores, não aplicáveis", () => {
  const linha = (situacao, dias, data_infracao = "2026-08-01") => ({ situacao, dias, data_infracao });
  const ordenadas = [
    linha("nao_aplicavel", null),
    linha("anterior", null),
    linha("enviada", null),
    linha("em_curso", 12),
    linha("sem_prazo", null),
    linha("a_acabar", 2),
    linha("em_atraso", -1),
  ].sort(compararUrgencia);
  assert.deepEqual(
    ordenadas.map((l) => l.situacao),
    ["em_atraso", "a_acabar", "sem_prazo", "em_curso", "enviada", "anterior", "nao_aplicavel"],
  );
});

test("no mesmo grupo: o prazo mais curto primeiro; sem prazo, a infração mais recente", () => {
  const a = { situacao: "a_acabar", dias: 4, data_infracao: "2026-08-01" };
  const b = { situacao: "a_acabar", dias: 1, data_infracao: "2026-07-01" };
  assert.deepEqual([a, b].sort(compararUrgencia), [b, a]);
  const c = { situacao: "sem_prazo", dias: null, data_infracao: "2026-07-01" };
  const d = { situacao: "sem_prazo", dias: null, data_infracao: "2026-09-01" };
  assert.deepEqual([c, d].sort(compararUrgencia), [d, c]);
});
