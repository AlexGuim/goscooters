// Que ficheiros saem do storage em cada saída do intake e do importar fatura, e que
// tipos saem do bucket público logo na análise (src/lib/limpezaCarregamentos.ts).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FALHA_COMPROVATIVO_NA_ANALISE,
  aDescartar,
  aguardarGravacao,
  caminhosDe,
  pastaPrivadaNaAnalise,
  tirarDoPublicoNaAnalise,
} from "./limpezaCarregamentos.ts";
import { ehInfracao, lerRefDocumento } from "./documentoDespesa.ts";

const PUBLICO = "https://abcd.supabase.co/storage/v1/object/public/motas";

/** Carregados como a leitura os devolve: o caminho no público e o documento a gravar. */
const fatura = (n) => ({ path: `faturas/${n}-fatura.pdf`, documento: `${PUBLICO}/faturas/${n}-fatura.pdf` });
const coima = (n) => ({ path: `faturas/${n}-aviso.pdf`, documento: `infracoes/${n}-aviso.pdf` });
const comprovativo = (n) => ({ path: `faturas/${n}-print.png`, documento: `comprovativos/${n}-print.png` });

const estado = (mais = {}) => ({ fase: "rever", emRevisao: null, emRevisaoGravado: false, fila: [], emLeitura: [], ...mais });
const SAIDAS = ["cancelar", "descartar_lote", "sair"];
const FASES = ["inicio", "a-processar", "rever", "a-gravar", "comunicar"];

/** O que sai, ordenado — a ordem não interessa, só o conjunto. */
const ordenado = ({ publicos, privados }) => ({ publicos: [...publicos].sort(), privados: [...privados].sort() });

// ── As fugas ─────────────────────────────────────────────────────────────────

test("cancelar na revisão: o documento em revisão sai (a fila espera pela sua vez)", () => {
  const s = estado({ emRevisao: fatura(1), fila: [fatura(2)], emLeitura: [fatura(3)] });
  assert.deepEqual(aDescartar(s, "cancelar"), { publicos: ["faturas/1-fatura.pdf"], privados: [] });
});

test("cancelar uma coima em revisão: sai a cópia em privado/infracoes, e o original se ainda lá estiver", () => {
  const s = estado({ emRevisao: coima(1) });
  assert.deepEqual(aDescartar(s, "cancelar"), { publicos: ["faturas/1-aviso.pdf"], privados: ["infracoes/1-aviso.pdf"] });
});

test("descartar os restantes: sai a fila E o documento em revisão", () => {
  const s = estado({ emRevisao: fatura(1), fila: [fatura(2), coima(3)], emLeitura: [fatura(4)] });
  assert.deepEqual(ordenado(aDescartar(s, "descartar_lote")), {
    publicos: ["faturas/1-fatura.pdf", "faturas/2-fatura.pdf", "faturas/3-aviso.pdf"],
    privados: ["infracoes/3-aviso.pdf"],
  });
});

test("cancelar no painel de pagamento: a fila sai; o comprovativo, já em privado, não entra", () => {
  // No painel, o que está "em revisão" é o carregamento original do comprovativo.
  const s = estado({ emRevisao: { path: comprovativo(1).path, documento: null }, fila: [fatura(2), comprovativo(3)] });
  const r = ordenado(aDescartar(s, "descartar_lote"));
  assert.deepEqual(r.publicos, ["faturas/1-print.png", "faturas/2-fatura.pdf", "faturas/3-print.png"]);
  assert.deepEqual(r.privados, []);
});

test("sair do ecrã a meio da leitura de um lote: os já lidos saem, com a fila e a revisão", () => {
  const s = estado({ fase: "a-processar", emRevisao: fatura(1), fila: [fatura(2)], emLeitura: [fatura(3), coima(4)] });
  assert.deepEqual(ordenado(aDescartar(s, "sair")), {
    publicos: ["faturas/1-fatura.pdf", "faturas/2-fatura.pdf", "faturas/3-fatura.pdf", "faturas/4-aviso.pdf"],
    privados: ["infracoes/4-aviso.pdf"],
  });
});

