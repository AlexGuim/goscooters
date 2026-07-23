#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Migração Fase 1 — Frota + Clientes do Notion para o Supabase.
//
// Uso:
//   node scripts/migrar_fase1.mjs --dir <pasta-com-csv> [--dry-run] [--apply]
//
// --dry-run (por omissão): mostra o que seria importado, não escreve nada.
// --apply: escreve mesmo. Idempotente (reconhece o que já foi importado pelo
//          import_notion_id / matricula_norm).
//
// Requer no .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── Argumentos ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const dirIdx = args.indexOf("--dir");
const CSV_DIR = dirIdx >= 0 ? args[dirIdx + 1] : null;
if (!CSV_DIR) {
  console.error("Falta --dir <pasta-com-csv>");
  process.exit(1);
}

// ── Credenciais (do .env.local) ─────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ── Parser CSV (RFC-4180: aspas, vírgulas e newlines dentro de aspas) ───────
function parseCSV(texto) {
  const linhas = [];
  let campo = "";
  let linha = [];
  let dentroAspas = false;
  const s = texto.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (dentroAspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += c;
    } else if (c === '"') dentroAspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = linhas.shift().map((h) => h.trim());
  return linhas
    .filter((l) => l.some((c) => c.trim() !== ""))
    .map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? "").trim()])));
}

function acharCSV(prefixo) {
  const f = readdirSync(CSV_DIR).find(
    (n) => n.toLowerCase().startsWith(prefixo.toLowerCase()) && n.endsWith("_all.csv"),
  );
  return f ? parseCSV(readFileSync(join(CSV_DIR, f), "utf8")) : [];
}

// ── Saneamento ──────────────────────────────────────────────────────────────
// Notion grava links como "Nome (https://...)". Tira o URL.
const semUrl = (v) => (v ?? "").replace(/\s*\(https?:\/\/[^)]*\)/g, "").trim();

