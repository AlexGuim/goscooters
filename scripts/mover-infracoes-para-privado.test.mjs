// Testes das partes puras de scripts/mover-infracoes-para-privado.mjs.
// Correr: node --test src/lib/*.test.mjs scripts/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caminhoDoUrlPublico,
  planearDespesa,
  agruparDespesas,
  motivoHttp,
  refDoUrl,
  escolherCredenciais,
  lerArgumentos,
  conferirProjeto,
  urlPublicoDe,
  mesmoProjeto,
  saidaConfirmada,
  uuidDoOriginal,
  restosDoOriginal,
} from "./mover-infracoes-para-privado.mjs";

const BASE = "https://abcd.supabase.co";
const publico = (caminho) => `${BASE}/storage/v1/object/public/motas/${caminho}`;
const U1 = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const U2 = "9a8b7c6d-5e4f-4321-8765-43210fedcba9";
const NOME = `${U1}-aviso.pdf`;
const CHAVE_A = "chave-inventada-aaaa";
const CHAVE_B = "chave-inventada-bbbb";

test("importar o script não o executa (nem lê o .env.local)", () => {
  assert.equal(typeof planearDespesa, "function");
});

test("coima/portagem com o documento no público → mover para infracoes/ com o mesmo nome", () => {
  for (const categoria of ["coima", "portagem"]) {
    const url = publico(`faturas/${NOME}`);
    assert.deepEqual(planearDespesa({ id: "d1", categoria, detalhe: { documento_url: url, valor: "2.40" } }), {
      acao: "mover",
      url,
      origem: `faturas/${NOME}`,
      destino: `infracoes/${NOME}`,
    });
  }
});

test("as faturas normais nunca entram (o extrato do parceiro abre-as pelo URL público)", () => {
  for (const categoria of ["manutencao", "seguro", "gps", "comissao", "outro", undefined]) {
    assert.deepEqual(
      planearDespesa({ categoria, detalhe: { documento_url: publico(`faturas/${NOME}`) } }),
      { acao: "ignorar", motivo: "categoria" },
      String(categoria),
    );
  }
});

test("sem documento → não se mexe", () => {
  for (const detalhe of [null, undefined, {}, [], { documento_url: "" }, { documento_url: "  " }, { documento_url: 5 }]) {
    assert.deepEqual(
      planearDespesa({ categoria: "coima", detalhe }),
      { acao: "ignorar", motivo: "sem_documento" },
      JSON.stringify(detalhe),
    );
  }
});

test("link externo, outro bucket, link assinado ou caminho estranho → não é nosso para mover", () => {
  for (const documento_url of [
    "https://exemplo.pt/aviso.pdf",
    `${BASE}/storage/v1/object/public/outro/faturas/${NOME}`,
    `${BASE}/storage/v1/object/sign/motas/faturas/${NOME}?token=abc`,
    publico("faturas/..%2F..%2Fkyc%2Fcc.pdf"),
    "kyc/cc.pdf",
    "infracoes/../kyc/cc.pdf",
  ]) {
    assert.deepEqual(
      planearDespesa({ categoria: "portagem", detalhe: { documento_url } }),
      { acao: "ignorar", motivo: "fora_do_bucket" },
      documento_url,
    );
  }
});

test("já em privado → só confere se sobrou a cópia pública com o mesmo nome", () => {
  assert.deepEqual(planearDespesa({ categoria: "coima", detalhe: { documento_url: `infracoes/${NOME}` } }), {
    acao: "conferir_resto",
    origem: `faturas/${NOME}`,
    destino: `infracoes/${NOME}`,
  });
});

test("o URL guardado segue tal e qual para a condição do PATCH", () => {
  const url = ` ${publico(`faturas/${NOME}`)}`;
  const p = planearDespesa({ categoria: "coima", detalhe: { documento_url: url } });
  assert.equal(p.acao, "mover");
  assert.equal(p.url, url);
  assert.equal(p.destino, `infracoes/${NOME}`);
});