test("sair do ecrã só com um lote a ler (nada ainda na fila nem na revisão): os lidos saem", () => {
  const s = estado({ fase: "a-processar", emLeitura: [fatura(1), fatura(2)] });
  assert.deepEqual(ordenado(aDescartar(s, "sair")).publicos, ["faturas/1-fatura.pdf", "faturas/2-fatura.pdf"]);
  // …mas nenhuma outra saída os vê: só existem enquanto o ecrã os lê.
  assert.deepEqual(aDescartar(s, "cancelar"), { publicos: [], privados: [] });
  assert.deepEqual(aDescartar(s, "descartar_lote"), { publicos: [], privados: [] });
});

test("importar fatura: cancelar e sair levam o carregamento, também a meio da leitura (OCR)", () => {
  const emRevisao = estado({ emRevisao: fatura(1) });
  assert.deepEqual(aDescartar(emRevisao, "cancelar").publicos, ["faturas/1-fatura.pdf"]);
  assert.deepEqual(aDescartar(emRevisao, "sair").publicos, ["faturas/1-fatura.pdf"]);
  const aLer = estado({ fase: "a-processar", emLeitura: [{ path: "faturas/2-foto.jpg", documento: null }] });
  assert.deepEqual(aDescartar(aLer, "sair"), { publicos: ["faturas/2-foto.jpg"], privados: [] });
});

// ── O que nunca sai ──────────────────────────────────────────────────────────

test("a gravar: o documento em revisão nunca sai, saia o gestor como sair — a fila e o lote sim", () => {
  for (const saida of SAIDAS) {
    const s = estado({ fase: "a-gravar", emRevisao: coima(1), fila: [fatura(2)], emLeitura: [fatura(3)] });
    const r = aDescartar(s, saida);
    assert.equal(r.publicos.includes("faturas/1-aviso.pdf"), false, saida);
    assert.equal(r.privados.includes("infracoes/1-aviso.pdf"), false, saida);
    assert.equal(r.publicos.includes("faturas/2-fatura.pdf"), saida !== "cancelar", saida);
    assert.equal(r.publicos.includes("faturas/3-fatura.pdf"), saida === "sair", saida);
  }
});

test("já gravado (gravação a meio, ou a comunicar): nunca sai, em nenhuma fase nem saída", () => {
  for (const fase of FASES) {
    for (const saida of SAIDAS) {
      const r = aDescartar(estado({ fase, emRevisao: coima(1), emRevisaoGravado: true }), saida);
      assert.deepEqual(r, { publicos: [], privados: [] }, `${fase} ${saida}`);
    }
  }
  for (const saida of SAIDAS) {
    const r = aDescartar(estado({ fase: "comunicar", emRevisao: fatura(1) }), saida);
    assert.deepEqual(r, { publicos: [], privados: [] }, `comunicar ${saida}`);
  }
});

test("o documento protegido não sai nem quando aparece também na fila ou no lote em leitura", () => {
  for (const [fase, emRevisaoGravado] of [["a-gravar", false], ["rever", true], ["comunicar", false]]) {
    const s = estado({ fase, emRevisaoGravado, emRevisao: coima(1), fila: [coima(1), fatura(2)], emLeitura: [coima(1)] });
    assert.deepEqual(aDescartar(s, "sair"), { publicos: ["faturas/2-fatura.pdf"], privados: [] }, fase);
  }
});

test("matriz: a revisão sai se não está ocupada nem gravada; a fila se não é cancelar; o lote só ao sair", () => {
  for (const fase of FASES) {
    for (const emRevisaoGravado of [false, true]) {
      for (const saida of SAIDAS) {
        const s = estado({ fase, emRevisaoGravado, emRevisao: fatura(1), fila: [fatura(2)], emLeitura: [fatura(3)] });
        const { publicos } = aDescartar(s, saida);
        const caso = `${fase} gravado=${emRevisaoGravado} ${saida}`;
        const revisaoSai = !emRevisaoGravado && fase !== "a-gravar" && fase !== "comunicar";
        assert.equal(publicos.includes("faturas/1-fatura.pdf"), revisaoSai, caso);
        assert.equal(publicos.includes("faturas/2-fatura.pdf"), saida !== "cancelar", caso);
        assert.equal(publicos.includes("faturas/3-fatura.pdf"), saida === "sair", caso);
      }
    }
  }
});

