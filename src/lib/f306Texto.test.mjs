// Testes de src/lib/f306Texto.ts (o texto de cada campo do F306, o que falta e a entidade).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camposEmFaltaF306,
  dataPT,
  documentoParaF306,
  emissorDaCarta,
  emissorDoDocumento,
  letraLegivel,
  limparTextoF306,
  regimeDaEntidade,
  semDiacriticos,
} from "./f306Texto.ts";

test("passaporte: tipo, número, data de emissão e país emissor no mesmo campo", () => {
  assert.equal(
    documentoParaF306({ tipo: "passaporte", numero: "FZ123456", emissao: "2021-03-04", paisIso2: "br" }),
    "Passaporte n.º FZ123456 · emitido em 04/03/2021 · emissor: Brasil",
  );
});

test("sem data de emissão vai a validade; o emissor escrito na ficha prevalece", () => {
  assert.equal(
    documentoParaF306({ tipo: "titulo_residencia", numero: "A1B2C3", validade: "2027-01-31", emissor: " SEF " }),
    "Título de residência n.º A1B2C3 · válido até 31/01/2027 · emissor: SEF",
  );
});

test("cartão de cidadão: só o número, com o emissor por omissão", () => {
  assert.equal(documentoParaF306({ tipo: "cc", numero: "12345678 9 ZX0" }), "12345678 9 ZX0 · emissor: República Portuguesa");
});

test("sem número não se escreve nada", () => {
  assert.equal(documentoParaF306({ tipo: "passaporte", numero: "  ", emissao: "2021-03-04" }), "");
  assert.equal(documentoParaF306(null), "");
});

test("título de residência: SEF antes de 29/10/2023, AIMA depois, SEF/AIMA sem data", () => {
  assert.equal(emissorDoDocumento({ tipo: "titulo_residencia", numero: "1", emissao: "2022-05-01" }), "SEF");
  assert.equal(emissorDoDocumento({ tipo: "titulo_residencia", numero: "1", emissao: "2023-10-29" }), "AIMA");
  assert.equal(emissorDoDocumento({ tipo: "aima", numero: "1" }), "SEF/AIMA");
});

test("emissor vazio num passaporte sem país e num documento sem tipo", () => {
  assert.equal(emissorDoDocumento({ tipo: "passaporte", numero: "1" }), "");
  assert.equal(emissorDoDocumento({ tipo: null, numero: "1" }), "");
});

test("carta: IMT para PT, o nome do país para as outras, vazio sem país", () => {
  assert.equal(emissorDaCarta("pt"), "IMT, I.P.");
  assert.equal(emissorDaCarta("IN"), "Índia");
  assert.equal(emissorDaCarta(""), "");
});

test("dataPT só aceita AAAA-MM-DD", () => {
  assert.equal(dataPT("2026-09-15"), "15/09/2026");
  assert.equal(dataPT("15/09/2026"), "");
  assert.equal(dataPT(null), "");
});

test("entidade: PSP, GNR e ANSR ficam na ANSR; EMEL e câmaras seguem com a entidade", () => {
  assert.deepEqual(regimeDaEntidade("PSP — Divisão de Trânsito de Lisboa"), { regime: "ansr", entidade: "ANSR" });
  assert.deepEqual(regimeDaEntidade("Autoridade Nacional de Segurança Rodoviária"), { regime: "ansr", entidade: "ANSR" });
  assert.deepEqual(regimeDaEntidade(null), { regime: "ansr", entidade: "ANSR" });
  assert.deepEqual(regimeDaEntidade("EMEL"), { regime: "outro", entidade: "EMEL" });
  assert.deepEqual(regimeDaEntidade("Câmara Municipal de Vila Franca do Sol"), {
    regime: "outro",
    entidade: "Câmara Municipal de Vila Franca do Sol",
  });
});

test("sem diacríticos: romeno, turco, polaco e vietnamita ficam em letras latinas simples", () => {
  assert.equal(semDiacriticos("Ștefan Yılmaz Łukasz Nguyễn"), "Stefan Yilmaz Lukasz Nguyen");
});

