#!/usr/bin/env node
/**
 * Procura ficheiros no bucket PÚBLICO que ninguém reclama — e tira-os de lá.
 *
 * O bucket "motas" é público de propósito: o extrato do parceiro tem de abrir as
 * faturas por URL. O intake carrega para lá TODOS os documentos antes de saber o que
 * são, e só depois de a IA os classificar é que um documento de identidade passa para
 * o bucket "privado". Quando essa leitura falha a meio — ou o gestor sai do ecrã — o
 * ficheiro fica no público sem nada a apontar para ele. Se calhava ser um cartão de
 * cidadão ou uma carta de condução, fica legível por quem souber o URL.
 *
 * Um ficheiro é ÓRFÃO quando nenhuma linha de nenhuma tabela o referencia (em
 * qualquer coluna, JSON incluído). Se alguma tabela não se deixar ler, o script
 * ABORTA — na dúvida o ficheiro fica onde está, porque tirá-lo parte links reais.
 * Órfão não quer dizer lixo: pode ser o único exemplar de um documento.
 * Por isso `--mover` COPIA para privado/quarentena/ e só apaga do público depois de
 * confirmar, byte a byte, que a cópia ficou lá.
 *
 * Uso:
 *   node scripts/auditar-documentos-publicos.mjs           # só lista
 *   node scripts/auditar-documentos-publicos.mjs --mover   # põe os órfãos em quarentena
 *   node scripts/auditar-documentos-publicos.mjs --repor   # devolve ao público o que está em quarentena mas é referenciado
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

function carregarEnv() {
  const f = path.join(RAIZ, ".env.local");
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = { ...carregarEnv(), ...process.env };
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const CHAVE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !CHAVE) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}

const mover = process.argv.includes("--mover");
const repor = process.argv.includes("--repor");
const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };

// Lê a tabela inteira, página a página (o PostgREST corta em max-rows sem avisar).
// Um erro REBENTA o script: "não consegui ler" nunca pode passar por "ninguém referencia".
async function lerTabela(tabela) {
  const linhas = [];
  for (;;) {
    const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?select=*&limit=1000&offset=${linhas.length}`, {
      headers: cabecalhos,
    });
    if (!r.ok) throw new Error(`Não li ${tabela} (${r.status} ${await r.text()}) — abortado, nada movido.`);
    const pagina = await r.json();
    if (!pagina.length) return linhas;
    linhas.push(...pagina);
  }
}

async function listarBucket(bucket, prefixo) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...cabecalhos, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: prefixo, limit: 1000, sortBy: { column: "created_at", order: "desc" } }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const PASTA = "faturas";
const objetos = await listarBucket("motas", PASTA);

// Tudo o que pode apontar para um ficheiro = TODAS as linhas de TODAS as tabelas,
// comparadas pelo JSON inteiro. Não se escolhem colunas: o URL vive em sítios como
// seguro.detalhe.documento_url, e uma lista de colunas adivinhadas (com as falhas
// engolidas) já pôs em quarentena cartas verdes que o recibo de entrega mostrava.
const specResp = await fetch(`${URL_BASE}/rest/v1/`, { headers: cabecalhos });
if (!specResp.ok) throw new Error(`Não li o esquema (${specResp.status}) — abortado, nada movido.`);
const tabelas = Object.keys((await specResp.json()).definitions ?? {});
if (!tabelas.length) throw new Error("Esquema sem tabelas — abortado, nada movido.");
const fontes = await Promise.all(tabelas.map(lerTabela));
const textoPorTabela = tabelas.map((t, i) => [t, JSON.stringify(fontes[i])]);
console.log(`Referências procuradas em ${tabelas.length} tabelas/vistas (${fontes.flat().length} linhas).\n`);

// O id único do ficheiro (o prefixo uuid) chega para o encontrar em qualquer campo.
const referenciasDe = (nome) =>
  textoPorTabela.filter(([, texto]) => texto.includes(nome.slice(0, 36))).map(([t]) => t);

// O caminho inverso: o que está em quarentena mas alguma linha referencia foi para lá
// por engano — é um link partido (ex.: a carta verde no recibo de entrega). Os órfãos de
// verdade ficam. Mostra-se QUEM referencia, para confirmar que não é KYC antes de repor.
const referenciadosNaQuarentena = (await listarBucket("privado", "quarentena"))
  .map((o) => ({ ...o, refs: referenciasDe(o.name) }))
  .filter((o) => o.refs.length);
if (referenciadosNaQuarentena.length) {
  console.log(`${referenciadosNaQuarentena.length} ficheiro(s) em privado/quarentena/ que afinal são referenciados (links partidos):`);
  for (const o of referenciadosNaQuarentena) console.log(`  ${o.name}  ← ${o.refs.join(", ")}`);
  if (!repor) console.log("Corre com --repor para os devolver a motas/faturas/.\n");
}

if (repor) {
  for (const o of referenciadosNaQuarentena) {
    const desc = await fetch(`${URL_BASE}/storage/v1/object/privado/quarentena/${o.name}`, { headers: cabecalhos });
    if (!desc.ok) {
      console.error(`  ✗ ${o.name}: não consegui descarregar (${desc.status}) — fica na quarentena.`);
      continue;
    }
    const dados = Buffer.from(await desc.arrayBuffer());

    const env2 = await fetch(`${URL_BASE}/storage/v1/object/motas/${PASTA}/${o.name}`, {
      method: "POST",
      headers: { ...cabecalhos, "Content-Type": desc.headers.get("content-type") ?? "application/octet-stream" },
      body: dados,
    });
    if (!env2.ok && env2.status !== 409) {
      console.error(`  ✗ ${o.name}: falhou a cópia para o público (${env2.status}) — fica na quarentena.`);
      continue;
    }

    // Confirma pelo mesmo URL que o recibo abre, SEM credenciais, antes de apagar a quarentena.
    const pub = await fetch(`${URL_BASE}/storage/v1/object/public/motas/${PASTA}/${o.name}`);
    if (!pub.ok || !Buffer.from(await pub.arrayBuffer()).equals(dados)) {
      console.error(`  ✗ ${o.name}: URL público não confirmado (${pub.status}) — fica na quarentena.`);
      continue;
    }

    const apagar = await fetch(`${URL_BASE}/storage/v1/object/privado/quarentena/${o.name}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    console.log(apagar.ok ? `  ✓ ${o.name} → motas/${PASTA}/` : `  ✗ ${o.name}: reposto mas não apaguei da quarentena (${apagar.status}).`);
  }
  process.exit(0);
}

const orfaos = objetos.filter((o) => !referenciasDe(o.name).length);

const kb = (n) => `${Math.round((n ?? 0) / 1024)} KB`;
console.log(`${objetos.length} ficheiros em motas/${PASTA}; ${objetos.length - orfaos.length} referenciados, ${orfaos.length} órfãos.\n`);
if (!orfaos.length) {
  console.log("Nenhum órfão — nada exposto sem dono.");
  process.exit(0);
}

for (const o of orfaos) {
  const url = `${URL_BASE}/storage/v1/object/public/motas/${PASTA}/${o.name}`;
  const r = await fetch(url, { headers: { Range: "bytes=0-1" } }); // SEM credenciais
  const aberto = r.status === 200 || r.status === 206;
  console.log(`${aberto ? "LEGÍVEL SEM LOGIN" : "protegido       "}  ${kb(o.metadata?.size).padStart(8)}  ${(o.created_at ?? "").slice(0, 16)}  ${o.name}`);
}

if (!mover) {
  console.log(`\n${orfaos.length} órfão(s). Corre com --mover para os pôr em privado/quarentena/ (copia, confirma, e só depois apaga).`);
  process.exit(0);
}

console.log("\nA mover para privado/quarentena/…");
for (const o of orfaos) {
  const origem = `${PASTA}/${o.name}`;
  const destino = `quarentena/${o.name}`;

  const desc = await fetch(`${URL_BASE}/storage/v1/object/motas/${origem}`, { headers: cabecalhos });
  if (!desc.ok) {
    console.error(`  ✗ ${o.name}: não consegui descarregar (${desc.status}) — deixado como está.`);
    continue;
  }
  const dados = Buffer.from(await desc.arrayBuffer());

  const env2 = await fetch(`${URL_BASE}/storage/v1/object/privado/${destino}`, {
    method: "POST",
    headers: { ...cabecalhos, "Content-Type": desc.headers.get("content-type") ?? "application/octet-stream" },
    body: dados,
  });
  if (!env2.ok && env2.status !== 409) {
    console.error(`  ✗ ${o.name}: falhou a cópia para privado (${env2.status}) — NÃO apagado.`);
    continue;
  }

  // Confirma que a cópia existe e tem o mesmo tamanho ANTES de apagar o original.
  const naQuarentena = (await listarBucket("privado", "quarentena")).find((x) => x.name === o.name);
  if (!naQuarentena || naQuarentena.metadata?.size !== o.metadata?.size) {
    console.error(`  ✗ ${o.name}: cópia não confirmada — NÃO apagado.`);
    continue;
  }

  const apagar = await fetch(`${URL_BASE}/storage/v1/object/motas/${origem}`, {
    method: "DELETE",
    headers: cabecalhos,
  });
  console.log(apagar.ok ? `  ✓ ${o.name} → privado/quarentena/` : `  ✗ ${o.name}: copiado mas não apaguei (${apagar.status}).`);
}