test("caminhoDoUrlPublico segue a regra do app", () => {
  assert.equal(caminhoDoUrlPublico(publico("faturas/a%20b.pdf?download=1")), "faturas/a b.pdf");
  assert.equal(caminhoDoUrlPublico(publico("")), null);
  assert.equal(caminhoDoUrlPublico(null), null);
});

test("motivoHttp não ecoa o corpo da resposta (pode trazer caminhos e nomes)", () => {
  assert.equal(
    motivoHttp(400, JSON.stringify({ code: "PGRST100", message: "falhou em https://x/faturas/joao-silva.pdf" })),
    "400 PGRST100",
  );
  assert.equal(
    motivoHttp(404, JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" })),
    "404 not_found",
  );
  assert.equal(motivoHttp(500, "Maria Silva, NIF 123456789"), "500");
  assert.equal(motivoHttp(400, JSON.stringify({ error: "texto livre com dados" })), "400");
});

// ── Agrupamento e retoma ─────────────────────────────────────────────────────

test("o mesmo ficheiro em várias despesas → um só grupo", () => {
  const url = publico(`faturas/${NOME}`);
  const r = agruparDespesas([
    { id: "a", categoria: "coima", detalhe: { documento_url: url } },
    { id: "b", categoria: "portagem", detalhe: { documento_url: url } },
    { id: "c", categoria: "coima", detalhe: {} },
    { id: "d", categoria: "coima", detalhe: { documento_url: "https://exemplo.pt/x.pdf" } },
    { id: "e", categoria: "manutencao", detalhe: { documento_url: url } },
  ]);
  assert.equal(r.mover.length, 1);
  assert.deepEqual(r.mover[0].despesas.map((d) => d.id), ["a", "b"]);
  assert.equal(r.mover[0].urlsDiferentes, false);
  assert.deepEqual(r.mover[0].jaEmPrivado, []);
  assert.deepEqual(r.conferir, []);
  assert.deepEqual(r.ignoradas, { sem_documento: 1, fora_do_bucket: 1 });
});

test("o mesmo ficheiro por URLs escritos de forma diferente fica marcado (resolve-se à mão)", () => {
  const r = agruparDespesas([
    { id: "a", categoria: "coima", detalhe: { documento_url: publico(`faturas/${NOME}`) } },
    { id: "b", categoria: "coima", detalhe: { documento_url: `${publico(`faturas/${NOME}`)}?download=1` } },
  ]);
  assert.equal(r.mover.length, 1);
  assert.equal(r.mover[0].urlsDiferentes, true);
});

test("retoma: uma despesa já gravada e outra por gravar com o mesmo ficheiro seguem juntas", () => {
  const url = publico(`faturas/${NOME}`);
  const ja = { id: "a", categoria: "coima", detalhe: { documento_url: `infracoes/${NOME}` } };
  const falta = { id: "b", categoria: "coima", detalhe: { documento_url: url } };
  for (const ordem of [
    [ja, falta],
    [falta, ja],
  ]) {
    const r = agruparDespesas(ordem);
    assert.deepEqual(r.conferir, [], "a já gravada não fica a conferir sozinha (contava a outra como 'ainda usada')");
    assert.equal(r.mover.length, 1);
    assert.equal(r.mover[0].origem, `faturas/${NOME}`);
    assert.deepEqual(r.mover[0].despesas.map((d) => d.id), ["b"]);
    assert.deepEqual(r.mover[0].jaEmPrivado, ["a"]);
  }
});

test("retoma: várias despesas já gravadas com o mesmo ficheiro → uma só conferência", () => {
  const r = agruparDespesas([
    { id: "a", categoria: "coima", detalhe: { documento_url: `infracoes/${NOME}` } },
    { id: "b", categoria: "portagem", detalhe: { documento_url: `infracoes/${NOME}` } },
  ]);
  assert.deepEqual(r.mover, []);
  assert.deepEqual(r.conferir, [{ origem: `faturas/${NOME}`, destino: `infracoes/${NOME}`, ids: ["a", "b"] }]);
});

// ── Guarda de instância ──────────────────────────────────────────────────────

test("refDoUrl tira o primeiro rótulo do host", () => {
  assert.equal(refDoUrl("https://abcd.supabase.co"), "abcd");
  assert.equal(refDoUrl("https://abcd.supabase.co/"), "abcd");
  assert.equal(refDoUrl("não é url"), null);
  assert.equal(refDoUrl(undefined), null);
});

test("credenciais só de uma fonte, ou iguais nas duas → seguem", () => {
  const local = { NEXT_PUBLIC_SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: CHAVE_A };
  assert.deepEqual(escolherCredenciais(local, {}), {
    ok: true,
    url: BASE,
    chave: CHAVE_A,
    origens: { url: ".env.local", chave: ".env.local" },
  });
  assert.deepEqual(escolherCredenciais({}, local), {
    ok: true,
    url: BASE,
    chave: CHAVE_A,
    origens: { url: "shell", chave: "shell" },
  });
  const shellIgual = { NEXT_PUBLIC_SUPABASE_URL: `${BASE}/ `, SUPABASE_SERVICE_ROLE_KEY: `${CHAVE_A}\n` };
  const r = escolherCredenciais(local, shellIgual);
  assert.equal(r.ok, true);
  assert.equal(r.url, BASE);
  assert.deepEqual(r.origens, { url: ".env.local", chave: ".env.local" });
});

test("URL diferente na shell e no .env.local → aborta e diz qual ganhava (sem ecoar a chave)", () => {
  const r = escolherCredenciais(
    { NEXT_PUBLIC_SUPABASE_URL: "https://prod1.supabase.co", SUPABASE_SERVICE_ROLE_KEY: CHAVE_A },
    { NEXT_PUBLIC_SUPABASE_URL: "https://cliente2.supabase.co", SUPABASE_SERVICE_ROLE_KEY: CHAVE_B },
  );
  assert.equal(r.ok, false);
  assert.match(r.erro, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(r.erro, /cliente2/);
  assert.match(r.erro, /prod1/);
  assert.match(r.erro, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(r.erro, /Ganhava a da SHELL/);
  assert.match(r.erro, /passam à frente do \.env\.local/);
  assert.ok(!r.erro.includes(CHAVE_A) && !r.erro.includes(CHAVE_B));
});

test("só a chave diferente também aborta", () => {
  const r = escolherCredenciais(
    { NEXT_PUBLIC_SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: CHAVE_A },
    { SUPABASE_SERVICE_ROLE_KEY: CHAVE_B },
  );
  assert.equal(r.ok, false);
  assert.match(r.erro, /SUPABASE_SERVICE_ROLE_KEY: a da shell é diferente/);
  assert.ok(!r.erro.includes(CHAVE_A) && !r.erro.includes(CHAVE_B));
});

test("credenciais em falta ou URL inválido → aborta", () => {
  assert.equal(escolherCredenciais({}, {}).ok, false);
  assert.equal(escolherCredenciais({ NEXT_PUBLIC_SUPABASE_URL: BASE }, {}).ok, false);
  assert.equal(
    escolherCredenciais({ NEXT_PUBLIC_SUPABASE_URL: "abcd.supabase.co", SUPABASE_SERVICE_ROLE_KEY: CHAVE_A }, {}).ok,
    false,
  );
});

test("--aplicar exige --projeto=<ref> igual ao do URL da base", () => {
  const conferir = (argv) => conferirProjeto(lerArgumentos(argv), BASE);
  assert.deepEqual(conferir([]), { ok: true, ref: "abcd" });
  assert.equal(conferir(["--aplicar"]).ok, false);
  assert.match(conferir(["--aplicar"]).erro, /--projeto=/);
  assert.ok(!conferir(["--aplicar"]).erro.includes("abcd"), "o erro de falta não dá o ref para copiar");
  assert.deepEqual(conferir(["--aplicar", "--projeto=abcd"]), { ok: true, ref: "abcd" });
  assert.deepEqual(conferir(["--projeto=ABCD", "--aplicar"]), { ok: true, ref: "abcd" });
  const outro = conferir(["--aplicar", "--projeto=efgh"]);
  assert.equal(outro.ok, false);
  assert.match(outro.erro, /efgh/);
  assert.match(outro.erro, /abcd/);
  assert.equal(conferir(["--aplicar", "--projeto"]).ok, false);
  assert.equal(conferir(["--aplicar", "--projeto="]).ok, false);
  assert.equal(conferir(["--aplicar", "--projeto=abcd", "--projeto=efgh"]).ok, false);
  assert.equal(conferir(["--projeto=efgh"]).ok, false, "a seco, se vier, também tem de bater");
});

// ── Confirmação pelo URL público ─────────────────────────────────────────────

test("só 400 ou 404 sem credenciais confirmam que o público deixou de abrir", () => {
  assert.equal(saidaConfirmada(400), true);
  assert.equal(saidaConfirmada(404), true);
  for (const status of [200, 206, 301, 304, 403, 416, 500, 503, null, undefined]) {
    assert.equal(saidaConfirmada(status), false, String(status));
  }
});

test("urlPublicoDe monta o URL que o storage serve sem login", () => {
  assert.equal(urlPublicoDe(BASE, `faturas/${NOME}`), publico(`faturas/${NOME}`));
  assert.equal(urlPublicoDe(`${BASE}/`, "faturas/a b.pdf"), publico("faturas/a%20b.pdf"));
});

test("mesmoProjeto compara esquema e host do URL guardado com o da base", () => {
  assert.equal(mesmoProjeto(publico(`faturas/${NOME}`), BASE), true);
  assert.equal(mesmoProjeto(` ${publico(`faturas/${NOME}`)}`, `${BASE}/`), true);
  assert.equal(mesmoProjeto(`https://efgh.supabase.co/storage/v1/object/public/motas/faturas/${NOME}`, BASE), false);
  assert.equal(mesmoProjeto("lixo", BASE), false);
});

// ── Original que a app deixou no público (nome novo) ─────────────────────────

test("uuidDoOriginal: só nos nomes que a app dá (<uuid novo>-<uuid original>-…)", () => {
  assert.equal(uuidDoOriginal(`infracoes/${U2}-${U1}-avi.pdf`), U1);
  assert.equal(uuidDoOriginal(`infracoes/${U2}-${U1.toUpperCase()}-avi.pdf`), U1);
  assert.equal(uuidDoOriginal(`infracoes/${NOME}`), null, "mesmo nome: é o script, já se confere faturas/<mesmo nome>");
  assert.equal(uuidDoOriginal("infracoes/aviso.pdf"), null);
});

test("restosDoOriginal: da listagem, só ficheiros que começam por <uuid original>-", () => {
  const listagem = [
    { name: `${U1}-aviso-portagem-a1.pdf`, id: "o1", metadata: { size: 2048 } },
    { name: `${U1}-outra.pdf`, id: "o2", metadata: {} },
    { name: `${U1}`, id: null }, // pasta, não ficheiro
    { name: `${U2}-${U1}-avi.pdf`, id: "o3", metadata: { size: 1 } }, // outro ficheiro que só contém o uuid
    { name: `${U2}-aviso.pdf`, id: "o4", metadata: { size: 1 } },
  ];
  assert.deepEqual(restosDoOriginal(listagem, U1), [
    { caminho: `faturas/${U1}-aviso-portagem-a1.pdf`, tamanho: 2048 },
    { caminho: `faturas/${U1}-outra.pdf`, tamanho: null },
  ]);
  assert.deepEqual(restosDoOriginal(null, U1), []);
});
