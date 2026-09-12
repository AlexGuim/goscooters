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
 * POSSÍVEL CÓPIA PÚBLICA DE FICHEIRO JÁ EM PRIVADO: referenciado, mas o id só aparece
 * DENTRO de caminhos privados (infracoes/, kyc/, comprovativos/, quarentena/) — em
 * nenhum URL ou caminho público. É o rasto de uma passagem para privado em que a
 * cópia correu bem e a remoção do público falhou: a linha já aponta para a cópia
 * privada (que guarda o id original no nome) e o documento continua legível por URL.
 * Conta como referenciado — o `--mover` NÃO lhe mexe —, mas a execução acaba com
 * código 1: "nenhum órfão" não pode passar por "nada exposto".
 *
 * Uso:
 *   node scripts/auditar-documentos-publicos.mjs           # só lista
 *   node scripts/auditar-documentos-publicos.mjs --mover   # põe os órfãos em quarentena
 *   node scripts/auditar-documentos-publicos.mjs --repor   # devolve ao público o que está em quarentena mas é referenciado
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(import.meta.dirname, "..");
const PASTA = "faturas";

// ── Partes puras (testadas em auditar-documentos-publicos.test.mjs) ──────────

/** Pastas do bucket "privado" para onde um ficheiro do público passa com o id original no nome. */
export const PASTAS_PRIVADAS = ["infracoes", "kyc", "comprovativos", "quarentena"];

/** O id único do ficheiro (o prefixo uuid) chega para o encontrar em qualquer campo. */
export const idDoFicheiro = (nome) => nome.slice(0, 36);

/** Cada tabela lida, com as linhas e o JSON inteiro (onde se procuram as referências). */
export function prepararTabelas(tabelas, fontes) {
  return tabelas.map((tabela, i) => ({ tabela, linhas: fontes[i], texto: JSON.stringify(fontes[i]) }));
}

/**
 * Tabelas cujo JSON contém o id do ficheiro. É ESTA a regra dos órfãos (e do que o
 * `--mover` põe em quarentena): larga de propósito — um URL guardado num sítio que
 * ninguém previu continua a contar como referência.
 */
export function tabelasQueReferem(nome, tabelasLidas) {
  const id = idDoFicheiro(nome);
  return tabelasLidas.filter((t) => t.texto.includes(id)).map((t) => t.tabela);
}