// ── Caminhos ─────────────────────────────────────────────────────────────────

test("do público só se apaga o que os ecrãs carregam: faturas/ e caminho seguro", () => {
  for (const path of [
    "fotos/moto.jpg",
    "moto.jpg",
    "videos/moto.mp4",
    "kyc/cc.jpg",
    "faturas/../kyc/cc.jpg",
    "faturas/./x.pdf",
    "/faturas/x.pdf",
    "faturas/",
    "faturas//x.pdf",
    "faturas\\x.pdf",
    `${PUBLICO}/faturas/x.pdf`,
    "",
    null,
    undefined,
  ]) {
    assert.deepEqual(caminhosDe([{ path, documento: null }]).publicos, [], String(path));
  }
  assert.deepEqual(caminhosDe([{ path: "faturas/x.pdf", documento: null }]).publicos, ["faturas/x.pdf"]);
});

test("do privado só infracoes/ — o mesmo que documentoDespesa lê como privado; nunca comprovativos/ nem kyc/", () => {
  const valores = [
    "infracoes/1-aviso.pdf",
    "infracoes/sub/2-aviso.pdf",
    "infracoes/",
    "infracoes/../kyc/cc.jpg",
    "comprovativos/1-print.png",
    "kyc/1-cc.jpg",
    "faturas/1-fatura.pdf",
    `${PUBLICO}/faturas/1-fatura.pdf`,
    "",
    null,
    undefined,
  ];
  for (const documento of valores) {
    const privado = caminhosDe([{ path: null, documento }]).privados.includes(documento);
    assert.equal(privado, lerRefDocumento(documento)?.onde === "privado", String(documento));
  }
  assert.deepEqual(caminhosDe([comprovativo(1)]).privados, []);
});

test("sem repetições, e nada a apagar quando não há nada", () => {
  assert.deepEqual(caminhosDe([coima(1), coima(1), fatura(2), fatura(2)]), {
    publicos: ["faturas/1-aviso.pdf", "faturas/2-fatura.pdf"],
    privados: ["infracoes/1-aviso.pdf"],
  });
  for (const saida of SAIDAS) {
    assert.deepEqual(aDescartar(estado(), saida), { publicos: [], privados: [] }, saida);
  }
});

// ── Na análise ───────────────────────────────────────────────────────────────

test("na análise saem do público: coima e portagem para infracoes, comprovativo de pagamento para comprovativos", () => {
  assert.equal(pastaPrivadaNaAnalise("coima"), "infracoes");
  assert.equal(pastaPrivadaNaAnalise("portagem"), "infracoes");
  assert.equal(pastaPrivadaNaAnalise("comprovativo_pagamento"), "comprovativos");
  for (const t of ["fatura", "apolice_seguro", "manutencao", "documento_id", "comprovativo_morada", "outro", "", null, undefined]) {
    assert.equal(pastaPrivadaNaAnalise(t), null, String(t));
  }
});

test("pastaPrivadaNaAnalise e ehInfracao dizem o mesmo das infrações", () => {
  for (const t of ["coima", "portagem", "fatura", "comprovativo_pagamento", "documento_id", "outro", null]) {
    assert.equal(pastaPrivadaNaAnalise(t) === "infracoes", ehInfracao(t), String(t));
  }
});

const CARREGAMENTO = { path: "faturas/1-doc.png", url: `${PUBLICO}/faturas/1-doc.png` };

/** Operações de storage falsas: registam o que se pediu e respondem o que o teste mandar. */
function operacoes({
  infracao = { ok: true, caminho: "infracoes/2-doc.png" },
  comprovativo = { ok: true, path: "comprovativos/2-doc.png", publicoFicou: false },
} = {}) {
  const pedidos = [];
  const op = {
    guardarInfracao: async (p) => (pedidos.push(["guardarInfracao", p]), infracao),
    moverComprovativo: async (p) => (pedidos.push(["moverComprovativo", p]), comprovativo),
  };
  return { op, pedidos };
}

test("comprovativo de pagamento: sai do público na análise, e o ecrã segue com o caminho em comprovativos/", async () => {
  const { op, pedidos } = operacoes();
  assert.deepEqual(await tirarDoPublicoNaAnalise("comprovativo_pagamento", CARREGAMENTO, op), {
    ok: true,
    documento: "comprovativos/2-doc.png",
  });
  assert.deepEqual(pedidos, [["moverComprovativo", "faturas/1-doc.png"]]);
});

