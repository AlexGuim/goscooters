#!/usr/bin/env node
/**
 * Põe o estado das motas de acordo com os contratos.
 *
 * A mota tem dois planos de estado (ver src/lib/motaEstado.ts): `estado_operacional`
 * (o que a operação vê) e `estado` (o que o site público mostra). Quem os escreve são
 * as transições de contrato — ativar, concluir, cancelar, recolher. Só que nem todo o
 * histórico passou por lá: os contratos importados do Notion nasceram "concluido" sem
 * nunca chamar `libertarMota`, e as motas deles ficaram "ocupado" para sempre. O
 * sintoma é o passo 2 do "Criar aluguer" não oferecer uma mota que está livre.
 *
 * A regra é a mesma da aplicação: ocupa a mota quem tem contrato ativo, pendente de
 * fecho ou suspenso. Sem nenhum desses, a mota está livre.
 *
 * NÃO toca em motas em `manutencao` nem `inativo` (nem no catálogo `manutencao`): esse
 * estado é uma decisão humana — avaria, vendida, parada — que nenhum contrato conhece.
 * E nunca mexe na flag `ativo` (publicação no site).
 *
 * Uso:
 *   node scripts/reconciliar-motas.mjs              # só mostra o que mudaria
 *   node scripts/reconciliar-motas.mjs --aplicar    # aplica
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

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      "Content-Type": "application/json",
      ...(opcoes.headers ?? {}),
    },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${texto}`);
  return texto ? JSON.parse(texto) : null;
}

/** Os estados de contrato que prendem uma mota. */
const OCUPAM = ["ativo", "pendente_fecho", "suspenso"];
/** Estados que são decisão humana — a reconciliação não lhes toca. */
const CONGELADOS = ["manutencao", "inativo"];

const motos = await api("moto?select=id,matricula,modelo,estado_operacional,estado&order=matricula");
const contratos = await api(
  `contrato_aluguer?select=numero,estado,veiculo_id&estado=in.(${OCUPAM.join(",")})`,
);

const mudancas = [];
const porRever = [];
for (const m of motos) {
  if (CONGELADOS.includes(m.estado_operacional) || m.estado === "manutencao") continue;

  const contrato = contratos.find((c) => c.veiculo_id === m.id);
  const ocupadaNaFicha = m.estado_operacional === "ocupado" || m.estado === "alugada";

  // Mota presa sem contrato nenhum a reclamá-la: liberta-se com segurança. É o
  // resto que a importação do Notion deixou para trás — contratos que nasceram
  // "concluido" sem nunca passar pelo fluxo que chama `libertarMota`.
  if (!contrato && ocupadaNaFicha) {
    mudancas.push({
      id: m.id,
      matricula: m.matricula ?? "(sem matrícula)",
      de: `${m.estado_operacional}/${m.estado}`,
      para: "disponivel/disponivel",
      porque: "sem contrato a ocupá-la",
      campos: { estado_operacional: "disponivel", estado: "disponivel" },
    });
    continue;
  }

  // O caso inverso NÃO se corrige às cegas. Uma mota livre com um contrato
  // "ativo" quer dizer que um dos dois está errado — e a experiência diz que
  // costuma ser o CONTRATO (aluguer que acabou e ninguém fechou), não a mota.
  // Marcá-la como ocupada esconderia uma mota que está mesmo livre e daria a
  // divergência por resolvida. Fica para decisão humana.
  if (contrato && !ocupadaNaFicha) {
    porRever.push({ matricula: m.matricula ?? "(sem matrícula)", contrato });
  }
}

console.log(`${motos.length} motas, ${contratos.length} contratos a ocupar.\n`);

for (const c of mudancas) {
  console.log(`${c.matricula.padEnd(10)} ${c.de.padEnd(22)} → ${c.para.padEnd(22)} ${c.porque}`);
}

if (porRever.length) {
  console.log(`\nPor rever à mão (não se corrigem sozinhas):`);
  for (const r of porRever) {
    console.log(
      `  ${r.matricula.padEnd(10)} está livre mas o contrato ${r.contrato.numero} está "${r.contrato.estado}"` +
        ` — se o aluguer acabou, fecha o contrato (isso liberta a mota); se não acabou, a mota devia estar ocupada.`,
    );
  }
}

if (!mudancas.length) {
  console.log("\nNenhuma mota presa sem contrato — nada a gravar.");
  process.exit(0);
}

if (!aplicar) {
  console.log(`\n${mudancas.length} mota(s) por corrigir. Corre outra vez com --aplicar para gravar.`);
  process.exit(0);
}

for (const c of mudancas) {
  await api(`moto?id=eq.${c.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(c.campos),
  });
  console.log(`✓ ${c.matricula} → ${c.para}`);
}
console.log(`\n${mudancas.length} mota(s) corrigida(s).`);
