#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Migração dos contratos de aluguer do Notion → contrato_aluguer.
//
//   node scripts/migrar_contratos.mjs --dir <pasta-csv> [--apply]
//
// Migra os 33 contratos (13 abertos como semente operacional + 20 concluídos
// como arquivo). NÃO gera cobranças — o início da faturação na plataforma é um
// passo deliberado, feito depois na interface (para não criar rendas do passado).
// Idempotente pelo import_notion_id (ALU-xx).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const CSV_DIR = args[args.indexOf("--dir") + 1];
if (!CSV_DIR || args.indexOf("--dir") < 0) {
  console.error("Falta --dir <pasta-csv>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Parser CSV (RFC-4180) ───────────────────────────────────────────────────
function parseCSV(texto) {
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  const s = texto.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (aspas) {
      if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = linhas.shift().map((h) => h.trim());
  return linhas.filter((l) => l.some((c) => c.trim() !== ""))
    .map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? "").trim()])));
}

const semUrl = (v) => (v ?? "").replace(/\s*\(https?:\/\/[^)]*\)/g, "").trim();
const parseEuro = (v) => { const n = parseFloat((v ?? "").replace(/[€\s]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// Correção de gralhas de matrícula conhecidas do Notion (OCR: I→1).
const ALIAS_MATRICULA = { "BJ45F1": "BJ45FI" };
const normMat = (m) => {
  const n = (m ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ALIAS_MATRICULA[n] ?? n;
};

const MESES = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
function parseData(v) {
  if (!v) return null;
  const t = v.trim();
  let m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) { const mes = MESES[m[1].toLowerCase()]; if (mes) return `${m[3]}-${String(mes).padStart(2,"0")}-${m[2].padStart(2,"0")}`; }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return null;
}

// Dia da semana (PT, com variantes) → ISO 1..7.
function diaISO(v) {
  const t = (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!t) return null;
  if (t.startsWith("segunda")) return 1;
  if (t.startsWith("terca")) return 2;
  if (t.startsWith("quarta")) return 3;
  if (t.startsWith("quinta")) return 4;
  if (t.startsWith("sexta")) return 5;
  if (t.startsWith("sabado")) return 6;
  if (t.startsWith("domingo")) return 7;
  return null;
}

const ESTADO = {
  "ativo": "ativo",
  "pendente de conclusão": "pendente_fecho",
  "pendente de conclusao": "pendente_fecho",
  "pendente": "pendente_fecho",
  "concluído": "concluido",
  "concluido": "concluido",
  "cancelado": "cancelado",
};

function acharCSV(prefixo) {
  const f = readdirSync(CSV_DIR).find((n) => n.toLowerCase().startsWith(prefixo.toLowerCase()) && n.endsWith("_all.csv"));
  return f ? parseCSV(readFileSync(join(CSV_DIR, f), "utf8")) : [];
}

async function main() {
  console.log(`\n=== MIGRAÇÃO DE CONTRATOS (${APPLY ? "APLICAR" : "SIMULAÇÃO"}) ===\n`);
  const alugueis = acharCSV("Aluguel");

  // Mapas de referência da BD.
  const [{ data: mots }, { data: motos }, { data: donos }] = await Promise.all([
    supabase.from("motorista").select("id, import_notion_id"),
    supabase.from("moto").select("id, matricula_norm, proprietario_id"),
    supabase.from("proprietario").select("id, nome"),
  ]);
  const mapMot = new Map((mots ?? []).filter((m) => m.import_notion_id).map((m) => [m.import_notion_id, m.id]));
  const mapMoto = new Map((motos ?? []).map((m) => [m.matricula_norm, m]));
  const mapDono = new Map((donos ?? []).map((d) => [d.nome, d.id]));

  let ok = 0, saltados = 0;
  const abertos = { ativo: 0, pendente_fecho: 0 };

  for (const r of alugueis) {
    const idAlu = (r["﻿Id_aluguel"] || r["Id_aluguel"] || "").trim();
    const estado = ESTADO[(r["Status"] || "").toLowerCase().trim()] ?? "concluido";
    const cli = semUrl(r["Informações Clientes"]).split(",")[0].trim();
    const motoristaId = mapMot.get(cli);
    const moto = mapMoto.get(normMat(r["Matricula"]));
    const preco = parseEuro(r["Price / weekly"]);
    const dataInicio = parseData(r["Start Date"]);

    // Requisitos mínimos: cliente, veículo, data de início e (nos abertos) preço.
    const problemas = [];
    if (!motoristaId) problemas.push(`cliente ${cli || "?"}`);
    if (!moto) problemas.push(`matrícula ${r["Matricula"] || "?"}`);
    if (!dataInicio) problemas.push("data início");
    if (estado !== "concluido" && preco == null) problemas.push("preço");

    if (problemas.length) {
      console.log(`  SALTA ${idAlu} (${estado}): falta ${problemas.join(", ")}`);
      saltados++;
      continue;
    }

    const donoNome = semUrl(r["Proprietário"]);
    const contrato = {
      motorista_id: motoristaId,
      veiculo_id: moto.id,
      proprietario_id: mapDono.get(donoNome) ?? moto.proprietario_id ?? null,
      periodicidade: "semanal",
      dia_vencimento: diaISO(r["Dia de pagamento"] || r["Dia do pagamento"]),
      preco_periodo: preco ?? 0,
      data_inicio: dataInicio,
      data_fim: parseData(r["End Date"]),
      km_inicio: parseInt((r["Km início"] || "").replace(/[^\d]/g, ""), 10) || null,
      km_fim: parseInt((r["Km final"] || "").replace(/[^\d]/g, ""), 10) || null,
      estado,
      contrato_assinado_url: r["Contrato assinado"] || null,
      observacoes: r["Observações"] || null,
      import_notion_id: idAlu,
      // ancora_vencimento deixado a null de propósito: a faturação começa depois,
      // na interface, para não gerar rendas do passado.
    };

    const dia = contrato.dia_vencimento ? ["","2ª","3ª","4ª","5ª","6ª","Sáb","Dom"][contrato.dia_vencimento] : "—";
    console.log(`  ${idAlu.padEnd(7)} ${estado.padEnd(14)} ${cli.padEnd(7)} ${r["Matricula"].padEnd(10)} €${(preco??0)}/sem ${dia} ini=${dataInicio}`);

    if (estado !== "concluido") abertos[estado] = (abertos[estado] ?? 0) + 1;

    if (APPLY) {
      const { data: existe } = await supabase.from("contrato_aluguer").select("id").eq("import_notion_id", idAlu).maybeSingle();
      if (existe) { await supabase.from("contrato_aluguer").update(contrato).eq("id", existe.id); }
      else { const { error } = await supabase.from("contrato_aluguer").insert(contrato); if (error) { console.error("   ERRO:", error.message); continue; } }
    }
    ok++;
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`  Contratos migrados: ${ok}  (abertos: ${abertos.ativo || 0} ativos + ${abertos.pendente_fecho || 0} pendentes)`);
  console.log(`  Saltados (dados em falta): ${saltados}`);
  console.log(APPLY ? "\n✓ APLICADO. Faturação NÃO iniciada (definir âncora e gerar na interface)." : "\n(simulação — usa --apply para gravar)");
}

main().catch((e) => { console.error(e); process.exit(1); });
