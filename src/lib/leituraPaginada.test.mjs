// Testes de src/lib/leituraPaginada.ts (ler uma tabela inteira, página a página).
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGINA, PAGINAS_MAX, lerPaginado } from "./leituraPaginada.ts";

/** Uma base de faz-de-conta com `total` linhas, que responde no máximo `porPagina` de cada vez. */
function base(total, porPagina = PAGINA) {
  const pedidos = [];
  const pedir = (de, ate) => {
    pedidos.push({ de, ate });
    const fim = Math.min(de + Math.min(ate - de + 1, porPagina), total);
    const data = [];
    for (let i = de; i < fim; i++) data.push({ id: i });
    return Promise.resolve({ data, error: null });
  };
  return { pedir, pedidos };
}

test("uma página chega: lê tudo e confirma o fim com um pedido vazio", async () => {
  const b = base(3);
  const linhas = await lerPaginado("Início", "as cobranças", b.pedir);
  assert.equal(linhas.length, 3);
  assert.equal(b.pedidos.length, 2);
  assert.deepEqual(b.pedidos[1], { de: 3, ate: 3 + PAGINA - 1 });
});

test("nada se perde depois das mil linhas", async () => {
  const b = base(2500);
  const linhas = await lerPaginado("Resultado", "as cobranças de 2026", b.pedir);
  assert.equal(linhas.length, 2500);
  assert.deepEqual(
    linhas.map((l) => l.id).slice(0, 3),
    [0, 1, 2],
  );
  assert.equal(linhas[2499].id, 2499);
});

test("avança pelo que veio: um limite mais baixo no projeto não corta a leitura", async () => {
  // Se parasse na primeira página incompleta, um limite de 500 devolvia 500 linhas e calava-se.
  const b = base(1200, 500);
  const linhas = await lerPaginado("Resultado", "as despesas", b.pedir);
  assert.equal(linhas.length, 1200);
});

test("uma falha da base dá erro — nunca uma lista curta com ar de completa", async () => {
  await assert.rejects(
    () => lerPaginado("Início", "as cobranças em atraso", () => Promise.resolve({ data: null, error: { message: "sem ligação" } })),
    /Início: não foi possível ler as cobranças em atraso: sem ligação/,
  );
});

test("o 416 de um intervalo fora da tabela é o fim da leitura, não uma avaria", async () => {
  let n = 0;
  const pedir = () => {
    n++;
    if (n === 1) return Promise.resolve({ data: [{ id: 1 }], error: null });
    return Promise.resolve({ data: null, error: { message: "range not satisfiable", code: "PGRST103" } });
  };
  const linhas = await lerPaginado("Início", "as cobranças", pedir);
  assert.equal(linhas.length, 1);
});

test("o mesmo 416 logo no primeiro pedido é avaria: dá erro", async () => {
  await assert.rejects(
    () =>
      lerPaginado("Início", "as cobranças", () =>
        Promise.resolve({ data: null, error: { message: "range not satisfiable", code: "PGRST103" } }),
      ),
    /não foi possível ler as cobranças/,
  );
});

test("uma leitura sem fim é interrompida em vez de ficar a ler para sempre", async () => {
  const pedir = () => Promise.resolve({ data: [{ id: 0 }], error: null });
  await assert.rejects(
    () => lerPaginado("Resultado", "as cobranças", pedir),
    new RegExp(`não acabou ao fim de ${PAGINAS_MAX} páginas`),
  );
});
