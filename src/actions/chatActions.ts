"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { geminiConfigurado, gerarJsonTexto, gerarTextoGemini } from "@/lib/gemini";
import { encontrarMatricula } from "@/lib/matriculas";
import { quemTinhaAMoto } from "@/actions/intakeActions";
import type { DespesaCategoria } from "@/types/db";

/**
 * Assistente de perguntas (chat) sobre os dados da frota. Arquitetura em 3 passos
 * (robusta com o Gemini, sem protocolo de function-calling): (1) o PLANEADOR
 * escolhe a ferramenta e os argumentos a partir da pergunta; (2) executamos a
 * ferramenta (query só de LEITURA ao Supabase); (3) o Gemini REDIGE a resposta a
 * partir dos dados. Só leitura — nunca escreve. Admin-gated.
 */

// Catálogo de ferramentas (mostrado ao planeador).
const FERRAMENTAS = [
  { nome: "seguros_a_expirar", descricao: "Lista os seguros/apólices a expirar. args: { dias?: number (horizonte em dias, default 60) }" },
  { nome: "manutencao_a_vencer", descricao: "Motos que precisam de manutenção/revisão/pneu em breve. args: {}" },
  { nome: "quem_tinha_a_moto", descricao: "Que motorista tinha uma moto numa data. args: { matricula: string, data: string AAAA-MM-DD }" },
  { nome: "divida_motorista", descricao: "Quanto um motorista específico deve (cobranças em atraso). args: { nome: string }" },
  { nome: "total_em_atraso", descricao: "Valor TOTAL em atraso (todas as cobranças vencidas por pagar) e nº de motoristas. args: {}" },
  { nome: "quem_nao_pagou", descricao: "Lista de motoristas com cobranças em atraso e quanto cada um deve. args: {}" },
  { nome: "receita_esperada_semana", descricao: "Receita de renda esperada nos próximos 7 dias (esperado, já recebido, por receber). args: { dias?: number (default 7) }" },
  { nome: "despesas_recentes", descricao: "Total de despesas por categoria num período. args: { categoria?: 'manutencao'|'portagem'|'coima'|'seguro'|'gps'|'outro', meses?: number (default 1) }" },
] as const;

type Args = Record<string, unknown>;

async function seguros_a_expirar(args: Args) {
  const dias = Number(args.dias ?? 60);
  const { data } = await supabaseAdmin
    .from("vw_seguro_estado")
    .select("veiculo_id, seguradora, data_fim, dias_para_expirar, estado")
    .eq("estado", "ativa");
  // Apólice ativa mais recente por veículo.
  const atual = new Map<string, { seguradora: string | null; data_fim: string; dias: number }>();
  for (const s of data ?? []) {
    const vid = s.veiculo_id as string;
    const cur = atual.get(vid);
    if (!cur || (s.data_fim as string) > cur.data_fim)
      atual.set(vid, { seguradora: (s.seguradora as string) ?? null, data_fim: s.data_fim as string, dias: Number(s.dias_para_expirar) });
  }
  const vids = [...atual.keys()];
  const { data: motos } = vids.length
    ? await supabaseAdmin.from("moto").select("id, matricula").in("id", vids)
    : { data: [] };
  const mat = new Map((motos ?? []).map((m) => [m.id as string, m.matricula as string]));
  return [...atual.entries()]
    .filter(([, s]) => s.dias <= dias)
    .sort((a, b) => a[1].dias - b[1].dias)
    .map(([vid, s]) => ({ matricula: mat.get(vid) ?? "?", seguradora: s.seguradora, valido_ate: s.data_fim, dias_para_expirar: s.dias }));
}

async function manutencao_a_vencer() {
  const { data } = await supabaseAdmin
    .from("vw_manutencao_proxima")
    .select("matricula, tipo, km_em_falta, dias_em_falta, proxima_km, proxima_data");
  return (data ?? [])
    .filter((m) => (m.km_em_falta != null && Number(m.km_em_falta) <= 500) || (m.dias_em_falta != null && Number(m.dias_em_falta) <= 30))
    .map((m) => ({ matricula: m.matricula, tipo: m.tipo, km_em_falta: m.km_em_falta, dias_em_falta: m.dias_em_falta, proxima_km: m.proxima_km, proxima_data: m.proxima_data }));
}

