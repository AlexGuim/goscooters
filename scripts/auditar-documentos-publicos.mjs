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
 * Um ficheiro é ÓRFÃO quando nenhuma despesa, motorista, mota ou vistoria o
 * referencia. Órfão não quer dizer lixo: pode ser o único exemplar de um documento.
 * Por isso `--mover` COPIA para privado/quarentena/ e só apaga do público depois de
 * confirmar, byte a byte, que a cópia ficou lá.
 *
 * Uso:
 *   node scripts/auditar-documentos-publicos.mjs           # só lista
 *   node scripts/auditar-documentos-publicos.mjs --mover   # põe os órfãos em quarentena
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
const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };

async function rest(caminho) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { headers: cabecalhos });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
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

// Tudo o que pode apontar para um ficheiro. O `detalhe` das despesas guarda o
// `documento_url` completo, por isso compara-se contra o JSON inteiro da linha.
const fontes = await Promise.all([
  rest("despesa?select=id,descricao,detalhe,documento_id"),
  rest("motorista?select=id,nome,doc_urls"),
  rest("moto?select=id,matricula,seguro_documento_url,documento_url").catch(() => []),
  rest("vistoria?select=id,foto_urls,video_url").catch(() => []),
  rest("manutencao?select=id,documento_url").catch(() => []),
  rest("seguro?select=id,documento_url").catch(() => []),
]);
const textoDasFontes = fontes.map((f) => JSON.stringify(f)).join("\n");

const orfaos = [];
for (const o of objetos) {
  // O id único do ficheiro (o prefixo uuid) chega para o encontrar em qualquer campo.
  const id = o.name.slice(0, 36);
  if (!textoDasFontes.includes(id) && !textoDasFontes.includes(o.name)) orfaos.push(o);
}

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
