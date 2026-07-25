import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatarPreco } from "@/lib/precos";

/**
 * Notificações DERIVADAS do estado (recalculadas, não são eventos pontuais).
 * Reconcilia o conjunto atual com o existente (não apaga-tudo-e-reinsere):
 *  - condição que deixou de aplicar → remove a notificação;
 *  - condição nova → insere 'nova';
 *  - condição que se mantém → PRESERVA a linha existente (mantém 'lida'; uma
 *    'feita' suprime o realerta enquanto a condição durar; se a condição cessar
 *    e voltar, realerta).
 * Assim o botão "Feito" é durável, "lida" não é desfeito, e uma falha do insert
 * nunca esvazia a caixa (só faltam os alertas novos). Best-effort — nunca lança.
 */
const DERIVADOS = [
  "contrato_sem_faturacao",
  "por_recolher",
  "kyc_incompleto",
  "cobranca_atraso",
];

interface NotifIns {
  tipo: string;
  titulo: string;
  detalhe: string | null;
  href: string | null;
  entidade: string | null;
  entidade_id: string | null;
}

export async function varrerDerivadas(): Promise<{ inseridas: number; removidas?: number; erro?: string }> {
  try {
    // Conjunto ATUAL das condições verdadeiras agora, por chave tipo|entidade_id.
    const atuais = new Map<string, NotifIns>();
    const add = (n: NotifIns) => atuais.set(`${n.tipo}|${n.entidade_id}`, n);

    // 1. Contrato ativo sem faturação iniciada (âncora por fixar).
    const { data: semFat } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("id, numero")
      .eq("estado", "ativo")
      .is("ancora_vencimento", null);
    for (const c of semFat ?? []) {
      add({
        tipo: "contrato_sem_faturacao",
        titulo: "Contrato ativo sem faturação",
        detalhe: `${c.numero} — fixar âncora e gerar cobranças`,
        href: "/admin/contratos",
        entidade: "contrato",
        entidade_id: c.id,
      });
    }

    // 2. À espera de recolha (pendente de fecho).
    const { data: pend } = await supabaseAdmin
      .from("contrato_aluguer")
      .select("id, numero")
      .eq("estado", "pendente_fecho");
    for (const c of pend ?? []) {
      add({
        tipo: "por_recolher",
        titulo: "Contrato à espera de recolha",
        detalhe: `${c.numero} — agendar/submeter a vistoria de recolha`,
        href: `/admin/contratos/${c.id}/recolha`,
        entidade: "contrato",
        entidade_id: c.id,
      });
    }

    // 3. Motorista ativo com KYC incompleto (sem NIF ou sem carta).
    const { data: kyc } = await supabaseAdmin
      .from("motorista")
      .select("id, nome, nif, carta_numero")
      .eq("estado", "ativo");
    for (const m of kyc ?? []) {
      if (!m.nif || !m.carta_numero) {
        add({
          tipo: "kyc_incompleto",
          titulo: "KYC incompleto num motorista ativo",
          detalhe: `${m.nome} — falta ${!m.nif ? "NIF" : ""}${!m.nif && !m.carta_numero ? " e " : ""}${!m.carta_numero ? "carta" : ""}`,
          href: "/admin/motoristas",
          entidade: "motorista",
          entidade_id: m.id,
        });
      }
    }

    // 4. Cobranças em atraso, agregadas por motorista (uma notificação cada).
    const { data: atras } = await supabaseAdmin
      .from("vw_cobranca_estado")
      .select("motorista_id, em_falta")
      .eq("em_atraso", true);
    const porMot = new Map<string, { n: number; total: number }>();
    for (const c of atras ?? []) {
      const k = c.motorista_id as string;
      const a = porMot.get(k) ?? { n: 0, total: 0 };
      a.n += 1;
      a.total += Number(c.em_falta);
      porMot.set(k, a);
    }
    if (porMot.size) {
      const { data: nomes } = await supabaseAdmin
        .from("motorista")
        .select("id, nome")
        .in("id", [...porMot.keys()]);
      const nomeDe = new Map((nomes ?? []).map((m) => [m.id, m.nome]));
      for (const [motId, a] of porMot) {
        add({
          tipo: "cobranca_atraso",
          titulo: "Cobrança em atraso",
          detalhe: `${nomeDe.get(motId) ?? "motorista"} — ${a.n} semana(s), ${formatarPreco(a.total)}`,
          href: "/admin/cobrancas",
          entidade: "motorista",
          entidade_id: motId,
        });
      }
    }

    // Reconcilia com o existente destes tipos (agrupado por chave).
    const { data: existentes } = await supabaseAdmin
      .from("notificacao")
      .select("id, tipo, entidade_id, estado")
      .in("tipo", DERIVADOS);
    const porChave = new Map<string, { id: string; estado: string }[]>();
    for (const e of existentes ?? []) {
      const k = `${e.tipo}|${e.entidade_id}`;
      const arr = porChave.get(k) ?? [];
      arr.push({ id: e.id as string, estado: e.estado as string });
      porChave.set(k, arr);
    }

    const remover: string[] = [];
    for (const [k, rows] of porChave) {
      if (atuais.has(k)) {
        // Condição mantém-se: guarda UMA linha (prefere 'feita', que suprime o
        // realerta) e limpa duplicados. Não reinsere (preserva 'lida').
        atuais.delete(k);
        const manter = rows.find((r) => r.estado === "feita") ?? rows[0];
        for (const r of rows) if (r.id !== manter.id) remover.push(r.id);
      } else {
        // Condição cessou: remove tudo (se voltar mais tarde, realerta de novo).
        for (const r of rows) remover.push(r.id);
      }
    }
    if (remover.length) {
      await supabaseAdmin.from("notificacao").delete().in("id", remover);
    }

    const novas = [...atuais.values()];
    if (novas.length) {
      const { error } = await supabaseAdmin.from("notificacao").insert(novas);
      if (error) {
        console.warn("varrerDerivadas insert:", error.message);
        return { inseridas: 0, removidas: remover.length, erro: error.message };
      }
    }
    return { inseridas: novas.length, removidas: remover.length };
  } catch (err) {
    console.warn("varrerDerivadas exception:", err);
    return { inseridas: 0, erro: String(err) };
  }
}