test("limpar: o «ã» decomposto (NFD, como vem de um Mac) fica «ã» e não perde o til", () => {
  assert.equal(limparTextoF306("Joa\u0303o Exemplo"), "João Exemplo");
  // Uma marca invisível entre a letra e o til também não os separa.
  assert.equal(limparTextoF306("Joa\u200E\u0303o"), "João");
});

test("limpar: marcas de direção, espaço de largura zero e BOM desaparecem", () => {
  assert.equal(limparTextoF306("\uFEFF\u200EMaria\u200B Exemplo\u200F"), "Maria Exemplo");
  assert.equal(limparTextoF306("\u202AMaria\u202C \u2066Exemplo\u2069"), "Maria Exemplo");
});

test("limpar: espaço não separável, estreito, fino e quebras de linha ficam um espaço normal", () => {
  assert.equal(limparTextoF306("\u00A0Maria\u00A0Exemplo\u202F\u2009 Silva "), "Maria Exemplo Silva");
  assert.equal(limparTextoF306("Rua do Exemplo 1,\r\n1000-001 Lisboa\t"), "Rua do Exemplo 1, 1000-001 Lisboa");
});

test("limpar: os hífenes U+2010 e U+2011 ficam «-»", () => {
  assert.equal(limparTextoF306("Sá\u2011Carneiro\u2010Exemplo"), "Sá-Carneiro-Exemplo");
});

test("letra legível: as que não se veem em U+XXXX, as outras como são", () => {
  assert.equal(letraLegivel("\u0007"), "U+0007");
  assert.equal(letraLegivel("\u0483"), "U+0483");
  assert.equal(letraLegivel("\u{E0041}"), "U+E0041");
  assert.equal(letraLegivel("Ж"), "Ж");
});

const base = () => ({
  numeroAuto: "123 456 789",
  arguido: { nome: "Titular", nif: "123456789", documento: null, carta: null },
  condutor: {
    nome: "Carla Monteiro",
    domicilioFiscal: "Rua 1, 1000-001 Lisboa",
    documento: { tipo: "passaporte", numero: "X1", emissao: "2021-03-04", paisIso2: "BR" },
    carta: "C-1",
    cartaEmissor: "Brasil",
    nif: "299999999",
  },
});

test("faltas: com tudo, só os opcionais do arguido singular", () => {
  const f = camposEmFaltaF306(base(), true);
  assert.deepEqual(
    f.map((x) => [x.quem, x.campo, x.obrigatorio]),
    [
      ["arguido", "documento de identificação", false],
      ["arguido", "carta de condução", false],
    ],
  );
  assert.deepEqual(camposEmFaltaF306(base(), false), []);
});

test("faltas: sem data nem emissor do documento do condutor, os dois são obrigatórios", () => {
  const d = base();
  d.condutor.documento = { tipo: "passaporte", numero: "X1" };
  const f = camposEmFaltaF306(d, false).filter((x) => x.obrigatorio).map((x) => x.campo);
  assert.deepEqual(f, ["data de emissão do documento", "emissor do documento"]);
});

test("faltas: com a validade mas sem a emissão, a emissão fica só como aviso", () => {
  const d = base();
  d.condutor.documento = { tipo: "cc", numero: "1", validade: "2030-01-01" };
  const f = camposEmFaltaF306(d, false);
  assert.deepEqual(
    f.map((x) => [x.campo, x.obrigatorio]),
    [["data de emissão do documento (vai a validade)", false]],
  );
});

test("faltas: n.º do auto inválido e documento do condutor em falta", () => {
  const d = base();
  d.numeroAuto = "AUTO DEMO/0001";
  d.condutor.documento = { tipo: null, numero: "" };
  const campos = camposEmFaltaF306(d, false).map((x) => x.campo);
  assert.ok(campos.includes("n.º do auto (9 dígitos)"));
  assert.ok(campos.includes("documento de identificação"));
  assert.ok(!campos.includes("emissor do documento"));
});
