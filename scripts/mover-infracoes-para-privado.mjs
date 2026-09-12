#!/usr/bin/env node
/**
 * Tira do bucket PÚBLICO os documentos de coima e de portagem já registados.
 *
 * O intake carrega tudo para "motas" (é de lá que a IA classifica) e, até agora,
 * a despesa de uma coima ou portagem ficava a apontar para o URL público do
 * aviso/auto: matrícula, local, hora e a quem foi notificada, legíveis por quem
 * soubesse o URL. O código já passa estes documentos para o bucket "privado"
 * (`infracoes/…`) e a despesa guarda o CAMINHO; isto repara as que ficaram para trás.
 *
 * Por ficheiro: copia para privado/infracoes/<mesmo nome> → confirma o tamanho →
 * grava o caminho na(s) despesa(s) (só se ainda apontarem para o mesmo URL) → só
 * então apaga do público, e confirma que saiu: pela listagem E pelo URL público
 * antigo pedido SEM credenciais, que tem de responder 400 ou 404. Se alguma coisa
 * não bater (ficheiro em falta, destino já ocupado com outro tamanho, o mesmo URL
 * usado por um seguro, uma manutenção ou uma despesa que não é coima/portagem, um
 * URL de outro projeto), NÃO se escreve nada.
 * Depois de uma falha a meio pode correr-se outra vez: retoma onde parou — também
 * quando o mesmo ficheiro serve mais do que uma despesa (as que já têm o caminho
 * gravado juntam-se ao grupo das que faltam, em vez de pararem a corrida).
 *
 * Também confere as despesas que já apontam para privado: se o original ainda
 * estiver no público — com o mesmo nome, ou `faturas/<uuid original>-…` quando a app
 * lhe deu nome novo (`infracoes/<uuid novo>-<uuid original>-…`) — é reportado e
 * nada se escreve.
 *
 * Instância: as credenciais vêm da shell ou do .env.local; se as duas tiverem
 * valores diferentes, aborta (ganhava a shell, sem ninguém dar por isso). Com
 * --aplicar é obrigatório --projeto=<ref>, igual ao primeiro rótulo do host de
 * NEXT_PUBLIC_SUPABASE_URL.
 *
 * Só imprime ids de despesas, contagens e estado — nunca URLs, nomes de ficheiro
 * ou corpos de resposta (podem trazer dados pessoais), nem as chaves.
 *
 * Uso:
 *   node scripts/mover-infracoes-para-privado.mjs                            # a seco: só confere e mostra o plano
 *   node scripts/mover-infracoes-para-privado.mjs --aplicar --projeto=<ref>  # executa
 * Depois do --aplicar, corre outra vez a seco: tem de dizer "Nada por fazer".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BUCKET_PUBLICO = "motas";
const BUCKET_PRIVADO = "privado";
const PASTA_PUBLICA = "faturas"; // onde o intake grava (enviarDocumento)
const PASTA_INFRACOES = "infracoes";
const MARCADOR_PUBLICO = `/storage/v1/object/public/${BUCKET_PUBLICO}/`;

// ── Partes puras (testadas em mover-infracoes-para-privado.test.mjs) ──────────

/** Caminho de storage aceitável: relativo, sem `..`, `.` nem segmentos vazios. */
function caminhoSeguro(caminho) {
  if (typeof caminho !== "string" || !caminho || caminho.startsWith("/") || caminho.includes("\\")) return false;
  return caminho.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/**
 * `https://…/storage/v1/object/public/motas/faturas/x.pdf` → `faturas/x.pdf`, ou
 * null. A mesma regra de src/lib/documentoDespesa.ts (o script não depende do app).
 */
export function caminhoDoUrlPublico(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  const i = url.indexOf(MARCADOR_PUBLICO);
  if (i === -1) return null;
  const resto = url.slice(i + MARCADOR_PUBLICO.length).split(/[?#]/)[0];
  let caminho;
  try {
    caminho = decodeURIComponent(resto);
  } catch {
    return null;
  }
  return caminhoSeguro(caminho) ? caminho : null;
}

/**
 * O que fazer com UMA despesa:
 *  - { acao: "mover", url, origem, destino } — o documento está no bucket público;
 *  - { acao: "conferir_resto", origem, destino } — já aponta para privado, mas
 *    uma corrida anterior pode ter gravado o caminho sem conseguir apagar o público;
 *  - { acao: "ignorar", motivo } — "categoria" (não é coima/portagem), "sem_documento",
 *    ou "fora_do_bucket" (link externo ou formato desconhecido: não é nosso para mover).
 */
export function planearDespesa(despesa) {
  if (despesa?.categoria !== "coima" && despesa?.categoria !== "portagem") {
    return { acao: "ignorar", motivo: "categoria" };
  }
  const detalhe = despesa.detalhe;
  const valor =
    detalhe && typeof detalhe === "object" && !Array.isArray(detalhe) ? detalhe.documento_url : null;
  if (typeof valor !== "string" || !valor.trim()) return { acao: "ignorar", motivo: "sem_documento" };

  const v = valor.trim();
  if (v.startsWith(`${PASTA_INFRACOES}/`) && caminhoSeguro(v)) {
    return { acao: "conferir_resto", origem: `${PASTA_PUBLICA}/${v.split("/").pop()}`, destino: v };
  }
  const origem = caminhoDoUrlPublico(v);
  if (!origem) return { acao: "ignorar", motivo: "fora_do_bucket" };
  // O MESMO nome (o prefixo uuid incluído): a auditoria do bucket público continua
  // a reconhecer o ficheiro pelo uuid, e uma segunda corrida encontra-o.
  return { acao: "mover", url: valor, origem, destino: `${PASTA_INFRACOES}/${origem.split("/").pop()}` };
}

/**
 * Junta as despesas por ficheiro (um ficheiro pode servir mais do que uma despesa):
 *  - mover: [{ url, origem, destino, despesas: [{ id, categoria, detalhe }], jaEmPrivado: [ids], urlsDiferentes }];
 *  - conferir: [{ origem, destino, ids }] — já em privado, sem nenhuma despesa do mesmo ficheiro por mover;
 *  - ignoradas: { sem_documento, fora_do_bucket }.
 * Uma despesa já em privado cujo ficheiro ainda serve outra por mover (o PATCH de uma
 * falhou numa corrida anterior) entra em `jaEmPrivado` desse grupo: o PATCH das que
 * faltam e o DELETE seguem juntos. Sozinha, a conferência contava a outra como "linha
 * que ainda usa o URL" e parava todas as corridas seguintes.
 */
export function agruparDespesas(despesas) {
  const ignoradas = { sem_documento: 0, fora_do_bucket: 0 };
  const mover = new Map(); // por origem
  const conferir = new Map(); // por destino
  for (const d of despesas) {
    const p = planearDespesa(d);
    if (p.acao === "mover") {
      const g = mover.get(p.origem) ?? {
        url: p.url,
        origem: p.origem,
        destino: p.destino,
        despesas: [],
        jaEmPrivado: [],
        urlsDiferentes: false,
      };
      // Mesmo ficheiro por URLs escritos de forma diferente: resolve-se à mão.
      if (g.url !== p.url) g.urlsDiferentes = true;
      g.despesas.push({ id: d.id, categoria: d.categoria, detalhe: d.detalhe });
      mover.set(p.origem, g);
    } else if (p.acao === "conferir_resto") {
      const c = conferir.get(p.destino) ?? { origem: p.origem, destino: p.destino, ids: [] };
      c.ids.push(d.id);
      conferir.set(p.destino, c);
    } else if (p.motivo in ignoradas) {
      ignoradas[p.motivo]++;
    }
  }
  for (const [destino, c] of conferir) {
    const g = mover.get(c.origem);
    if (g && g.destino === destino) {
      g.jaEmPrivado.push(...c.ids);
      conferir.delete(destino);
    }
  }
  return { mover: [...mover.values()], conferir: [...conferir.values()], ignoradas };
}

/** Estado de uma resposta HTTP sem ecoar o corpo (pode trazer o caminho ou o URL). */
export function motivoHttp(status, corpo) {
  let codigo = "";
  try {
    const j = JSON.parse(corpo);
    codigo = String(j?.code ?? j?.error ?? "");
  } catch {
    // corpo não-JSON: fica só o status
  }
  return /^[\w.-]{1,40}$/.test(codigo) ? `${status} ${codigo}` : String(status);
}

/** Primeiro rótulo do host (`abcd` em https://abcd.supabase.co), ou null. */
export function refDoUrl(url) {
  try {
    return new URL(String(url)).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

const VARIAVEIS = { url: "NEXT_PUBLIC_SUPABASE_URL", chave: "SUPABASE_SERVICE_ROLE_KEY" };
const semBarraFinal = (url) => url.replace(/\/+$/, "");

/**
 * Credenciais a usar. A shell passa à frente do .env.local (a ordem do Next.js), e é
 * aí que mora o engano: uma shell que ficou com as variáveis de outra instância
 * (~/Plataforma-instancias) escrevia na base errada. Por isso, se as duas fontes
 * tiverem valores DIFERENTES, não se escolhe — aborta e diz qual ganhava. Nunca ecoa a chave.
 */
export function escolherCredenciais(envLocal, envShell) {
  const ler = (fonte, nome) => {
    const v = typeof fonte?.[nome] === "string" ? fonte[nome].trim() : "";
    return nome === VARIAVEIS.url ? semBarraFinal(v) : v;
  };
  const valores = {};
  const origens = {};
  const conflitos = [];
  for (const [campo, nome] of Object.entries(VARIAVEIS)) {
    const local = ler(envLocal, nome);
    const shell = ler(envShell, nome);
    if (local && shell && local !== shell) {
      conflitos.push(
        campo === "url"
          ? `${nome}: a da shell (projeto ${refDoUrl(shell) ?? "?"}) é diferente da do .env.local (projeto ${refDoUrl(local) ?? "?"})`
          : `${nome}: a da shell é diferente da do .env.local`,
      );
    }
    valores[campo] = shell || local;
    origens[campo] = shell && shell !== local ? "shell" : ".env.local";
  }
  if (conflitos.length) {
    return {
      ok: false,
      erro: [
        "Credenciais em conflito — abortado, nada lido nem escrito:",
        ...conflitos.map((c) => `  ✗ ${c}`),
        "Ganhava a da SHELL: as variáveis exportadas passam à frente do .env.local (a mesma ordem do Next.js),",
        "e uma shell que ficou com as credenciais de outra instância escrevia na base errada.",
        `Tira-as da shell (unset ${Object.values(VARIAVEIS).join(" ")}) ou acerta o .env.local, e corre outra vez.`,
      ].join("\n"),
    };
  }
  if (!valores.url || !valores.chave) {
    return { ok: false, erro: "Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (.env.local)." };
  }
  if (!/^https?:\/\//i.test(valores.url) || !refDoUrl(valores.url)) {
    return { ok: false, erro: "NEXT_PUBLIC_SUPABASE_URL não é um URL válido — abortado." };
  }
  return { ok: true, url: valores.url, chave: valores.chave, origens };
}

/** `--aplicar` e `--projeto=<ref>`. `projeto`: null se não veio; "" se veio vazio ou repetido. */
export function lerArgumentos(argv) {
  const dados = argv.filter((a) => a === "--projeto" || a.startsWith("--projeto="));
  const projeto = dados.length === 1 ? dados[0].slice("--projeto=".length).trim() : dados.length ? "" : null;
  return { aplicar: argv.includes("--aplicar"), projeto };
}

/**
 * As credenciais são do projeto que se pediu? Com --aplicar, --projeto=<ref> é
 * obrigatório; a seco é opcional, mas se vier também tem de bater. O erro de "falta"
 * não mostra o ref configurado: copiá-lo sem pensar anulava a guarda.
 */
export function conferirProjeto({ aplicar, projeto }, url) {
  const ref = refDoUrl(url);
  if (!ref) return { ok: false, erro: "NEXT_PUBLIC_SUPABASE_URL não é um URL válido — abortado." };
  if (projeto === "") return { ok: false, erro: "Usa --projeto=<ref> uma só vez e com o ref — abortado, nada escrito." };
  if (projeto === null) {
    return aplicar
      ? {
          ok: false,
          erro:
            "--aplicar exige --projeto=<ref do projeto onde queres escrever> (o primeiro rótulo do URL da base; " +
            "confere-o no painel do Supabase) — abortado, nada escrito.",
        }
      : { ok: true, ref };
  }
  if (projeto.toLowerCase() !== ref) {
    return { ok: false, erro: `Pediste --projeto=${projeto}, mas as credenciais são do projeto ${ref} — abortado, nada escrito.` };
  }
  return { ok: true, ref };
}

/** URL público de um caminho do bucket "motas" — o que o storage serve a quem não tem login. */
export function urlPublicoDe(urlBase, caminho) {
  return `${semBarraFinal(urlBase)}${MARCADOR_PUBLICO}${caminho.split("/").map(encodeURIComponent).join("/")}`;
}

/** O URL guardado é do projeto das credenciais (mesmo esquema e host)? */
export function mesmoProjeto(url, urlBase) {
  try {
    return new URL(String(url).trim()).origin === new URL(urlBase).origin;
  } catch {
    return false;
  }
}

/**
 * O público só se dá por fechado quando o URL antigo, pedido SEM credenciais, responde
 * 400 ou 404 (o que o storage responde a um objeto que não existe). 200 é o documento
 * ainda legível — apagado do storage mas servido pela cache do CDN, por exemplo; e
 * qualquer outra resposta (ou nenhuma) também não confirma.
 */
export const saidaConfirmada = (status) => status === 400 || status === 404;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NOME_DADO_PELA_APP = new RegExp(`^${UUID}-(${UUID})-`, "i");

/**
 * `infracoes/<uuid novo>-<uuid original>-…` (o nome que o moverDocumentoParaPrivado
 * dá) → o uuid original: o público de onde veio chamava-se `faturas/<uuid original>-…`.
 * Null quando o nome não traz os dois uuids (o script copia com o MESMO nome).
 */
export function uuidDoOriginal(destino) {
  const m = String(destino).split("/").pop().match(NOME_DADO_PELA_APP);
  return m ? m[1].toLowerCase() : null;
}

/** Da listagem de `faturas/` (pesquisa pelo uuid), os ficheiros cujo nome começa por `<uuid>-`. */
export function restosDoOriginal(listagem, uuid) {
  const inicio = `${String(uuid).toLowerCase()}-`;
  return (Array.isArray(listagem) ? listagem : [])
    .filter((o) => o?.id && typeof o.name === "string" && o.name.toLowerCase().startsWith(inicio))
    .map((o) => {
      const tamanho = Number(o.metadata?.size);
      return { caminho: `${PASTA_PUBLICA}/${o.name}`, tamanho: Number.isFinite(tamanho) ? tamanho : null };
    });
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

const codificar = (caminho) => caminho.split("/").map(encodeURIComponent).join("/");
const kb = (n) => `${Math.max(1, Math.round((n ?? 0) / 1024))} KB`;

async function main() {
  const cred = escolherCredenciais(carregarEnv(), process.env);
  if (!cred.ok) {
    console.error(cred.erro);
    process.exit(1);
  }
  const args = lerArgumentos(process.argv.slice(2));
  const projeto = conferirProjeto(args, cred.url);
  if (!projeto.ok) {
    console.error(projeto.erro);
    process.exit(1);
  }
  const URL_BASE = cred.url;
  const CHAVE = cred.chave;
  const { aplicar } = args;
  const cabecalhos = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` };

  // Um erro de leitura REBENTA: "não consegui ler" nunca pode passar por "nada a fazer".
  async function rest(caminho) {
    const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { headers: cabecalhos });
    if (!r.ok) {
      throw new Error(`Não li ${caminho.split("?")[0]} (${motivoHttp(r.status, await r.text())}) — abortado, nada escrito.`);
    }
    return r.json();
  }

  // Tabela inteira, página a página (o PostgREST corta em max-rows sem avisar).
  async function lerTodas(consulta) {
    const linhas = [];
    for (;;) {
      const pagina = await rest(`${consulta}&limit=1000&offset=${linhas.length}`);
      if (!pagina.length) return linhas;
      linhas.push(...pagina);
    }
  }

  // Objetos de uma pasta cujo nome começa por `pesquisa`. Qualquer erro rebenta.
  async function listar(bucket, pasta, pesquisa) {
    const r = await fetch(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
      method: "POST", // é uma LEITURA: a API de listagem do storage é por POST
      headers: { ...cabecalhos, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: pasta, search: pesquisa, limit: 100, offset: 0 }),
    });
    if (!r.ok) throw new Error(`Não consegui listar o bucket ${bucket} (${motivoHttp(r.status, await r.text())}) — abortado.`);
    return r.json();
  }

  // { tamanho } se o objeto existe, null se não existe. Qualquer erro rebenta.
  async function objeto(bucket, caminho) {
    const i = caminho.lastIndexOf("/");
    const nome = caminho.slice(i + 1);
    const o = (await listar(bucket, i === -1 ? "" : caminho.slice(0, i), nome)).find((x) => x.name === nome && x.id);
    if (!o) return null;
    const tamanho = Number(o.metadata?.size);
    return { tamanho: Number.isFinite(tamanho) ? tamanho : null };
  }

  // Status do URL público pedido SEM credenciais — o que vê quem tiver o link. A
  // listagem é com service_role e não prova que o URL deixou de abrir. null: sem resposta.
  async function statusSemLogin(caminho) {
    try {
      const r = await fetch(urlPublicoDe(URL_BASE, caminho));
      await r.body?.cancel();
      return r.status;
    } catch {
      return null;
    }
  }

  // Linhas (fora das despesas deste plano) que usam o mesmo URL — mover partia-lhes o link.
  async function outrasReferencias(url, idsDoPlano) {
    const filtro = `detalhe->>documento_url=eq.${encodeURIComponent(url)}`;
    const [despesas, seguros, manutencoes] = await Promise.all([
      rest(`despesa?select=id&${filtro}`),
      rest(`seguro?select=id&${filtro}`),
      rest(`manutencao?select=id&${filtro}`),
    ]);
    return despesas.filter((d) => !idsDoPlano.has(d.id)).length + seguros.length + manutencoes.length;
  }

  const de = (origem) => (origem === "shell" ? "da shell" : "do .env.local");
  const credenciais =
    cred.origens.url === cred.origens.chave
      ? `credenciais ${de(cred.origens.url)}`
      : `URL ${de(cred.origens.url)}, chave ${de(cred.origens.chave)}`;
  console.log(`Projeto: ${projeto.ref} (${credenciais})${aplicar ? "" : "  (a seco — nada é escrito)"}\n`);

  const despesas = await lerTodas("despesa?select=id,categoria,detalhe&categoria=in.(coima,portagem)&order=id");
  const { mover, conferir, ignoradas } = agruparDespesas(despesas);
  const noPublico = mover.reduce((s, g) => s + g.despesas.length, 0);
  const emPrivado = conferir.reduce((s, c) => s + c.ids.length, 0) + mover.reduce((s, g) => s + g.jaEmPrivado.length, 0);
  console.log(
    `${despesas.length} despesa(s) de coima/portagem: ${noPublico} com o documento no bucket público, ` +
      `${emPrivado} já em privado, ${ignoradas.sem_documento} sem documento, ` +
      `${ignoradas.fora_do_bucket} com um link fora do bucket público (não se mexe).\n`,
  );

  const idsDoPlano = new Set(mover.flatMap((g) => g.despesas.map((d) => d.id)));
  const origensDoPlano = new Set(mover.map((g) => g.origem));
  const plano = [];
  const problemas = [];

  for (const g of mover) {
    const ids = g.despesas.map((d) => d.id).join(", ");
    if (g.urlsDiferentes) {
      problemas.push(`despesa(s) ${ids}: o mesmo ficheiro com URLs diferentes.`);
      continue;
    }
    if (!mesmoProjeto(g.url, URL_BASE)) {
      problemas.push(`despesa(s) ${ids}: o URL guardado não é deste projeto (outro host).`);
      continue;
    }
    const outras = await outrasReferencias(g.url, idsDoPlano);
    if (outras) {
      problemas.push(`despesa(s) ${ids}: o mesmo documento é usado por mais ${outras} linha(s) (seguro, manutenção ou outra despesa).`);
      continue;
    }
    const publico = await objeto(BUCKET_PUBLICO, g.origem);
    const privado = await objeto(BUCKET_PRIVADO, g.destino);
    if (!publico && !privado) {
      problemas.push(`despesa(s) ${ids}: o ficheiro não está no público nem em privado (link já partido).`);
      continue;
    }
    if ((publico && publico.tamanho == null) || (privado && privado.tamanho == null)) {
      problemas.push(`despesa(s) ${ids}: o storage não devolveu o tamanho do ficheiro.`);
      continue;
    }
    if (publico && privado && publico.tamanho !== privado.tamanho) {
      problemas.push(`despesa(s) ${ids}: já existe em privado/${PASTA_INFRACOES}/ um ficheiro com o mesmo nome e outro tamanho.`);
      continue;
    }
    const estado = !privado
      ? "por copiar"
      : publico
        ? "já copiado — falta gravar o caminho e apagar o público"
        : "já só em privado — falta gravar o caminho";
    const jaGravadas = g.jaEmPrivado.length ? ` (+ ${g.jaEmPrivado.join(", ")} já com o caminho gravado)` : "";
    plano.push({ ...g, publico, privado });
    console.log(`  → despesa(s) ${ids}${jaGravadas} (${g.despesas.map((d) => d.categoria).join(", ")}, ${kb((publico ?? privado).tamanho)}): ${estado}`);
  }

  // Já apontam para privado (corrida anterior ou a app): o público pode ter ficado.
  for (const c of conferir) {
    const ids = c.ids.join(", ");

    // Nome dado pela app: o original era faturas/<uuid original>-…, não faturas/<mesmo nome>.
    const original = uuidDoOriginal(c.destino);
    if (original) {
      const restos = restosDoOriginal(await listar(BUCKET_PUBLICO, PASTA_PUBLICA, original), original).filter(
        (r) => !origensDoPlano.has(r.caminho),
      );
      if (restos.length) {
        const privado = await objeto(BUCKET_PRIVADO, c.destino);
        const iguais = privado?.tamanho != null && restos.every((r) => r.tamanho === privado.tamanho);
        let usos = 0;
        for (const r of restos) usos += await outrasReferencias(urlPublicoDe(URL_BASE, r.caminho), new Set());
        problemas.push(
          `despesa(s) ${ids}: o original ainda está no bucket público (${restos.length} ficheiro(s) ${PASTA_PUBLICA}/<uuid original>-…, ` +
            `${iguais ? "mesmo tamanho da cópia privada" : "tamanho diferente da cópia privada ou por confirmar"}, ` +
            `${usos ? `usado por ${usos} linha(s) — não o apagues sem ver` : "nenhuma despesa, seguro ou manutenção o usa"}). ` +
            "A app gravou o caminho privado sem conseguir apagar o público: confirma e apaga-o à mão no Supabase.",
        );
      }
    }

    const publico = await objeto(BUCKET_PUBLICO, c.origem);
    if (!publico) {
      // A listagem já não o mostra; o URL público também tem de o negar (cache do CDN).
      const status = await statusSemLogin(c.origem);
      if (!saidaConfirmada(status)) {
        problemas.push(
          `despesa(s) ${ids}: já não está na listagem do público, mas o URL público antigo ainda responde ` +
            `${status ?? "(sem resposta)"} — pode ser a cache do CDN; corre outra vez daqui a uns minutos.`,
        );
      }
      continue;
    }
    const privado = await objeto(BUCKET_PRIVADO, c.destino);
    if (!privado || privado.tamanho == null || privado.tamanho !== publico.tamanho) {
      problemas.push(`despesa(s) ${ids}: sobrou uma cópia pública, mas a privada não está confirmada (em falta ou com outro tamanho).`);
      continue;
    }
    const outras = await outrasReferencias(urlPublicoDe(URL_BASE, c.origem), new Set());
    if (outras) {
      problemas.push(`despesa(s) ${ids}: sobrou uma cópia pública que ainda é usada por ${outras} linha(s).`);
      continue;
    }
    plano.push({ origem: c.origem, destino: c.destino, despesas: [], publico, privado, soApagar: ids });
    console.log(`  → despesa(s) ${ids}: já em privado — falta apagar a cópia que sobrou no público (${kb(publico.tamanho)})`);
  }

  if (problemas.length) {
    console.error(`\nNada foi escrito — ${problemas.length} problema(s):`);
    for (const p of problemas) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  if (!plano.length) {
    console.log("\nNada por fazer — nenhum documento de coima/portagem no bucket público.");
    process.exit(0);
  }
  if (!aplicar) {
    console.log(`\n${plano.length} ficheiro(s) por tratar. Corre com --aplicar --projeto=<ref> para executar.`);
    process.exit(0);
  }

  console.log("\nA mover…");
  // Caminho já gravado, mas o ficheiro não saiu do público (ou o URL ainda o serve):
  // não pára o resto do plano, mas a corrida NÃO acaba com sucesso (exit 1) — quem
  // olha só para o código de saída não pode ler "tudo bem" com um aviso ainda legível.
  let ficaramNoPublico = 0;
  for (const p of plano) {
    const ids = p.soApagar ?? [...p.despesas.map((d) => d.id), ...(p.jaEmPrivado ?? [])].join(", ");

    // 1. Cópia em privado, confirmada pelo tamanho (salta se já lá está com o mesmo).
    if (!p.privado) {
      const desc = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET_PUBLICO}/${codificar(p.origem)}`, {
        headers: cabecalhos,
      });
      if (!desc.ok) {
        console.error(`  ✗ despesa(s) ${ids}: não consegui descarregar (${desc.status}) — parado aqui, nada apagado.`);
        process.exit(1);
      }
      const dados = Buffer.from(await desc.arrayBuffer());
      if (dados.length !== p.publico.tamanho) {
        console.error(`  ✗ despesa(s) ${ids}: descarreguei ${dados.length} bytes, o storage diz ${p.publico.tamanho} — parado aqui.`);
        process.exit(1);
      }
      const envio = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET_PRIVADO}/${codificar(p.destino)}`, {
        method: "POST",
        headers: { ...cabecalhos, "Content-Type": desc.headers.get("content-type") ?? "application/octet-stream" },
        body: dados,
      });
      const copia = envio.ok ? await objeto(BUCKET_PRIVADO, p.destino) : null;
      if (!copia || copia.tamanho !== dados.length) {
        console.error(`  ✗ despesa(s) ${ids}: cópia para privado não confirmada (${envio.status}) — parado aqui, nada apagado.`);
        process.exit(1);
      }
    }

    // 2. Gravar o caminho — só se a despesa ainda apontar para o mesmo URL, para
    //    não pisar o que alguém tenha feito entretanto.
    for (const d of p.despesas) {
      const r = await fetch(
        `${URL_BASE}/rest/v1/despesa?id=eq.${d.id}&detalhe->>documento_url=eq.${encodeURIComponent(p.url)}`,
        {
          method: "PATCH",
          headers: { ...cabecalhos, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ detalhe: { ...d.detalhe, documento_url: p.destino } }),
        },
      );
      const linhas = r.ok ? await r.json() : [];
      if (linhas.length !== 1) {
        console.error(`  ✗ despesa ${d.id}: não consegui gravar o caminho (${r.status}) — parado aqui, o público fica como estava.`);
        process.exit(1);
      }
    }

    // 3. Só agora sai do público — e confirma-se que saiu da listagem.
    if (p.publico) {
      const apagar = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET_PUBLICO}/${codificar(p.origem)}`, {
        method: "DELETE",
        headers: cabecalhos,
      });
      if (!apagar.ok || (await objeto(BUCKET_PUBLICO, p.origem))) {
        console.error(`  ✗ despesa(s) ${ids}: caminho gravado, mas o ficheiro continua no público (${apagar.status}) — corre outra vez para o tirar.`);
        ficaramNoPublico++;
        continue;
      }
    }

    // 4. …e que o URL antigo, SEM credenciais, já não o serve (400/404). Não se desfaz
    //    nada na base: o caminho privado já é o certo, falta só o público deixar de abrir.
    const status = await statusSemLogin(p.origem);
    if (!saidaConfirmada(status)) {
      console.error(
        `  ✗ despesa(s) ${ids}: caminho gravado, mas o URL público antigo ainda responde ${status ?? "(sem resposta)"}` +
          `${status === 200 ? " — continua legível sem login (cache do CDN?)" : ""}.`,
      );
      ficaramNoPublico++;
      continue;
    }
    console.log(`  ✓ despesa(s) ${ids} → privado/${PASTA_INFRACOES}/`);
  }

  if (ficaramNoPublico) {
    console.error(
      `\n${ficaramNoPublico} ficheiro(s) com o caminho já gravado ainda não estão confirmados fora do bucket público — ` +
        "corre outra vez (a seco mostra o que falta; com --aplicar tira-os).",
    );
    process.exitCode = 1;
  }
  console.log('\nPara confirmar: corre outra vez a seco (sem --aplicar) e espera "Nada por fazer".');
}

// Importado pelos testes não corre (nem pede o .env.local).
// Compara os caminhos reais: corrido por um caminho com ligação simbólica também arranca.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
