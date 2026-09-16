// Testes de src/lib/inicioBlocos.ts (o catálogo dos blocos do Início).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCOS_INICIO,
  MAX_BLOCOS,
  MAX_BYTES,
  blocosPorOmissao,
  compactarEscolha,
  lerEscolhaDoInicio,
  tamanhoEmBytes,
  validarEscolha,
} from "./inicioBlocos.ts";

test("a ordem de fábrica é Números → Cobrança → Resultado → Caixa de próxima ação", () => {
  assert.deepEqual(
    blocosPorOmissao().map((b) => b.id),
    ["numeros", "cobranca", "resultado", "acao"],
  );
});

test("por omissão a Cobrança e o Resultado são meias — é assim que ficam lado a lado", () => {
  const largura = Object.fromEntries(blocosPorOmissao().map((b) => [b.id, b.largura]));
  assert.equal(largura.cobranca, "meia");
  assert.equal(largura.resultado, "meia");
  assert.equal(largura.numeros, "toda");
  assert.equal(largura.acao, "toda");
});

test("por omissão não há blocos escondidos", () => {
  assert.ok(blocosPorOmissao().every((b) => b.visivel === true));
});

test("cada bloco tem um id só seu e um rótulo para o painel", () => {
  const ids = BLOCOS_INICIO.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BLOCOS_INICIO.every((b) => b.rotulo.trim().length > 0));
});

test("o catálogo cabe no limite de blocos que se aceita guardar", () => {
  assert.ok(BLOCOS_INICIO.length <= MAX_BLOCOS);
});

test("cada chamada devolve uma lista nova — mexer nela não estraga o catálogo", () => {
  const a = blocosPorOmissao();
  a[0].visivel = false;
  assert.equal(blocosPorOmissao()[0].visivel, true);
});

// ── A escolha do gestor ─────────────────────────────────────────────────────

const ids = (blocos) => blocos.map((b) => b.id);

test("sem escolha guardada, o Início é o de fábrica", () => {
  for (const nada of [undefined, null, "", 0, [], { v: 2, blocos: [] }, { blocos: ["numeros:t"] }]) {
    assert.deepEqual(lerEscolhaDoInicio(nada), blocosPorOmissao());
  }
});

test("a escolha guardada manda na ordem, na largura e no que está escondido", () => {
  const blocos = lerEscolhaDoInicio({
    v: 1,
    blocos: ["resultado:t", "-numeros:t", "cobranca:m", "acao:m"],
  });
  assert.deepEqual(ids(blocos), ["resultado", "numeros", "cobranca", "acao"]);
  assert.deepEqual(
    blocos.map((b) => [b.largura, b.visivel]),
    [["toda", true], ["toda", false], ["meia", true], ["meia", true]],
  );
});

test("um bloco que já não existe é ignorado, sem estragar o resto", () => {
  const blocos = lerEscolhaDoInicio({ v: 1, blocos: ["tempo:m", "cobranca:m"] });
  assert.equal(ids(blocos).includes("tempo"), false);
  assert.equal(ids(blocos)[0], "cobranca");
});

test("um bloco NOVO aparece visível no fim — nunca nasce escondido", () => {
  const blocos = lerEscolhaDoInicio({ v: 1, blocos: ["-numeros:t"] });
  assert.equal(ids(blocos)[0], "numeros");
  assert.equal(blocos[0].visivel, false);
  // Os restantes do catálogo entraram todos, e visíveis.
  assert.equal(blocos.length, BLOCOS_INICIO.length);
  assert.ok(blocos.slice(1).every((b) => b.visivel));
});

test("ids repetidos contam uma vez", () => {
  const blocos = lerEscolhaDoInicio({ v: 1, blocos: ["cobranca:m", "cobranca:t"] });
  assert.equal(ids(blocos).filter((id) => id === "cobranca").length, 1);
  assert.equal(blocos[0].largura, "meia");
});

test("uma largura que não se perceba volta à do catálogo", () => {
  const [bloco] = lerEscolhaDoInicio({ v: 1, blocos: ["cobranca:x"] });
  assert.equal(bloco.largura, "meia");
  assert.equal(bloco.visivel, true);
});

test("uma lista maior do que o limite lê-se como se não houvesse escolha", () => {
  const blocos = Array.from({ length: MAX_BLOCOS + 1 }, () => "numeros:t");
  assert.deepEqual(lerEscolhaDoInicio({ v: 1, blocos }), blocosPorOmissao());
});

test("fichas que não são texto não derrubam a leitura", () => {
  const blocos = lerEscolhaDoInicio({ v: 1, blocos: [null, 7, { id: "numeros" }, "cobranca:m"] });
  assert.equal(ids(blocos)[0], "cobranca");
});

test("o que se guarda são só ids, largura e se está visível", () => {
  const escolha = blocosPorOmissao();
  escolha[0].visivel = false;
  assert.deepEqual(compactarEscolha(escolha), {
    v: 1,
    blocos: ["-numeros:t", "cobranca:m", "resultado:m", "acao:t"],
  });
});

test("guardar e voltar a ler dá exactamente o mesmo Início", () => {
  const escolha = lerEscolhaDoInicio({ v: 1, blocos: ["acao:m", "-resultado:t", "cobranca:m", "numeros:t"] });
  assert.deepEqual(lerEscolhaDoInicio(compactarEscolha(escolha)), escolha);
});

test("a escolha de fábrica cabe de sobra no limite de bytes", () => {
  assert.ok(tamanhoEmBytes(compactarEscolha(blocosPorOmissao())) < MAX_BYTES);
});

const escolhaValida = () => blocosPorOmissao().map(({ id, largura, visivel }) => ({ id, largura, visivel }));

test("uma escolha boa passa e sai no formato compacto", () => {
  const r = validarEscolha(escolhaValida());
  assert.equal(r.ok, true);
  assert.deepEqual(r.guardado, { v: 1, blocos: ["numeros:t", "cobranca:m", "resultado:m", "acao:t"] });
});

test("recusa-se o que vem do browser e não bate certo", () => {
  const maus = [
    null,
    "numeros",
    [],
    [{ id: "inventado", largura: "meia", visivel: true }],
    [{ id: "numeros", largura: "grande", visivel: true }],
    [{ id: "numeros", largura: "meia", visivel: "sim" }],
    [{ id: "numeros", largura: "meia", visivel: true }, { id: "numeros", largura: "toda", visivel: true }],
    ["numeros:t"],
  ];
  for (const mau of maus) {
    const r = validarEscolha(mau);
    assert.equal(r.ok, false, JSON.stringify(mau));
    assert.ok(r.erro.length > 0);
  }
});

test("recusam-se mais blocos do que os que se aceitam guardar", () => {
  const demais = Array.from({ length: MAX_BLOCOS + 1 }, (_, i) => ({
    id: BLOCOS_INICIO[i % BLOCOS_INICIO.length].id,
    largura: "toda",
    visivel: true,
  }));
  const r = validarEscolha(demais);
  assert.equal(r.ok, false);
  assert.match(r.erro, /de mais/);
});
