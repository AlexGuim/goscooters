// A LIGAÇÃO da limpeza dos carregamentos nos ecrãs e na análise.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
//
// limpezaCarregamentos.test.mjs prova o que sai em cada saída do ecrã; mas as
// fugas só ficam fechadas se os ecrãs e a análise chamarem essas funções. Um
// "Cancelar" que volte a fazer só reset(), ou uma análise que deixe de mover o
// comprovativo, deixava o documento no bucket público com as funções puras
// intactas — e nenhum teste delas o via. Sem browser nem servidor para correr os
// componentes e a ação, lê-se o código, como em motoPublica.test.mjs: cada regra
// diz o que tem de lá estar e porquê. Se uma mudança legítima partir uma regra,
// muda-se a regra — não se apaga.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const DESPESAS = "src/app/(admin)/admin/(protected)/despesas";
const INTAKE = `${DESPESAS}/IntakeDocumento.tsx`;
const IMPORTAR = `${DESPESAS}/ImportarFatura.tsx`;
const ANALISE = "src/actions/intakeActions.ts";

/**
 * O código sem comentários — um comentário não conta como chamada. Os de bloco (e
 * os JSX) dão lugar às mesmas quebras de linha, para os números de linha das
 * mensagens baterem com o ficheiro.
 */
function codigo(relativo) {
  const texto = fs
    .readFileSync(path.join(RAIZ, relativo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ""))
    .replace(/^[ \t]*\/\/.*$/gm, "");
  let fundo = 0;
  for (const c of texto) fundo += c === "{" ? 1 : c === "}" ? -1 : 0;
  assert.equal(fundo, 0, `${relativo}: chavetas desequilibradas — as regras não saberiam onde começa cada bloco`);
  return texto;
}

const linhaDe = (texto, i) => texto.slice(0, i).split("\n").length;

/** O `{` que abre o bloco onde está a posição `i`. */
function inicioDoBloco(texto, i) {
  for (let j = i - 1, fundo = 0; j >= 0; j--) {
    if (texto[j] === "}") fundo++;
    else if (texto[j] === "{" && fundo-- === 0) return j;
  }
  return -1;
}

/** O `}` que fecha o bloco aberto em `inicio`. */
function fimDoBloco(texto, inicio) {
  for (let j = inicio + 1, fundo = 0; j < texto.length; j++) {
    if (texto[j] === "{") fundo++;
    else if (texto[j] === "}" && fundo-- === 0) return j;
  }
  return -1;
}

/** O corpo, com as chavetas, da função `const nome = (…) => { … }`. */
function corpoDe(texto, nome, relativo) {
  const i = texto.search(new RegExp(`const ${nome} = (?:async )?\\([^)]*\\) =>\\s*\\{`));
  assert.ok(i >= 0, `${relativo}: não encontrei ${nome}`);
  const inicio = texto.indexOf("{", texto.indexOf("=>", i));
  return texto.slice(inicio, fimDoBloco(texto, inicio) + 1);
}

/** Cada `reset()`: o bloco até ele, a função que o abre (se é `const nome = (…) => {`) e a linha. */
function resets(texto) {
  return [...texto.matchAll(/\breset\(\)/g)].map((m) => {
    const inicio = inicioDoBloco(texto, m.index);
    const cabeca = texto.slice(Math.max(0, inicio - 200), inicio + 1);
    return {
      antes: texto.slice(inicio, m.index),
      funcao: /const (\w+) = (?:async )?\([^)]*\) =>\s*\{$/.exec(cabeca)?.[1] ?? null,
      linha: linhaDe(texto, m.index),
    };
  });
}

/** Os atributos de cada `<button>` cujo texto é `rotulo`. */
function botoes(texto, rotulo) {
  return [...texto.matchAll(new RegExp(`>\\s*${rotulo}\\s*</button>`, "g"))].map((m) => ({
    atributos: texto.slice(texto.lastIndexOf("<button", m.index), m.index),
    linha: linhaDe(texto, m.index),
  }));
}

