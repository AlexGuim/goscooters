// Testes de src/lib/comunicacaoTexto.ts (a mensagem ao motorista: o prompt à IA e o texto final).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localDaInfracao,
  promptComunicacao,
  textoModeloComunicacao,
  textoParaMotorista,
} from "./comunicacaoTexto.ts";
import { textoCoima } from "./lembretes.ts";

const LOCAL = "A5, pórtico de Oeiras";
const DADOS = { nome: "Ana Costa", matricula: "AA-00-BB", data: "12/07/2026", valor: "30 €" };
// O que o intake passa: os dados e o local, lado a lado.
const COM_LOCAL = { ...DADOS, local: LOCAL };
const TIPOS = ["coima", "portagem", "seguro"];

test("prompt: o local nunca vai ao Gemini, em nenhum tipo", () => {
  for (const tipo of TIPOS) {
    for (const comLocal of [true, false]) {
      const prompt = promptComunicacao(tipo, "English", COM_LOCAL, comLocal);
      for (const pedaco of [LOCAL, "A5", "Oeiras", "pórtico"]) {
        assert.ok(!prompt.includes(pedaco), `${tipo}: o prompt não devia conter "${pedaco}"`);
      }
    }
  }
});

test("prompt: o resto fica como antes (nome, matrícula, data e valor — à espera do parecer)", () => {
  assert.equal(
    promptComunicacao("coima", "English", COM_LOCAL, true),
    "Escreve UMA mensagem curta de WhatsApp, no idioma English, da equipa GoScooters (aluguer de scooters em Lisboa) para o motorista Ana Costa.\n" +
      "Contexto a comunicar: a GoScooters recebeu uma coima/multa de trânsito da mota AA-00-BB, de 12/07/2026, no valor de 30 €. Este montante fica na conta do motorista.\n" +
      "Tom cordial, direto e simples (o motorista pode ser imigrante). Sem assunto, sem assinatura formal, sem parênteses de instrução, sem placeholders. Devolve APENAS o texto da mensagem.\n" +
      "Não incluas links nem digas que segue um documento ou anexo.\n" +
      "O local vai numa linha à parte, a seguir ao texto: não o menciones.",
  );
  assert.match(
    promptComunicacao("portagem", "Português", COM_LOCAL, false),
    /Contexto a comunicar: há uma portagem por pagar da mota AA-00-BB, de 12\/07\/2026, no valor de 30 €\. Este montante fica na conta do motorista\./,
  );
});

test("prompt: só fala da linha do local quando ela existe, e nunca na carta verde", () => {
  assert.doesNotMatch(promptComunicacao("portagem", "English", DADOS, false), /linha à parte/);
  const seguro = promptComunicacao("seguro", "English", COM_LOCAL, true);
  assert.doesNotMatch(seguro, /linha à parte|Não incluas links/);
  assert.match(seguro, /carta verde\) da mota AA-00-BB\. Pede para guardar o documento \(o link vai a seguir\)\./);
});

test("local: uma linha, até 120 caracteres, e nunca na carta verde", () => {
  assert.equal(localDaInfracao("coima", "  A5,\n  pórtico   de Oeiras "), LOCAL);
  assert.equal(localDaInfracao("portagem", "x".repeat(300)).length, 120);
  assert.equal(localDaInfracao("seguro", LOCAL), "");
  assert.equal(localDaInfracao("coima", null), "");
});

test("texto final com IA: o local volta, numa linha à parte a seguir ao que a IA escreveu", () => {
  const redigido = "Hi Ana, GoScooters received a traffic fine for scooter AA-00-BB dated 12/07/2026 — amount 30 €.";
  const modelo = textoCoima(COM_LOCAL, "en");
  for (const tipo of ["coima", "portagem"]) {
    const local = localDaInfracao(tipo, LOCAL);
    assert.equal(textoParaMotorista(`  ${redigido}\n`, modelo, local), `${redigido}\n📍 ${LOCAL}`);
  }
  // Sem local (carta verde, ou auto sem local): o texto da IA tal e qual.
  assert.equal(textoParaMotorista(redigido, modelo, localDaInfracao("seguro", LOCAL)), redigido);
  assert.equal(textoParaMotorista(redigido, modelo, ""), redigido);
});

test("texto final sem IA: o template leva o local na frase, uma vez só", () => {
  for (const redigido of [null, "", "   "]) {
    for (const idioma of ["pt", "en"]) {
      const coima = textoParaMotorista(redigido, textoCoima(COM_LOCAL, idioma), LOCAL);
      const portagem = textoParaMotorista(redigido, textoModeloComunicacao("portagem", COM_LOCAL, idioma), LOCAL);
      for (const texto of [coima, portagem]) {
        assert.equal(texto.split(LOCAL).length - 1, 1, `o local devia aparecer uma vez:\n${texto}`);
        assert.doesNotMatch(texto, /📍/);
      }
    }
  }
  assert.match(textoModeloComunicacao("portagem", COM_LOCAL, "pt"), /de 12\/07\/2026, em A5, pórtico de Oeiras — valor 30 €/);
  assert.match(textoModeloComunicacao("portagem", COM_LOCAL, "en"), /on 12\/07\/2026 at A5, pórtico de Oeiras — amount 30 €/);
});

test("templates sem local: o texto de sempre (quem já os usava não muda)", () => {
  assert.equal(
    textoModeloComunicacao("portagem", { ...DADOS, local: "" }, "pt"),
    "Olá Ana Costa, a GoScooters registou uma portagem da mota AA-00-BB de 12/07/2026 — valor 30 €. Este montante fica na tua conta. Qualquer dúvida, fala connosco.",
  );
  assert.equal(
    textoModeloComunicacao("portagem", { ...DADOS, local: "" }, "fr"),
    "Hi Ana Costa, GoScooters registered a toll for scooter AA-00-BB on 12/07/2026 — amount 30 €. This amount is added to your account. Any questions, contact us.",
  );
  assert.equal(
    textoModeloComunicacao("seguro", COM_LOCAL, "en"),
    "Hi Ana Costa, here is the new insurance certificate (green card) for scooter AA-00-BB. Please keep it.",
  );
});
