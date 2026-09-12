#!/usr/bin/env node
/**
 * Liga ao respetivo pagamento os 7 comprovativos que ficaram órfãos no bucket
 * PÚBLICO (motas/faturas) entre 07/09 e 11/09/2026 — e tira-os de lá. Uso único.
 *
 * O "Ler comprovativo" de Cobranças carregava o print para o público só para a IA
 * o ler, e o pagamento era gravado sem apontar para ele: o print (nomes, IBAN,
 * valores) ficava legível sem login e o pagamento ficava sem prova. O código já
 * grava em privado/comprovativos/ e liga o caminho a pagamento.comprovativo_url;
 * isto repara os que ficaram para trás.
 *
 * A correspondência NÃO foi adivinhada pela hora: cada par foi conferido pelo
 * conteúdo do print (valor, data e referência da operação) em 12/09/2026. Antes de
 * escrever, o script confere de novo que cada pagamento existe, tem o valor do
 * print e ainda não tem comprovativo — e se UM não bater, não escreve nada.
 *
 * Por ficheiro: copia para privado/comprovativos/ → confirma byte a byte → grava
 * comprovativo_url (só se ainda estiver vazio) → só então apaga do público.
 * Depois de uma falha pode correr-se outra vez: retoma onde parou.
 *
 * Uso:
 *   node scripts/ligar-comprovativos-orfaos.mjs            # só confere e mostra o plano
 *   node scripts/ligar-comprovativos-orfaos.mjs --aplicar  # executa
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

const aplicar = process.argv.includes("--aplicar");
const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };

// Conferido pelo conteúdo de cada print. Sem nºs de conta nem referências bancárias
// aqui, de propósito: o id do pagamento já é exato e o valor serve de confirmação
// (é o que distingue o par carregado às 15:32 de 10/09: 60 € e 110 €).
const LIGACOES = [
  { ficheiro: "7168971f-5997-4810-aedc-bba6d8c98c79-img-0769.png", pagamento: "41f8d5a7-d701-4e82-971f-6ee62c4a8bb6", valor: 60 }, // transferência, 07/09
  { ficheiro: "720f6dcf-c218-4fe3-80b9-dd3b0188d56e-img-0770.png", pagamento: "53a6f269-db19-4d00-98e9-4232073253d4", valor: 55 }, // SEPA instantânea, 07/09
  { ficheiro: "258c6cda-0fa5-408a-9d71-e315f0d617a3-img-0773.png", pagamento: "3b45b131-7cc1-472c-ae2b-538640baf2bb", valor: 60 }, // MB WAY, 08/09
  { ficheiro: "aee311d6-a1a3-4faa-87e2-e377d00e62c0-img-0784.png", pagamento: "ccd98362-9b82-40c3-a153-be815f05b03d", valor: 60 }, // Revolut, 10/09
  { ficheiro: "23f92828-1b9a-4178-9590-8e33a91b710d-img-0783.png", pagamento: "acef049e-9d7d-4de3-9a45-1f08213965e0", valor: 110 }, // BPI, 10/09
  { ficheiro: "da91a879-77e4-4952-b646-f8321fa374b5-img-0785.png", pagamento: "9f71e039-b4b9-4a14-8c25-f434ecaf2c68", valor: 60 }, // novobanco, 10/09
  { ficheiro: "6d721949-9dd2-44e2-a11f-7bbc5aa68f2c-img-0790.png", pagamento: "5503eb19-1f1a-4e31-bce7-feb05360562c", valor: 55 }, // Wise, 11/09
];

async function rest(caminho) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { headers: cabecalhos });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// null só quando o objeto NÃO EXISTE; qualquer outro erro rebenta — na dúvida, não se escreve.
async function baixar(bucket, caminho) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${caminho}`, { headers: cabecalhos });
  if (r.status === 400 || r.status === 404) {
    const corpo = await r.text();
    if (/not_found|NoSuchKey|Object not found/i.test(corpo)) return null;
    throw new Error(`${bucket}/${caminho}: ${r.status} ${corpo}`);
  }
  if (!r.ok) throw new Error(`${bucket}/${caminho}: ${r.status} ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

console.log(`Projeto: ${new URL(URL_BASE).hostname.split(".")[0]}\n`);

const plano = [];
const problemas = [];
for (const l of LIGACOES) {
  const destino = `comprovativos/${l.ficheiro}`;
  const [pag] = await rest(`pagamento?id=eq.${l.pagamento}&select=id,valor,comprovativo_url`);
  if (!pag) {
    problemas.push(`${l.ficheiro}: o pagamento ${l.pagamento} não existe (projeto errado? estornado?).`);
    continue;
  }
  if (Number(pag.valor) !== l.valor) {
    problemas.push(`${l.ficheiro}: o pagamento tem ${pag.valor} €, o print diz ${l.valor} €.`);
    continue;
  }
  if (pag.comprovativo_url && pag.comprovativo_url !== destino) {
    problemas.push(`${l.ficheiro}: o pagamento já aponta para outro comprovativo (${pag.comprovativo_url}).`);
    continue;
  }

  const publico = await baixar("motas", `faturas/${l.ficheiro}`);
  const privado = await baixar("privado", destino);
  const ligado = pag.comprovativo_url === destino;
  if (!publico && !privado) {
    problemas.push(`${l.ficheiro}: não está no público nem em privado/${destino}.`);
    continue;
  }
  if (publico && privado && !publico.equals(privado)) {
    problemas.push(`${l.ficheiro}: já existe em privado/${destino} com conteúdo diferente.`);
    continue;
  }
  if (ligado && !publico) {
    console.log(`  = ${l.ficheiro}: já ligado e fora do público.`);
    continue;
  }

  plano.push({ ...l, destino, publico, privado, ligado });
  console.log(`  → ${l.ficheiro}  →  pagamento ${l.pagamento} (${l.valor} €)`);
}

if (problemas.length) {
  console.error(`\nNada foi escrito — ${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  ✗ ${p}`);
  process.exit(1);
}
if (!plano.length) {
  console.log("\nNada por fazer.");
  process.exit(0);
}
if (!aplicar) {
  console.log(`\n${plano.length} comprovativo(s) por ligar. Corre com --aplicar para executar.`);
  process.exit(0);
}

console.log("\nA ligar…");
for (const p of plano) {
  // 1. Cópia em privado, confirmada byte a byte (salta se uma corrida anterior já a fez).
  if (!p.privado) {
    const envio = await fetch(`${URL_BASE}/storage/v1/object/privado/${p.destino}`, {
      method: "POST",
      headers: { ...cabecalhos, "Content-Type": "image/png" },
      body: p.publico,
    });
    const copia = envio.ok ? await baixar("privado", p.destino) : null;
    if (!copia?.equals(p.publico)) {
      console.error(`  ✗ ${p.ficheiro}: cópia para privado não confirmada (${envio.status}) — parado aqui, nada apagado.`);
      process.exit(1);
    }
  }

  // 2. Ligar ao pagamento — só se continuar vazio, para não pisar o que alguém fez entretanto.
  if (!p.ligado) {
    const r = await fetch(`${URL_BASE}/rest/v1/pagamento?id=eq.${p.pagamento}&comprovativo_url=is.null`, {
      method: "PATCH",
      headers: { ...cabecalhos, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ comprovativo_url: p.destino }),
    });
    const linhas = r.ok ? await r.json() : [];
    if (linhas.length !== 1) {
      console.error(`  ✗ ${p.ficheiro}: não consegui ligar ao pagamento (${r.status}) — parado aqui, o público fica como estava.`);
      process.exit(1);
    }
  }

  // 3. Só agora sai do público — e confirma-se que saiu.
  if (p.publico) {
    const apagar = await fetch(`${URL_BASE}/storage/v1/object/motas/faturas/${p.ficheiro}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    if (!apagar.ok || (await baixar("motas", `faturas/${p.ficheiro}`))) {
      console.error(`  ✗ ${p.ficheiro}: ligado, mas continua no público (${apagar.status}) — corre outra vez para o tirar.`);
      continue;
    }
  }
  console.log(`  ✓ ${p.ficheiro} → privado/${p.destino}, ligado a ${p.pagamento}`);
}