/** A limpeza ao sair do ecrã: a função que o useEffect de montagem devolve. */
function limpezaAoSair(texto, relativo) {
  const marcas = [...texto.matchAll(/montadoRef\.current = false/g)];
  assert.equal(marcas.length, 1, `${relativo}: esperava uma só limpeza ao sair (montadoRef.current = false)`);
  const inicio = inicioDoBloco(texto, marcas[0].index);
  assert.match(
    texto.slice(0, inicio),
    /useEffect\(\(\) => \{\s*montadoRef\.current = true;\s*return \(\) =>\s*$/,
    `${relativo}: a limpeza ao sair tem de ser a que o useEffect de montagem devolve`,
  );
  return texto.slice(inicio, fimDoBloco(texto, inicio) + 1);
}

/** Depois de gravar, o documento já é de uma linha: o reset() destas funções não apaga nada, de propósito. */
const DEPOIS_DE_GRAVAR = { [INTAKE]: "continuarOuFechar", [IMPORTAR]: "gravar" };

// ── As saídas do ecrã ────────────────────────────────────────────────────────

test("intake: antes de cada reset() de uma saída, o que fica sem dono sai do storage (fugas a, b, c)", () => {
  const texto = codigo(INTAKE);
  assert.doesNotMatch(texto, /=\{reset\}/, "um botão chama reset() direto: o documento em revisão fica no bucket público");
  const saidas = resets(texto).filter((r) => r.funcao !== DEPOIS_DE_GRAVAR[INTAKE]);
  // Cancelar na revisão, Descartar os restantes, e os Cancelar dos painéis de pagamento e de KYC.
  assert.ok(saidas.length >= 4, `só encontrei ${saidas.length} saídas com reset() — a procura deixou de as ver`);
  for (const { antes, linha } of saidas) {
    const saida = /\bdescartarAoSair\("(cancelar|descartar_lote)"\)/.exec(antes)?.[1];
    assert.ok(
      saida,
      `${INTAKE}:${linha}: reset() sem descartarAoSair antes — o caminho perde-se e o documento fica no bucket público`,
    );
    if (/\bsetFila\(\[\]\)/.test(antes)) {
      assert.equal(
        saida,
        "descartar_lote",
        `${INTAKE}:${linha}: esvazia a fila sem a apagar — os documentos dela ficam no bucket público`,
      );
    }
  }
});

test("intake: as saídas apagam a partir do estado atual (revisão, marca de gravado, fila), nos dois buckets", () => {
  const texto = codigo(INTAKE);
  assert.match(
    texto,
    /const descartarAoSair = \(saida: SaidaDoEcra\) =>\s*apagarCaminhos\(aDescartar\(estadoDoEcra\(fase, docPath, docUrl, docGravado, fila\), saida\)\)/,
  );
  for (const relativo of [INTAKE, IMPORTAR]) {
    const t = codigo(relativo);
    assert.match(t, /\.\.\.publicos\.map\(\(p\) => apagarDocumentoPublico\(p\)\)/, `${relativo}: apagarCaminhos não apaga do público`);
    assert.match(t, /apagarDocumentosPrivados\(privados\)/, `${relativo}: apagarCaminhos não apaga do privado`);
  }
});

test("importar fatura: o Cancelar apaga o carregamento antes do reset() (fuga e)", () => {
  const texto = codigo(IMPORTAR);
  assert.doesNotMatch(texto, /=\{reset\}/, "um botão chama reset() direto: o carregamento fica no bucket público");
  const saidas = resets(texto).filter((r) => r.funcao !== DEPOIS_DE_GRAVAR[IMPORTAR]);
  assert.ok(saidas.length >= 1, "não encontrei o Cancelar");
  for (const { antes, linha } of saidas) {
    assert.match(
      antes,
      /apagarCaminhos\(aDescartar\(estadoDoEcra\(fase, docPath, docUrl\), "cancelar"\)\)/,
      `${IMPORTAR}:${linha}: reset() sem apagar o carregamento antes`,
    );
  }
});

for (const relativo of [INTAKE, IMPORTAR]) {
  test(`${path.basename(relativo, ".tsx")}: sair do ecrã apaga a revisão, a fila e o que está a meio da leitura (fugas d, e)`, () => {
    const texto = codigo(relativo);
    assert.match(texto, /estadoRef\.current = estadoDoEcra\(/, `${relativo}: o estado que a limpeza ao sair vê não se atualiza`);
    const corpo = limpezaAoSair(texto, relativo);
    assert.match(corpo, /apagarCaminhos\(aDescartar\(/, "a limpeza ao sair não apaga nada");
    assert.match(corpo, /\.\.\.estadoRef\.current/, "a limpeza ao sair não vê o estado do ecrã");
    assert.match(corpo, /emLeitura: emLeituraRef\.current/, "a limpeza ao sair não vê o que está a meio da leitura");
    assert.match(corpo, /"sair"/);
  });
}

test("intake: os já lidos de um lote estão no ref enquanto se lê, e saem no catch e com o ecrã fechado a meio (fuga d)", () => {
  const corpo = corpoDe(codigo(INTAKE), "aoEscolher", INTAKE);
  const ref = corpo.search(/emLeituraRef\.current = lidos;/);
  assert.ok(ref >= 0, "os já lidos não estão no ref: só a variável local os conhece, e quem sai do ecrã deixa-os no público");
  assert.ok(ref < corpo.search(/await carregarEClassificar\(/), "o ref tem de ter os lidos ANTES de o primeiro subir");
  assert.match(
    corpo,
    /await carregarEClassificar\(f\);\s*if \(!montadoRef\.current\) \{\s*if \(r\.ok\) await descartar\(\[r\.doc\]\);\s*return;/,
    "com o ecrã já fechado, o que acabou de subir tem de sair (a limpeza ao sair ainda não o via)",
  );
  assert.match(corpo, /catch \(e\) \{\s*await descartar\(lidos\);/, "o catch da leitura tem de apagar os já lidos");
  assert.match(
    corpo,
    /finally \{\s*emLeituraRef\.current = \[\];\s*\}/,
    "o ref só se esvazia quando os lidos já estão na fila, na revisão ou apagados",
  );
});

test("importar fatura: o carregamento está no ref enquanto se lê, e sai se o ecrã fechar a meio (fuga e)", () => {
  const texto = codigo(IMPORTAR);
  const corpo = corpoDe(texto, "aoEscolher", IMPORTAR);
  assert.match(
    corpo,
    /emLeituraRef\.current = \[\{ path: env\.path, documento: null \}\];\s*try \{\s*await lerCarregado\(/,
    "o carregamento tem de estar no ref antes de a leitura (e o OCR) começar",
  );
  assert.match(corpo, /finally \{\s*emLeituraRef\.current = \[\];\s*\}/);
  const leitura = corpoDe(texto, "lerCarregado", IMPORTAR);
  assert.match(
    leitura,
    /const saiuDoEcra = [^{]*\{\s*if \(montadoRef\.current\) return false;\s*void apagarCaminhos\(caminhosDe\(\[\{ path: caminho, documento \}\]\)\);/,
  );
  const logo = leitura.search(/if \(saiuDoEcra\(\)\) return;/);
  assert.ok(
    logo >= 0 && logo < leitura.search(/await lerFatura\(/),
    "um carregamento que acabou com o ecrã já fechado tem de sair antes de se ler",
  );
  assert.match(leitura, /await lerFatura\(caminho, url\);\s*if \(saiuDoEcra\(r\.resultado\?\.documento_url\)\) return;/);
});

// ── O que nunca se apaga ─────────────────────────────────────────────────────

test("a gravar, nada se apaga: o Cancelar (e o Descartar os restantes) fica desativado", () => {
  for (const relativo of [INTAKE, IMPORTAR]) {
    const cancelar = botoes(codigo(relativo), "Cancelar");
    assert.ok(cancelar.length >= 1, `${relativo}: não encontrei o botão Cancelar`);
    for (const { atributos, linha } of cancelar) {
      assert.match(
        atributos,
        /disabled=\{fase === "a-gravar"\}/,
        `${relativo}:${linha}: Cancelar ativo a gravar — apagava o documento que o servidor está a pôr numa linha`,
      );
    }
  }
  const descartar = botoes(codigo(INTAKE), "Descartar os restantes");
  assert.equal(descartar.length, 1, "não encontrei o Descartar os restantes");
  assert.match(descartar[0].atributos, /disabled=\{fase === "a-gravar"/, "Descartar os restantes ativo a gravar");
});

test("intake: uma gravação feita marca o documento como de uma linha — daí em diante nenhuma saída o apaga", () => {
  const texto = codigo(INTAKE);
  const gravacoes = [...texto.matchAll(/\b(gravarDespesaDeFatura|criarSeguro|criarManutencao)\(/g)];
  assert.ok(gravacoes.length >= 5, `só encontrei ${gravacoes.length} gravações`);
  for (const m of gravacoes) {
    assert.match(
      texto.slice(Math.max(0, m.index - 40), m.index),
      /\bgravacao\(\s*$/,
      `${INTAKE}:${linhaDe(texto, m.index)}: ${m[1]} sem gravacao() — se gravar e a seguinte falhar, o Cancelar apaga o documento dessa linha`,
    );
  }
  assert.match(texto, /const gravacao = [^;]*=>\s*aguardarGravacao\(pedido, \(\) => setDocGravado\(true\)\);/);
  // Nem o "Ler como documento do motorista": passá-lo para kyc/ tirava-o do público e partia o documento da linha.
  assert.match(texto, /motoristas && res && docPath && !docGravado && /);
});

// ── Na análise ───────────────────────────────────────────────────────────────

test("análise: o comprovativo de pagamento sai do público na mesma ação, e o painel de pagamento lê o caminho novo (M2)", () => {
  const acao = codigo(ANALISE);
  const i = acao.indexOf("export async function analisarDocumento");
  assert.ok(i >= 0, "não encontrei analisarDocumento");
  const corpo = acao.slice(i, acao.indexOf("async function enriquecer", i));
  assert.match(
    corpo,
    /await tirarDoPublicoNaAnalise\(doc\.tipo, \{ path, url: documentoUrl \}, \{/,
    "a análise deixou de tirar do público o que não pode esperar pela revisão",
  );
  assert.ok(
    corpo.search(/classificarDocumentoGemini\(/) < corpo.search(/tirarDoPublicoNaAnalise\(/),
    "só se sabe o que o documento é depois de o classificar",
  );
  assert.match(corpo, /guardarInfracao: guardarInfracaoEmPrivado,/);
  assert.match(
    corpo,
    /moverComprovativo: \((\w+)\) => moverDocumentoParaPrivado\(\1, "comprovativos"\)/,
    "o comprovativo tem de ir para privado/comprovativos, de onde o painel o lê e onde o pagamento o guarda",
  );
  assert.match(corpo, /if \(!fora\.ok\) \{?\s*return \{ success: false/, "falha a tirar do público: a análise não segue");
  assert.match(corpo, /const documento = fora\.documento;/);
  assert.match(corpo, /urlDocumentoParaAdmin\(documento\)/);
  assert.match(corpo, /enriquecer\(doc, documento, documentoVer\)/);
  assert.match(
    codigo(INTAKE),
    /lerComprovativoPagamento\(a\.res\.documento_url\)/,
    "o painel de pagamento tem de ler o caminho em comprovativos/ — o carregamento já saiu do público",
  );
});
