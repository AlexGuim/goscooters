import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { formatarPreco } from "@/lib/precos";
import { kycCompleto } from "@/lib/kyc";
import { textoLembrete } from "@/lib/lembretes";

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
  "seguro_a_expirar",
  "manutencao_a_vencer",
  "doc_motorista_a_expirar",
  "pagamento_a_comunicar",
];

// Horizontes dos alertas proativos (dias / km). Sensatos por omissão.
const DIAS_ALERTA = 30;
const KM_ALERTA = 500;

const ROTULO_MANUT: Record<string, string> = {
  revisao: "revisão", oleo: "óleo", pneu_frente: "pneu (frente)", pneu_tras: "pneu (trás)",
  pneus: "pneus", travoes: "travões", corrente: "corrente", inspecao: "inspeção", outro: "outro",
};
const rotuloManut = (t: string) => ROTULO_MANUT[t] ?? t;

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

    // 3. Motorista ativo com KYC incompleto (definição única: ver src/lib/kyc.ts).
    const { data: kyc } = await supabaseAdmin
      .from("motorista")
      .select("id, nome, nif, nif_valido, doc_id_numero, carta_numero, morada_linha1")
      .eq("estado", "ativo");
    for (const m of kyc ?? []) {
      const { completo, faltam } = kycCompleto(m);
      if (!completo) {
        add({
          tipo: "kyc_incompleto",
          titulo: "Identidade incompleta (motorista ativo)",
          detalhe: `${m.nome} — falta ${faltam.join(", ")}`,
          href: `/admin/motoristas?m=${m.id}`,
          entidade: "motorista",
          entidade_id: m.id,
        });
      }
    }

    // 4. Cobranças em atraso, agregadas por motorista (uma notificação cada).
    const { data: atras } = await supabaseAdmin
      .from("vw_cobranca_estado")
      .select("motorista_id, em_falta")
      .eq("em_atraso", true)
      // A caução não é uma "semana de renda em atraso" (é cobrada em mão na
      // entrega) — não a contar como dívida vencida. Renda e extras mantêm-se.
      .neq("tipo", "caucao");
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

    // ── Alertas proativos (frota) ────────────────────────────────────────────
    // Mapa de matrículas para as mensagens dos alertas de veículo.
    const { data: motosMat } = await supabaseAdmin.from("moto").select("id, matricula");
    const matriculaDe = new Map((motosMat ?? []).map((m) => [m.id as string, (m.matricula as string) ?? "?"]));

    // 5. Seguro a expirar (por veículo: a apólice ATIVA mais recente, ≤ 30 dias).
    const { data: segs } = await supabaseAdmin
      .from("vw_seguro_estado")
      .select("veiculo_id, seguradora, data_fim, dias_para_expirar, estado")
      .eq("estado", "ativa");
    const segAtual = new Map<string, { seguradora: string | null; data_fim: string; dias: number }>();
    for (const s of segs ?? []) {
      const vid = s.veiculo_id as string;
      const cur = segAtual.get(vid);
      if (!cur || (s.data_fim as string) > cur.data_fim) {
        segAtual.set(vid, {
          seguradora: (s.seguradora as string) ?? null,
          data_fim: s.data_fim as string,
          dias: Number(s.dias_para_expirar),
        });
      }
    }
    for (const [vid, s] of segAtual) {
      if (s.dias <= DIAS_ALERTA) {
        add({
          tipo: "seguro_a_expirar",
          titulo: "Seguro a expirar",
          detalhe: `${matriculaDe.get(vid) ?? "moto"} — ${s.dias < 0 ? `expirou há ${-s.dias} dia(s)` : `expira em ${s.dias} dia(s)`}${s.seguradora ? ` (${s.seguradora})` : ""}`,
          href: "/admin/motas",
          entidade: "moto",
          entidade_id: vid,
        });
      }
    }

    // 6. Manutenção/pneu a vencer (por veículo, agregando os tipos em falta).
    const { data: manut } = await supabaseAdmin
      .from("vw_manutencao_proxima")
      .select("veiculo_id, tipo, matricula, km_em_falta, dias_em_falta");
    const manutPorMoto = new Map<string, { matricula: string; itens: string[] }>();
    for (const m of manut ?? []) {
      const km = m.km_em_falta != null ? Number(m.km_em_falta) : null;
      const dias = m.dias_em_falta != null ? Number(m.dias_em_falta) : null;
      const kmDue = km != null && km <= KM_ALERTA;
      const dataDue = dias != null && dias <= DIAS_ALERTA;
      if (!kmDue && !dataDue) continue;
      const vid = m.veiculo_id as string;
      const g = manutPorMoto.get(vid) ?? { matricula: (m.matricula as string) ?? matriculaDe.get(vid) ?? "moto", itens: [] };
      const partes: string[] = [];
      if (kmDue) partes.push(km! <= 0 ? `${-km!} km passados` : `faltam ${km} km`);
      if (dataDue) partes.push(dias! < 0 ? `atrasada ${-dias!} d` : `em ${dias} d`);
      g.itens.push(`${rotuloManut(m.tipo as string)} (${partes.join(", ")})`);
      manutPorMoto.set(vid, g);
    }
    for (const [vid, g] of manutPorMoto) {
      add({
        tipo: "manutencao_a_vencer",
        titulo: "Manutenção a vencer",
        detalhe: `${g.matricula} — ${g.itens.join(" · ")}`,
        href: "/admin/motas",
        entidade: "moto",
        entidade_id: vid,
      });
    }

    // 7. Documento do motorista a expirar (identidade ou carta) ≤ 30 dias.
    const horizonte = new Date(Date.now() + DIAS_ALERTA * 86400000).toISOString().slice(0, 10);
    const { data: docsMot } = await supabaseAdmin
      .from("motorista")
      .select("id, nome, doc_id_validade, carta_validade")
      .eq("estado", "ativo")
      .or(`doc_id_validade.lte.${horizonte},carta_validade.lte.${horizonte}`);
    for (const m of docsMot ?? []) {
      const quais: string[] = [];
      if (m.doc_id_validade && (m.doc_id_validade as string) <= horizonte) quais.push(`documento (${m.doc_id_validade})`);
      if (m.carta_validade && (m.carta_validade as string) <= horizonte) quais.push(`carta (${m.carta_validade})`);
      if (!quais.length) continue;
      add({
        tipo: "doc_motorista_a_expirar",
        titulo: "Documento do motorista a expirar",
        detalhe: `${m.nome} — ${quais.join(", ")}`,
        href: `/admin/motoristas?m=${m.id}`,
        entidade: "motorista",
        entidade_id: m.id as string,
      });
    }

    // 8. Lembretes de pagamento a comunicar (config: procedimento pagamento_a_vencer).
    //    Gera 1 notificação por cobrança a vencer no horizonte, com o wa.me pronto.
    const { data: procPag } = await supabaseAdmin
      .from("procedimento")
      .select("condicoes")
      .eq("gatilho", "pagamento_a_vencer")
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();
    if (procPag) {
      const diasAntes = Math.max(0, Number((procPag.condicoes as { dias_antes?: number } | null)?.dias_antes ?? 1));
      const hojeD = new Date().toISOString().slice(0, 10);
      const ateD = new Date(Date.now() + diasAntes * 86400000).toISOString().slice(0, 10);
      const { data: cobs } = await supabaseAdmin
        .from("vw_cobranca_estado")
        .select("id, motorista_id, veiculo_id, em_falta, data_vencimento")
        .neq("tipo", "caucao")
        .in("estado_liquidacao", ["por_liquidar", "parcial"])
        .gte("data_vencimento", hojeD)
        .lte("data_vencimento", ateD);
      if (cobs?.length) {
        const motIds = [...new Set(cobs.map((c) => c.motorista_id as string))];
        const { data: mots } = await supabaseAdmin
          .from("motorista")
          .select("id, nome, telefone_e164")
          .in("id", motIds);
        const motDe = new Map((mots ?? []).map((m) => [m.id as string, m]));
        for (const c of cobs) {
          const m = motDe.get(c.motorista_id as string);
          const mat = matriculaDe.get(c.veiculo_id as string) ?? "?";
          const valor = formatarPreco(String(c.em_falta));
          const venc = c.data_vencimento as string;
          const dataCurta = `${venc.slice(8, 10)}/${venc.slice(5, 7)}`;
          const digits = m?.telefone_e164?.replace(/\D/g, "") ?? "";
          // Texto por omissão em inglês (a maioria dos motoristas); editável no WhatsApp.
          const texto = textoLembrete({ nome: m?.nome ?? "motorista", matricula: mat, data: dataCurta, valor }, "en");
          const href = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(texto)}` : "/admin/cobrancas";
          add({
            tipo: "pagamento_a_comunicar",
            titulo: "Lembrar pagamento",
            detalhe: `${m?.nome ?? "motorista"} — ${mat} · ${valor} · vence ${dataCurta}`,
            href,
            entidade: "cobranca",
            entidade_id: c.id as string,
          });
        }
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
