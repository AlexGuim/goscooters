// Testes de src/lib/resumoAlertas.ts (o resumo do cron para o Telegram).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumoAlertasTelegram } from "./resumoAlertas.ts";

const LINK = "https://goscooters.example/admin/notificacoes";

test("sem alertas não se envia nada", () => {
  assert.equal(resumoAlertasTelegram([], LINK), null);
});

test("conta por tipo (singular e plural), numa ordem fixa, e acaba no link", () => {
  const texto = resumoAlertasTelegram(
    ["doc_motorista_a_expirar", "seguro_a_expirar", "seguro_a_expirar", "manutencao_a_vencer"],
    LINK,
  );
  assert.equal(
    texto,
    "⚠️ *Alertas GoScooters* (4)\n\n" +
      "• 2 seguros a expirar\n" +
      "• 1 manutenção a vencer\n" +
      "• 1 documento de motorista a expirar\n\n" +
      `[Abrir as notificações](${LINK})`,
  );
});

test("tipos desconhecidos contam como outros alertas, sem o nome do tipo", () => {
  const texto = resumoAlertasTelegram(["toString", "tipo_novo_Joao", "doc_motorista_a_expirar"], LINK);
  assert.match(texto, /• 1 documento de motorista a expirar/);
  assert.match(texto, /• 2 outros alertas/);
  assert.doesNotMatch(texto, /toString|tipo_novo|Joao/);
});

test("nunca leva dados pessoais: nem nomes, nem matrículas, nem autos, nem datas", () => {
  // O detalhe que a caixa de notificações mostra (e que o Telegram levava).
  const alertas = [
    { tipo: "doc_motorista_a_expirar", detalhe: "Maria Silva — documento (2026-10-01), carta (2026-09-30)" },
    { tipo: "seguro_a_expirar", detalhe: "AA-00-BB — expira em 3 dia(s) (Fidelidade)" },
    { tipo: "manutencao_a_vencer", detalhe: "12-XY-34 — óleo (faltam 200 km) · auto 123456789" },
  ];
  const texto = resumoAlertasTelegram(alertas.map((a) => a.tipo), LINK);
  for (const proibido of ["Maria", "Silva", "AA-00-BB", "12-XY-34", "2026", "Fidelidade", "123456789", "200 km"]) {
    assert.ok(!texto.includes(proibido), `não devia conter "${proibido}"`);
  }
  // Tirando o link, nada com forma de data ou de matrícula.
  const semLink = texto.replace(/\[Abrir as notificações\]\([^)]*\)/, "");
  assert.doesNotMatch(semLink, /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}|[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}/);
});