async function quem_tinha_a_moto(args: Args) {
  const matricula = String(args.matricula ?? "");
  const data = String(args.data ?? "");
  if (!matricula || !data) return { erro: "Preciso da matrícula e da data." };
  const { data: motos } = await supabaseAdmin.from("moto").select("id, matricula, matricula_norm, modelo");
  const match = encontrarMatricula(matricula, motos ?? []);
  if (!match) return { erro: `Não encontrei a moto "${matricula}" na frota.` };
  const mot = await quemTinhaAMoto(match.candidato.id, data);
  const m = (motos ?? []).find((x) => x.id === match.candidato.id);
  if (!mot) return { erro: `Não há registo de quem tinha a ${m?.matricula ?? matricula} em ${data}.` };
  return { matricula: m?.matricula ?? matricula, data, motorista: mot.nome, telefone: mot.telefone_e164 };
}

async function divida_motorista(args: Args) {
  const nome = String(args.nome ?? "").trim();
  if (!nome) return { erro: "Preciso do nome do motorista." };
  const { data: mots } = await supabaseAdmin.from("motorista").select("id, nome").ilike("nome", `%${nome}%`).limit(5);
  if (!mots?.length) return { erro: `Não encontrei nenhum motorista com "${nome}".` };
  const resultados = [];
  for (const m of mots) {
    const { data: cobs } = await supabaseAdmin
      .from("vw_cobranca_estado")
      .select("em_falta")
      .eq("motorista_id", m.id)
      .eq("em_atraso", true)
      .neq("tipo", "caucao");
    const total = (cobs ?? []).reduce((s, c) => s + Number(c.em_falta), 0);
    resultados.push({ nome: m.nome, semanas_em_atraso: cobs?.length ?? 0, total_em_divida: total.toFixed(2) });
  }
  return resultados;
}

async function total_em_atraso() {
  const { data } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("motorista_id, em_falta")
    .eq("em_atraso", true)
    .neq("tipo", "caucao");
  const total = (data ?? []).reduce((s, c) => s + Number(c.em_falta), 0);
  const motoristas = new Set((data ?? []).map((c) => c.motorista_id));
  return { total_em_atraso: total.toFixed(2), cobrancas_vencidas: data?.length ?? 0, motoristas_em_divida: motoristas.size };
}

async function quem_nao_pagou() {
  const { data } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("motorista_id, em_falta")
    .eq("em_atraso", true)
    .neq("tipo", "caucao");
  const porMot = new Map<string, { total: number; n: number }>();
  for (const c of data ?? []) {
    const k = c.motorista_id as string;
    const a = porMot.get(k) ?? { total: 0, n: 0 };
    a.total += Number(c.em_falta);
    a.n += 1;
    porMot.set(k, a);
  }
  if (!porMot.size) return [];
  const { data: nomes } = await supabaseAdmin.from("motorista").select("id, nome").in("id", [...porMot.keys()]);
  const nomeDe = new Map((nomes ?? []).map((m) => [m.id, m.nome]));
  return [...porMot.entries()]
    .map(([id, a]) => ({ nome: nomeDe.get(id) ?? "?", total_em_divida: a.total.toFixed(2), semanas_em_atraso: a.n }))
    .sort((a, b) => Number(b.total_em_divida) - Number(a.total_em_divida));
}

async function receita_esperada_semana(args: Args) {
  const dias = Math.max(1, Number(args.dias ?? 7));
  const hoje = new Date().toISOString().slice(0, 10);
  const ate = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("valor_devido, em_falta")
    .eq("tipo", "renda")
    .gte("data_vencimento", hoje)
    .lte("data_vencimento", ate);
  const esperado = (data ?? []).reduce((s, c) => s + Number(c.valor_devido), 0);
  const falta = (data ?? []).reduce((s, c) => s + Number(c.em_falta), 0);
  return {
    periodo: `${hoje} a ${ate}`,
    cobrancas: data?.length ?? 0,
    receita_esperada: esperado.toFixed(2),
    ja_recebido: (esperado - falta).toFixed(2),
    por_receber: falta.toFixed(2),
  };
}

