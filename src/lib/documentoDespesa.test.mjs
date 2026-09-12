// Testes das partes puras de src/lib/documentoDespesa.ts.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ehInfracao,
  caminhoDoUrlPublico,
  lerRefDocumento,
  documentoDoDetalhe,
  urlPublicoDoDocumento,
  urlDocumentoParaParceiro,
  valorParaGravar,
  destinoDoDocumento,
  podeVoltarAoPublico,
  ehUrlAssinado,
  textoComLinkDocumento,
} from "./documentoDespesa.ts";

const BASE = "https://abcd.supabase.co";
const PUBLICO = `${BASE}/storage/v1/object/public/motas/faturas/0f1e2d3c-aviso.pdf`;
const ASSINADO = `${BASE}/storage/v1/object/sign/motas/faturas/0f1e2d3c-carta.pdf?token=eyJ.abc.def`;

test("coima e portagem são infrações; o resto não", () => {
  assert.equal(ehInfracao("coima"), true);
  assert.equal(ehInfracao("portagem"), true);
  for (const c of ["fatura", "manutencao", "seguro", "apolice_seguro", "outro", "", null, undefined]) {
    assert.equal(ehInfracao(c), false, String(c));
  }
});

test("caminhoDoUrlPublico tira o caminho de um URL do bucket público", () => {
  assert.equal(caminhoDoUrlPublico(PUBLICO), "faturas/0f1e2d3c-aviso.pdf");
  assert.equal(caminhoDoUrlPublico(`${PUBLICO}?download=1`), "faturas/0f1e2d3c-aviso.pdf");
  assert.equal(
    caminhoDoUrlPublico(`${BASE}/storage/v1/object/public/motas/faturas/com%20espa%C3%A7o.pdf`),
    "faturas/com espaço.pdf",
  );
});

test("caminhoDoUrlPublico recusa o que não é do bucket público ou não é seguro", () => {
  for (const u of [
    ASSINADO,
    `${BASE}/storage/v1/object/public/privado/infracoes/x.pdf`,
    "faturas/x.pdf",
    `${BASE}/storage/v1/object/public/motas/faturas/..%2F..%2Fkyc%2Fcc.pdf`,
    `${BASE}/storage/v1/object/public/motas/`,
    `${BASE}/storage/v1/object/public/motas/faturas/%E0%A4%A`,
  ]) {
    assert.equal(caminhoDoUrlPublico(u), null, u);
  }
});