// O que separa um caminho ou URL do texto à volta: aspas (JSON guardado em texto),
// listas, parênteses e asteriscos de uma mensagem… A barra invertida NÃO separa (`kyc\/…`).
const SEPARADOR = /[\s"'`<>()[\]{},;|=&*]/;
const URL_DO_STORAGE =
  /\/storage\/v1\/(?:object|render\/image)\/(?:(?:public|sign|authenticated|info|upload)\/)*([^/?#]+)\/[^?#]*$/i;

/**
 * Onde está UMA ocorrência do id, pelo texto que a antecede até ao separador:
 *  - "privado": dentro de um caminho de uma das PASTAS_PRIVADAS (com ou sem `privado/`
 *    à frente) ou de um URL do storage para o bucket "privado" (um link assinado);
 *  - "publico": num URL do storage de outro bucket, ou num caminho `faturas/…`/`motas/…`;
 *  - "outro": o resto (nome solto, texto livre, outro URL).
 */
export function ondeEstaOcorrencia(antes) {
  let p = String(antes).replace(/\\\//g, "/").replace(/%2f/gi, "/");
  const url = p.match(URL_DO_STORAGE);
  if (url) return url[1].toLowerCase() === "privado" ? "privado" : "publico";
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return "outro";
  p = p.replace(/^\/+/, "");
  if (p.startsWith("privado/")) p = p.slice("privado/".length);
  if (PASTAS_PRIVADAS.some((pasta) => p.startsWith(`${pasta}/`))) return "privado";
  if (p.startsWith(`${PASTA}/`) || p.startsWith("motas/")) return "publico";
  return "outro";
}

/** Onde aparece o id em cada texto e chave de um valor lido da base (objetos, listas, texto). */
export function ondeApareceId(valor, id, onde = []) {
  if (!id) return onde;
  if (typeof valor === "string") {
    for (let i = valor.indexOf(id); i !== -1; i = valor.indexOf(id, i + id.length)) {
      let inicio = i;
      while (inicio > 0 && !SEPARADOR.test(valor[inicio - 1])) inicio--;
      onde.push(ondeEstaOcorrencia(valor.slice(inicio, i)));
    }
  } else if (Array.isArray(valor)) {
    for (const v of valor) ondeApareceId(v, id, onde);
  } else if (valor && typeof valor === "object") {
    for (const [chave, v] of Object.entries(valor)) {
      if (chave.includes(id)) onde.push("outro");
      ondeApareceId(v, id, onde);
    }
  }
  return onde;
}

/**
 * O id aparece, mas SÓ dentro de caminhos privados? Basta uma ocorrência noutro sítio
 * (URL público, `faturas/…`, texto solto) para não ser: aí é uma referência como as outras.
 */
export function soEmCaminhosPrivados(nome, linhas) {
  const onde = ondeApareceId(linhas, idDoFicheiro(nome));
  return onde.length > 0 && onde.every((o) => o === "privado");
}

/**
 * Divide os ficheiros do público em:
 *  - órfãos — nenhuma tabela os referencia; SÓ estes vão para a quarentena;
 *  - copiasPublicas — referenciados, mas só por caminhos privados; só se reportam.
 */
export function classificarFicheiros(objetos, tabelasLidas) {
  const orfaos = [];
  const copiasPublicas = [];
  for (const o of objetos) {
    const id = idDoFicheiro(o.name);
    const refs = tabelasLidas.filter((t) => t.texto.includes(id));
    if (!refs.length) orfaos.push(o);
    else if (soEmCaminhosPrivados(o.name, refs.map((t) => t.linhas))) {
      copiasPublicas.push({ ...o, refs: refs.map((t) => t.tabela) });
    }
  }
  return { orfaos, copiasPublicas };
}

// ── Execução ─────────────────────────────────────────────────────────────────

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

async function main() {
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
  const tabelasLidas = prepararTabelas(tabelas, fontes);
  console.log(`Referências procuradas em ${tabelas.length} tabelas/vistas (${fontes.flat().length} linhas).\n`);

  const referenciasDe = (nome) => tabelasQueReferem(nome, tabelasLidas);

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

  // Os órfãos continuam a ser decididos pela regra larga (referenciasDe): o que o
  // --mover move não muda. As cópias públicas são uma leitura a mais, só para reportar.
  const { orfaos, copiasPublicas } = classificarFicheiros(objetos, tabelasLidas);
  const codigo = copiasPublicas.length ? 1 : 0;

  const kb = (n) => `${Math.round((n ?? 0) / 1024)} KB`;
  async function descrever(o) {
    const url = `${URL_BASE}/storage/v1/object/public/motas/${PASTA}/${o.name}`;
    const r = await fetch(url, { headers: { Range: "bytes=0-1" } }); // SEM credenciais
    const aberto = r.status === 200 || r.status === 206;
    return `${aberto ? "LEGÍVEL SEM LOGIN" : "protegido       "}  ${kb(o.metadata?.size).padStart(8)}  ${(o.created_at ?? "").slice(0, 16)}  ${o.name}`;
  }

  console.log(`${objetos.length} ficheiros em motas/${PASTA}; ${objetos.length - orfaos.length} referenciados, ${orfaos.length} órfãos.\n`);

  if (copiasPublicas.length) {
    console.log(
      `${copiasPublicas.length} possível(eis) cópia(s) pública(s) de ficheiro já em privado — o id só aparece dentro de ` +
        `caminhos privados (${PASTAS_PRIVADAS.map((p) => `${p}/`).join(", ")}), em nenhum URL ou caminho público:`,
    );
    for (const o of copiasPublicas) console.log(`${await descrever(o)}  ← ${o.refs.join(", ")}`);
    console.log(
      "O --mover NÃO lhes mexe (contam como referenciados). Confirma que a cópia privada é o mesmo documento " +
        `e apaga-os de motas/${PASTA} no Supabase. Enquanto houver algum, a auditoria acaba com código 1.\n`,
    );
  }

  if (!orfaos.length) {
    console.log(copiasPublicas.length ? "Nenhum órfão." : "Nenhum órfão — nada exposto sem dono.");
    process.exit(codigo);
  }

  for (const o of orfaos) console.log(await descrever(o));

  if (!mover) {
    console.log(`\n${orfaos.length} órfão(s). Corre com --mover para os pôr em privado/quarentena/ (copia, confirma, e só depois apaga).`);
    process.exit(codigo);
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
  if (copiasPublicas.length) {
    console.error(`\n${copiasPublicas.length} possível(eis) cópia(s) pública(s) de ficheiro já em privado ficaram onde estavam (ver acima).`);
  }
  process.exitCode = codigo;
}

// Importado pelos testes não corre (nem pede o .env.local).
// Compara os caminhos reais: corrido por um caminho com ligação simbólica também arranca.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