async function despesas_recentes(args: Args) {
  const meses = Math.max(1, Number(args.meses ?? 1));
  const categoria = args.categoria ? String(args.categoria) : null;
  const desde = new Date(Date.now() - meses * 30 * 86400000).toISOString().slice(0, 10);
  let q = supabaseAdmin.from("despesa").select("categoria, valor_total, data_despesa").gte("data_despesa", desde);
  if (categoria) q = q.eq("categoria", categoria as DespesaCategoria);
  const { data } = await q;
  const porCat = new Map<string, { total: number; n: number }>();
  for (const d of data ?? []) {
    const a = porCat.get(d.categoria as string) ?? { total: 0, n: 0 };
    a.total += Number(d.valor_total);
    a.n += 1;
    porCat.set(d.categoria as string, a);
  }
  return { desde, por_categoria: [...porCat.entries()].map(([cat, a]) => ({ categoria: cat, total: a.total.toFixed(2), n: a.n })) };
}

async function executar(nome: string, args: Args): Promise<unknown> {
  switch (nome) {
    case "seguros_a_expirar": return seguros_a_expirar(args);
    case "manutencao_a_vencer": return manutencao_a_vencer();
    case "quem_tinha_a_moto": return quem_tinha_a_moto(args);
    case "divida_motorista": return divida_motorista(args);
    case "total_em_atraso": return total_em_atraso();
    case "quem_nao_pagou": return quem_nao_pagou();
    case "receita_esperada_semana": return receita_esperada_semana(args);
    case "despesas_recentes": return despesas_recentes(args);
    default: return null;
  }
}

export interface RespostaChat {
  resposta: string;
  ferramenta?: string | null;
}

export async function perguntar(pergunta: string): Promise<{ success: boolean; dados?: RespostaChat; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!geminiConfigurado()) return { success: false, error: "A IA (Gemini) não está configurada neste ambiente." };
  const p = pergunta.trim();
  if (!p) return { success: false, error: "Escreve uma pergunta." };

  const hoje = new Date().toISOString().slice(0, 10);

  // Passo 1 — planeador: escolhe a ferramenta e os argumentos.
  const planoPrompt = `És o planeador de um assistente da GoScooters (gestão de frota de scooters em Lisboa). Hoje é ${hoje}.
Dada a pergunta do gestor, escolhe UMA ferramenta e os seus argumentos, ou "nenhuma" se não der para responder com os dados.
Ferramentas:
${FERRAMENTAS.map((f) => `- ${f.nome}: ${f.descricao}`).join("\n")}
Devolve só JSON: { "ferramenta": "<nome>"|"nenhuma", "args": { ... } }
Pergunta: ${p}`;
  const plano = (await gerarJsonTexto(planoPrompt)) as { ferramenta?: string; args?: Args } | null;
  const ferramenta = plano?.ferramenta && plano.ferramenta !== "nenhuma" ? plano.ferramenta : null;

  // Passo 2 — executa (se houver ferramenta).
  const dados = ferramenta ? await executar(ferramenta, plano?.args ?? {}) : null;

  // Passo 3 — redige a resposta a partir dos dados.
  const respPrompt = `És o assistente da GoScooters. Responde à pergunta do gestor em português, de forma directa e concisa, SÓ com base nos dados fornecidos. Se os dados estiverem vazios ou não responderem, diz isso claramente (não inventes). Formata valores em euros e datas de forma legível. Hoje é ${hoje}.
Pergunta: ${p}
${ferramenta ? `Dados (da ferramenta ${ferramenta}):\n${JSON.stringify(dados)}` : "Não havia nenhuma ferramenta adequada para esta pergunta — explica que só consegues responder sobre seguros a expirar, manutenção a vencer, quem tinha uma moto numa data, dívidas de motoristas e despesas recentes."}`;
  const resposta = await gerarTextoGemini(respPrompt);
  if (!resposta) return { success: false, error: "Não consegui gerar a resposta." };

  return { success: true, dados: { resposta, ferramenta } };
}
