// Testes de src/lib/motoPublica.ts contra sql/fase14_colunas_publicas_moto.sql.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
//
// Depois da fase14, a chave anónima só lê as colunas do GRANT. Uma leitura
// pública de moto que peça outra coluna (na resposta ou num filtro) parte o
// site em produção com "permission denied for table moto", e nem o tsc nem o
// build o apanham.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as publica from "./motoPublica.ts";

const RAIZ = path.resolve(import.meta.dirname, "../..");

const separar = (texto) =>
  texto
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

const ordenar = (conjunto) => [...conjunto].sort();

/** Todas as colunas que as listas de motoPublica.ts declaram. */
function colunasDeclaradas() {
  const todas = new Set();
  for (const [nome, valor] of Object.entries(publica)) {
    if (!nome.startsWith("COLUNAS_")) continue;
    for (const c of typeof valor === "string" ? separar(valor) : valor) todas.add(c);
  }
  return todas;
}

/** Colunas do GRANT, sem comentários (a reversão, comentada, também tem um GRANT). */
function colunasDoGrant() {
  const sql = fs
    .readFileSync(path.join(RAIZ, "sql/fase14_colunas_publicas_moto.sql"), "utf8")
    .replace(/--.*$/gm, "");
  const revoke = sql.search(
    /revoke\s+select\s+on\s+public\.moto\s+from\s+anon\s*,\s*authenticated\s*;/i,
  );
  const grant = /grant\s+select\s*\(([^)]*)\)\s*on\s+public\.moto\s+to\s+anon\s*;/i.exec(sql);
  assert.ok(revoke >= 0, "falta o revoke de tabela a anon e authenticated");
  assert.ok(grant, "falta o grant por colunas à anon (só à anon)");
  // O site lê moto com supabaseServer, sem sessão: é sempre anon. A lista branca
  // do pacote de instâncias só admite colunas para a anon.
  assert.ok(
    !/grant[^;]*on\s+public\.moto\s+to[^;]*\bauthenticated\b/i.test(sql),
    "authenticated não recebe colunas de moto",
  );
  // O revoke de tabela apaga também os privilégios por coluna: depois do grant,
  // deixava o site sem leitura nenhuma.
  assert.ok(revoke < grant.index, "o revoke tem de vir antes do grant");
  return new Set(separar(grant[1]));
}

test("o GRANT da fase14 tem exatamente as colunas que o site lê e filtra", () => {
  assert.deepEqual(ordenar(colunasDoGrant()), ordenar(colunasDeclaradas()));
});

test("dono, matrícula, km, valores e comissão nunca são públicos", () => {
  const grant = colunasDoGrant();
  for (const coluna of [
    "proprietario_id",
    "matricula",
    "matricula_norm",
    "km_atual",
    "km_atual_em",
    "proxima_manutencao_km",
    "valor_aquisicao",
    "data_aquisicao",
    "comissao_valor_override",
  ]) {
    assert.ok(!grant.has(coluna), `${coluna} não pode estar no GRANT público`);
  }
});

function ficheirosDeCodigo(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) return ficheirosDeCodigo(caminho);
    return /\.tsx?$/.test(e.name) ? [caminho] : [];
  });
}

// Ficheiros que podem ler com a chave anónima: importam um cliente anónimo do
// projeto, criam um cliente próprio do @supabase/* (como o src/proxy.ts) ou
// usam a anon key diretamente.
const CLIENTE_ANONIMO = [
  /from\s+["']@\/lib\/(supabaseServer|supabaseServerClient|supabaseClient)["']/,
  /\bcreate(?:Server|Browser)?Client\b[^;]*from\s+["']@supabase\/(?:supabase-js|ssr)["']/,
  /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
];
// Métodos cujo 1.º argumento é o nome da coluna.
const FILTRO =
  /\.(?:eq|neq|gt|gte|lt|lte|in|is|like|ilike|not|match|contains|containedBy|overlaps|order|filter|textSearch)\(\s*["'](\w+)["']/g;
// .or("coluna.op.valor,and(coluna.op.valor,…)"): em cada condição, a coluna é
// o que vem antes do primeiro ponto.
const OU = /\.or\(\s*(["'`])([\s\S]*?)\1/g;
const COLUNA_EM_OU = /(?:^|[,(])\s*(\w+)\./g;
// Mota embutida no select de outra tabela: "…, moto(matricula)", "moto!fk(…)", "m:moto(…)".
const MOTO_EMBUTIDA = /(?:^|[\s,(:])moto\s*(?:!\w+)?\s*\(/;

test("as leituras de moto com a chave anónima só usam as listas de motoPublica.ts", () => {
  const listas = new Set(
    Object.keys(publica).filter(
      (nome) => nome.startsWith("COLUNAS_") && typeof publica[nome] === "string",
    ),
  );
  const filtros = new Set(publica.COLUNAS_EM_FILTROS);
  let encontradas = 0;

  for (const ficheiro of ficheirosDeCodigo(path.join(RAIZ, "src"))) {
    const codigo = fs.readFileSync(ficheiro, "utf8");
    if (!CLIENTE_ANONIMO.some((r) => r.test(codigo))) continue;
    const onde = path.relative(RAIZ, ficheiro);

    for (const [, cliente, tabela, cadeia] of codigo.matchAll(
      /(\w+)\s*\.from\(\s*["'](\w+)["']\s*\)([^;]*)/g,
    )) {
      // O service_role não é afetado pela fase14.
      if (cliente === "supabaseAdmin") continue;

      if (tabela !== "moto") {
        const select = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(cadeia)?.[2] ?? "";
        assert.ok(
          !MOTO_EMBUTIDA.test(select),
          `${onde}: o select de ${tabela} embute moto; com a chave anónima, moto só se lê pelas listas de motoPublica.ts`,
        );
        continue;
      }

      encontradas++;
      const select = /\.select\(\s*([^),]*)/.exec(cadeia)?.[1].trim();
      assert.ok(
        listas.has(select),
        `${onde}: o select de moto tem de ser uma lista de motoPublica.ts (está ${select ?? "sem select"})`,
      );

      const colunas = [...cadeia.matchAll(FILTRO)].map(([, coluna]) => coluna);
      const ous = [...cadeia.matchAll(OU)];
      assert.equal(
        ous.length,
        cadeia.match(/\.or\(/g)?.length ?? 0,
        `${onde}: o .or() de moto tem de receber um texto literal, para se verem as colunas`,
      );
      for (const [, , condicoes] of ous) {
        for (const [, coluna] of condicoes.matchAll(COLUNA_EM_OU)) colunas.push(coluna);
      }
      for (const coluna of colunas) {
        assert.ok(
          filtros.has(coluna),
          `${onde}: filtra ou ordena por ${coluna}, que falta em COLUNAS_EM_FILTROS`,
        );
      }
    }
  }

  // Catálogo, página da mota, pedido e sitemap. Menos do que isto quer dizer
  // que a procura deixou de as encontrar, não que desapareceram.
  assert.ok(encontradas >= 4, `só encontrou ${encontradas} leituras públicas de moto`);
});