test("lerRefDocumento: URL é público, infracoes/ é privado, o resto não se reconhece", () => {
  assert.deepEqual(lerRefDocumento(PUBLICO), {
    onde: "publico",
    url: PUBLICO,
    caminho: "faturas/0f1e2d3c-aviso.pdf",
  });
  assert.deepEqual(lerRefDocumento("https://exemplo.pt/fatura.pdf"), {
    onde: "publico",
    url: "https://exemplo.pt/fatura.pdf",
    caminho: null,
  });
  assert.deepEqual(lerRefDocumento("infracoes/0f1e2d3c-aviso.pdf"), {
    onde: "privado",
    caminho: "infracoes/0f1e2d3c-aviso.pdf",
  });
  // Os outros prefixos do bucket privado (KYC, comprovativos) nunca se abrem
  // através de uma despesa — nem um caminho que tente sair de infracoes/.
  for (const v of [
    "kyc/0f1e-cc.pdf",
    "comprovativos/0f1e.png",
    "infracoes/",
    "infracoes/../kyc/cc.pdf",
    "/infracoes/x.pdf",
    "javascript:alert(1)",
    "",
    "   ",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(lerRefDocumento(v), null, String(v));
  }
});

test("documentoDoDetalhe lê só uma string não vazia", () => {
  assert.equal(documentoDoDetalhe({ documento_url: PUBLICO, valor: "2.40" }), PUBLICO);
  assert.equal(documentoDoDetalhe({ documento_url: "infracoes/a.pdf" }), "infracoes/a.pdf");
  for (const d of [{ documento_url: "" }, { documento_url: 3 }, {}, null, undefined, [], "texto"]) {
    assert.equal(documentoDoDetalhe(d), null, JSON.stringify(d));
  }
});

test("urlPublicoDoDocumento: quem não é admin nunca recebe um documento privado", () => {
  assert.equal(urlPublicoDoDocumento(PUBLICO), PUBLICO);
  assert.equal(urlPublicoDoDocumento("infracoes/0f1e2d3c-aviso.pdf"), null);
  assert.equal(urlPublicoDoDocumento("kyc/cc.pdf"), null);
  assert.equal(urlPublicoDoDocumento(null), null);
});

test("valorParaGravar normaliza o que vai para a base de dados", () => {
  assert.equal(valorParaGravar(lerRefDocumento(`  ${PUBLICO} `)), PUBLICO);
  assert.equal(valorParaGravar(lerRefDocumento("infracoes/a.pdf")), "infracoes/a.pdf");
  assert.equal(valorParaGravar(lerRefDocumento("kyc/cc.pdf")), null);
  assert.equal(valorParaGravar(null), null);
});

test("ehUrlAssinado distingue o link assinado do público permanente", () => {
  assert.equal(ehUrlAssinado(ASSINADO), true);
  assert.equal(ehUrlAssinado(PUBLICO), false);
  assert.equal(ehUrlAssinado(`${BASE}/storage/v1/object/sign/motas/x.pdf`), false); // sem token
  assert.equal(ehUrlAssinado(ASSINADO.replace("https://", "http://")), false);
  assert.equal(ehUrlAssinado(null), false);
  assert.equal(ehUrlAssinado(""), false);
});

test("coima e portagem nunca levam link; a carta verde leva só o assinado", () => {
  assert.equal(textoComLinkDocumento("  Olá, coima de 12/07 — 30 €  ", "coima", ASSINADO), "Olá, coima de 12/07 — 30 €");
  assert.equal(textoComLinkDocumento("Olá", "portagem", ASSINADO), "Olá");
  assert.equal(textoComLinkDocumento("Olá", "portagem", PUBLICO), "Olá");
  assert.equal(textoComLinkDocumento("Olá", "seguro", ASSINADO), `Olá\n${ASSINADO}`);
  assert.equal(textoComLinkDocumento("Olá", "seguro", PUBLICO), "Olá");
  assert.equal(textoComLinkDocumento("Olá", "seguro", null), "Olá");
});

test("urlDocumentoParaParceiro: coima/portagem nunca, esteja o ficheiro onde estiver", () => {
  // Um registo antigo, ainda por migrar, tem o aviso no bucket público: não sai na mesma.
  assert.equal(urlDocumentoParaParceiro("coima", PUBLICO), null);
  assert.equal(urlDocumentoParaParceiro("portagem", PUBLICO), null);
  assert.equal(urlDocumentoParaParceiro("portagem", "infracoes/a.pdf"), null);
  // As faturas continuam a abrir pelo URL público; um privado nunca.
  assert.equal(urlDocumentoParaParceiro("manutencao", PUBLICO), PUBLICO);
  assert.equal(urlDocumentoParaParceiro("seguro", PUBLICO), PUBLICO);
  assert.equal(urlDocumentoParaParceiro("manutencao", "infracoes/a.pdf"), null);
  assert.equal(urlDocumentoParaParceiro(null, PUBLICO), PUBLICO);
  assert.equal(urlDocumentoParaParceiro("outro", null), null);
});

test("destinoDoDocumento: é a categoria confirmada que decide o bucket", () => {
  const publico = lerRefDocumento(PUBLICO);
  const privado = lerRefDocumento("infracoes/0f1e2d3c-aviso.pdf");
  const externo = lerRefDocumento("https://exemplo.pt/aviso.pdf");
  // Coima/portagem: do público para privado; já privado ou link externo, fica.
  assert.equal(destinoDoDocumento(publico, "coima"), "privado");
  assert.equal(destinoDoDocumento(publico, "portagem"), "privado");
  assert.equal(destinoDoDocumento(privado, "coima"), "manter");
  assert.equal(destinoDoDocumento(externo, "portagem"), "manter");
  assert.equal(destinoDoDocumento(null, "coima"), "manter");
  // Outra categoria: um aviso em privado que afinal é fatura volta ao público.
  for (const c of ["manutencao", "seguro", "gps", "outro", null, undefined]) {
    assert.equal(destinoDoDocumento(privado, c), "publico", String(c));
    assert.equal(destinoDoDocumento(publico, c), "manter", String(c));
    assert.equal(destinoDoDocumento(null, c), "manter", String(c));
  }
});

test("podeVoltarAoPublico: nunca se outra coima/portagem usa o ficheiro, nem na dúvida", () => {
  assert.equal(podeVoltarAoPublico([]), true);
  assert.equal(podeVoltarAoPublico([{ categoria: "manutencao" }, { categoria: null }, {}]), true);
  assert.equal(podeVoltarAoPublico([{ categoria: null }, { categoria: "coima" }]), false);
  assert.equal(podeVoltarAoPublico([{ categoria: "portagem" }]), false);
  assert.equal(podeVoltarAoPublico(null), false);
});