const parseEuro = (v) => {
  const n = parseFloat((v ?? "").replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const parseInteiro = (v) => {
  const n = parseInt((v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
// "June 14, 2025" / "12/04/2025" → YYYY-MM-DD
const MESES = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
function parseData(v) {
  if (!v) return null;
  const t = v.trim();
  let m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) { const mes = MESES[m[1].toLowerCase()]; if (mes) return `${m[3]}-${String(mes).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`; }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  return null;
}

// Telefone → E.164. Devolve {e164, digitos, incerto}.
function toE164(bruto) {
  if (!bruto) return { e164: null, digitos: "", incerto: true };
  const tinhaMais = bruto.trim().startsWith("+") || bruto.includes("00");
  let d = bruto.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  // Normaliza dígitos "nacionais" (retira 351 à cabeça para reconhecimento).
  let digitos = d;
  if (digitos.startsWith("351") && digitos.length > 9) digitos = digitos.slice(3);
  // E.164
  if (d.length === 9 && /^[92]/.test(d)) return { e164: `+351${d}`, digitos, incerto: false };
  if (d.startsWith("351") && d.length === 12) return { e164: `+${d}`, digitos, incerto: false };
  if (tinhaMais && d.length >= 8) return { e164: `+${d}`, digitos, incerto: false };
  if (d.length > 9) return { e164: `+${d}`, digitos, incerto: true };
  return { e164: null, digitos, incerto: true };
}

// Nacionalidade → ISO 3166-1 alpha-2.
const PAIS = {
  brasileiro:"BR", brasil:"BR", brazil:"BR",
  indiano:"IN", india:"IN", "índia":"IN", "índia ":"IN",
  "lahore pak":"PK", paquistao:"PK", "paquistão":"PK", pakistan:"PK", pak:"PK",
  tunisia:"TN", "tunísia":"TN", tunisino:"TN",
  italiano:"IT", italia:"IT", "itália":"IT",
  portugues:"PT", "português":"PT", portugal:"PT",
  bangladesh:"BD", blangadesh:"BD", bengali:"BD",
  nepal:"NP", nepales:"NP",
};
const mapPais = (v) => PAIS[(v ?? "").trim().toLowerCase()] ?? null;

// NIF PT (9 dígitos, checksum mod-11).
function nifValido(v) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 9) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(d[i]) * (9 - i);
  const c = 11 - (soma % 11);
  const check = c >= 10 ? 0 : c;
  return check === Number(d[8]);
}

const PLACEHOLDERS = ["i am nobody","je driver","love","harhar","araf old man","je","test","teste"];
const ehPlaceholder = (nome) => PLACEHOLDERS.includes((nome ?? "").trim().toLowerCase());

// Comissão: 25% base para parceiros geridos; as 3 motos pioneiras do Felipe a
// 20% (override por veículo). A 4.ª do Felipe (CJ-87-CI, no catálogo) fica a 25%.
const COMISSAO_BASE = 25;
const PIONEIRAS_20 = new Set(["BJ74FH", "BJ45FI", "BQ93QO"]);
const CJ_FELIPE_NORM = "CJ87CI";
const normMat = (m) => (m ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n=== MIGRAÇÃO FASE 1 (${APPLY ? "APLICAR" : "SIMULAÇÃO"}) ===\n`);

  const frota = acharCSV("Frota");
  const clientes = acharCSV("Cliente");
  console.log(`Lidos: ${frota.length} veículos, ${clientes.length} clientes\n`);

  // ── 1. Proprietários ──────────────────────────────────────────────────────
  const nomesDonos = [...new Set(frota.map((r) => semUrl(r["Proprietário"])).filter(Boolean))];
  console.log("── PROPRIETÁRIOS ──");
  const donoId = {};
  for (const nome of nomesDonos) {
    const ehGo = nome.toLowerCase().includes("alexandre");
    console.log(`  ${nome}${ehGo ? "  [frota própria GoScooters]" : "  [parceiro · comissão %]"}`);
    if (APPLY) {
      const { data: existe } = await supabase.from("proprietario").select("id").eq("nome", nome).maybeSingle();
      if (existe) { donoId[nome] = existe.id; continue; }
      const { data, error } = await supabase.from("proprietario").insert({
        nome, eh_goscooters: ehGo,
        comissao_modelo: "percentagem",
        comissao_valor: ehGo ? null : COMISSAO_BASE, // 25% base (frota própria: N/A)
      }).select("id").single();
      if (error) { console.error("   ERRO:", error.message); continue; }
      donoId[nome] = data.id;
    }
  }

  // ── 2. Veículos ───────────────────────────────────────────────────────────
  console.log("\n── VEÍCULOS ──");
  const mapEstado = { ocupada:"ocupado", "disponível":"disponivel", disponivel:"disponivel", inativa:"inativo", "manutenção":"manutencao" };
  for (const r of frota) {
    const matricula = (r["Matrícula"] || "").trim();
    if (!matricula) { console.log(`  (sem matrícula, ignorado: ${r["Id_moto"]})`); continue; }
    const tipo = (r["Tipo de Veículo"] || "").toLowerCase() === "carro" ? "carro" : "moto";
    const estadoOp = mapEstado[(r["Status da moto"] || "").toLowerCase()] ?? "disponivel";
    const dono = semUrl(r["Proprietário"]);
    const override = PIONEIRAS_20.has(normMat(matricula)) ? 20 : null;
    const v = {
      matricula,
      comissao_valor_override: override,
      modelo: r["Modelo"] || null,
      marca: r["Marca"] || null,
      ano: parseInteiro(r["Ano"]),
      cor: r["Cor"] || null,
      tipo_veiculo: tipo,
      nome_interno: (r["Nome "] || r["Id_moto"] || "").trim() || null,
      km_atual: parseInteiro(r["Kms atualizado"]),
      km_atual_em: parseData(r["Data da Km"]),
      data_aquisicao: parseData(r["Data de aquisição"]),
      preco_semana: parseEuro(r["Price per week"]),
      preco_dia: parseEuro(r["Daily price"]),
      estado_operacional: estadoOp,
      estado: "disponivel",
      ativo: false, // não publicar no catálogo automaticamente
      proprietario_id: donoId[dono] ?? null,
      import_notion_id: r["Id_moto"] || null,
    };
    console.log(`  ${matricula.padEnd(10)} ${tipo.padEnd(5)} ${(r["Marca"]||"")} ${(r["Modelo"]||"")} · ${estadoOp} · ${dono.split(" ")[0]} · €${v.preco_semana ?? "?"}/sem · ${override ? "20%" : "25%"} · ${v.km_atual ?? "?"}km`);
    if (APPLY) {
      const norm = matricula.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const { data: existe } = await supabase.from("moto").select("id").eq("matricula_norm", norm).maybeSingle();
      if (existe) { await supabase.from("moto").update(v).eq("id", existe.id); }
      else { const { error } = await supabase.from("moto").insert(v); if (error) console.error("   ERRO:", error.message); }
    }
  }

  // ── 2b. CJ-87-CI (no catálogo) é a 4.ª mota do Felipe, a 25% ──────────────
  const felipeNome = nomesDonos.find((n) => n.toLowerCase().includes("felipe"));
  console.log(`\n── CJ-87-CI → ${felipeNome || "Felipe"} (25%, sem override) ──`);
  if (APPLY && felipeNome && donoId[felipeNome]) {
    const { data: cj } = await supabase.from("moto").select("id").eq("matricula_norm", CJ_FELIPE_NORM).maybeSingle();
    if (cj) {
      await supabase.from("moto").update({
        proprietario_id: donoId[felipeNome],
        tipo_veiculo: "moto",
        comissao_valor_override: null, // usa os 25% base do Felipe
      }).eq("id", cj.id);
      console.log("  ✓ CJ-87-CI vinculada ao Felipe");
    } else console.log("  (CJ-87-CI não encontrada no catálogo)");
  }

  // ── 3. Clientes/Motoristas ────────────────────────────────────────────────
  console.log("\n── MOTORISTAS ──");
  let importados = 0, quarentena = 0, ignorados = 0;
  for (const r of clientes) {
    const nome = (r["Nome"] || "").trim();
    const idCli = (r["ID_Cliente"] || "").trim();
    if (!nome && !r["Phone Number"]) { ignorados++; continue; } // linha vazia
    const { e164, digitos, incerto } = toE164(r["Phone Number"]);
    const placeholder = ehPlaceholder(nome);
    const semTelefone = !e164;
    const revisao = placeholder || semTelefone || incerto || !nome;
    const m = {
      nome: nome || "(sem nome)",
      telefone: (r["Phone Number"] || "").trim() || "—",
      telefone_digitos: digitos,
      telefone_e164: e164,
      email: r["Contact Email"] || null,
      nif: r["NIF"] || null,
      nif_valido: r["NIF"] ? nifValido(r["NIF"]) : null,
      pais_iso: mapPais(r["Nacionalidade"]),
      morada_linha1: r["Adress"] || null,
      estado: (r["Status"] || "").toLowerCase() === "ativo" ? "ativo" : "inativo",
      origem: "importado",
      doc_urls: r["Link docs"] ? [r["Link docs"]] : null,
      notas: r["Observações"] || null,
      precisa_revisao: revisao,
      import_notion_id: idCli || null,
    };
    if (revisao) quarentena++; else importados++;
    const flag = placeholder ? "⚠placeholder" : semTelefone ? "⚠sem-tel" : incerto ? "⚠tel-incerto" : "";
    console.log(`  ${idCli.padEnd(7)} ${nome.slice(0,22).padEnd(22)} ${(e164||r["Phone Number"]||"").padEnd(16)} ${m.pais_iso||"--"} ${m.estado.padEnd(7)} ${flag}`);
    if (APPLY) {
      if (idCli) {
        const { data: existe } = await supabase.from("motorista").select("id").eq("import_notion_id", idCli).maybeSingle();
        if (existe) { await supabase.from("motorista").update(m).eq("id", existe.id); continue; }
      }
      const { error } = await supabase.from("motorista").insert(m);
      if (error) console.error("   ERRO:", error.message);
    }
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`  Proprietários: ${nomesDonos.length}`);
  console.log(`  Veículos: ${frota.filter((r)=>r["Matrícula"]).length}`);
  console.log(`  Motoristas: ${importados} ok + ${quarentena} p/ revisão + ${ignorados} ignorados (vazios)`);
  console.log(APPLY ? "\n✓ APLICADO." : "\n(simulação — nada foi escrito; usa --apply para gravar)");
}

main().catch((e) => { console.error(e); process.exit(1); });