test("comprovativo que não ficou em privado, ou cujo público não saiu: falha fechado, e diz se o público ficou", async () => {
  const casos = [
    [{ ok: false, publicoFicou: false }, false],
    [{ ok: false, publicoFicou: true }, true],
    [{ ok: false }, false],
    [{ ok: true, path: "comprovativos/2-doc.png", publicoFicou: true }, true],
    [{ ok: true, publicoFicou: false }, false],
    [{ ok: true, path: "kyc/2-doc.png", publicoFicou: false }, false],
    [{ ok: true, path: "comprovativos/../kyc/2-doc.png", publicoFicou: false }, false],
    [{ ok: true, path: "faturas/1-doc.png", publicoFicou: false }, false],
  ];
  for (const [comprovativo, ficou] of casos) {
    const { op } = operacoes({ comprovativo });
    assert.deepEqual(
      await tirarDoPublicoNaAnalise("comprovativo_pagamento", CARREGAMENTO, op),
      { ok: false, error: FALHA_COMPROVATIVO_NA_ANALISE, ficouNoPublico: ficou },
      JSON.stringify(comprovativo),
    );
  }
});

test("comprovativo fora da pasta dos carregamentos: não se mexe no storage", async () => {
  for (const path of ["fotos/moto.jpg", "moto.jpg", "videos/moto.mp4", "faturas/../moto.jpg", "/faturas/1-doc.png", "faturas/"]) {
    const { op, pedidos } = operacoes();
    const r = await tirarDoPublicoNaAnalise("comprovativo_pagamento", { path, url: `${PUBLICO}/${path}` }, op);
    assert.equal(r.ok, false, path);
    assert.deepEqual(pedidos, [], path);
  }
});

test("coima e portagem: saem para infracoes/ na análise, com o erro tal como vem se falhar", async () => {
  for (const tipo of ["coima", "portagem"]) {
    const bem = operacoes();
    assert.deepEqual(await tirarDoPublicoNaAnalise(tipo, CARREGAMENTO, bem.op), { ok: true, documento: "infracoes/2-doc.png" });
    assert.deepEqual(bem.pedidos, [["guardarInfracao", "faturas/1-doc.png"]]);
    const mal = operacoes({ infracao: { ok: false, error: "não guardou" } });
    assert.deepEqual(await tirarDoPublicoNaAnalise(tipo, CARREGAMENTO, mal.op), { ok: false, error: "não guardou" });
  }
});

test("os outros tipos ficam onde estão até à revisão: o URL do carregamento, sem mexer no storage", async () => {
  for (const tipo of ["fatura", "apolice_seguro", "manutencao", "documento_id", "comprovativo_morada", "outro", "", null, undefined]) {
    const { op, pedidos } = operacoes();
    assert.deepEqual(await tirarDoPublicoNaAnalise(tipo, CARREGAMENTO, op), { ok: true, documento: CARREGAMENTO.url }, String(tipo));
    assert.deepEqual(pedidos, [], String(tipo));
  }
});

// ── A marca de gravado ───────────────────────────────────────────────────────

test("gravação feita: o documento fica marcado como de uma linha", async () => {
  let marcas = 0;
  const resposta = { success: true, id: "d1" };
  assert.equal(await aguardarGravacao(Promise.resolve(resposta), () => marcas++), resposta);
  assert.equal(marcas, 1);
});

test("recusa do servidor: nada ficou gravado, e o documento não é marcado", async () => {
  let marcas = 0;
  const resposta = { success: false, error: "Erro ao gravar a despesa." };
  assert.equal(await aguardarGravacao(Promise.resolve(resposta), () => marcas++), resposta);
  assert.equal(marcas, 0);
});

test("pedido que rebenta: na dúvida o documento fica marcado (o servidor pode ter gravado), e o erro segue", async () => {
  let marcas = 0;
  const erro = new Error("504");
  await assert.rejects(aguardarGravacao(Promise.reject(erro), () => marcas++), (e) => e === erro);
  assert.equal(marcas, 1);
});
