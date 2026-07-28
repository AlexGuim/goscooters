import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  prepararComunicacao,
  type ComunicacaoPreparada,
  type ComunicacaoTipo,
} from "@/actions/comunicacaoActions";
import { enviarLembrete } from "@/lib/sms";
import { enviarTelegramTexto } from "@/lib/notifications";
import type { Procedimento, ProcedimentoGatilho } from "@/types/db";

/**
 * Motor de procedimentos: dado um EVENTO (gatilho) e o seu contexto, encontra os
 * procedimentos ativos que batem as condições e executa a ação em modo manual
 * (prepara para o gestor confirmar) ou automático (envia sozinho). Chamado a
 * partir de contexto de admin (intake). Só leitura da config; as ações reusam
 * prepararComunicacao / enviarLembrete (Twilio) / enviarTelegramTexto.
 */

export interface ContextoEvento {
  veiculo_id: string;
  motorista_id?: string | null;
  matricula?: string | null;
  valor?: string | null; // "12.40"
  data?: string | null; // já formatada (dd/mm/aaaa)
  documento_url?: string | null;
  categoria?: string | null; // para as condições
}

export interface ResultadoProcedimento {
  procedimento: string; // nome
  estado: "preparada" | "enviada" | "falhou" | "ignorada";
  detalhe?: string;
  /** Só quando 'preparada' (manual): a comunicação para o UI mostrar o cartão. */
  comunicacao?: ComunicacaoPreparada;
}

const GATILHO_TIPO: Partial<Record<ProcedimentoGatilho, ComunicacaoTipo>> = {
  coima_registada: "coima",
  portagem_registada: "portagem",
  seguro_registado: "seguro",
};

function condicoesBatem(cond: Procedimento["condicoes"], ctx: ContextoEvento): boolean {
  if (!cond) return true;
  if (cond.valor_min != null && Number(ctx.valor ?? 0) < cond.valor_min) return false;
  if (cond.categoria && ctx.categoria && cond.categoria !== ctx.categoria) return false;
  return true;
}

export async function avaliarProcedimentos(
  gatilho: ProcedimentoGatilho,
  ctx: ContextoEvento,
): Promise<ResultadoProcedimento[]> {
  const { data: procs } = await supabaseAdmin
    .from("procedimento")
    .select("*")
    .eq("gatilho", gatilho)
    .eq("ativo", true);

  const out: ResultadoProcedimento[] = [];
  for (const p of (procs ?? []) as Procedimento[]) {
    if (!condicoesBatem(p.condicoes, ctx)) continue;

    if (p.acao === "comunicar_motorista") {
      const tipo = GATILHO_TIPO[gatilho];
      if (!tipo) {
        out.push({ procedimento: p.nome, estado: "ignorada", detalhe: "gatilho sem comunicação ao motorista" });
        continue;
      }
      const prep = await prepararComunicacao({
        tipo,
        veiculo_id: ctx.veiculo_id,
        motorista_id: ctx.motorista_id ?? null,
        matricula: ctx.matricula ?? null,
        valor: ctx.valor ?? null,
        data: ctx.data ?? null,
        documento_url: ctx.documento_url ?? null,
      });
      if (!prep.success || !prep.dados) {
        out.push({ procedimento: p.nome, estado: "falhou", detalhe: prep.error });
        continue;
      }
      // Manual (ou canal 'preparar') → devolve para o gestor confirmar no cartão.
      if (p.modo === "manual" || p.canal === "preparar") {
        out.push({ procedimento: p.nome, estado: "preparada", comunicacao: prep.dados });
        continue;
      }
      // Auto → envia por Twilio (enviarLembrete escolhe WhatsApp > SMS).
      const e164 = prep.dados.motorista.telefone_e164;
      if (!e164) {
        out.push({ procedimento: p.nome, estado: "falhou", detalhe: "motorista sem telefone" });
        continue;
      }
      const r = await enviarLembrete(e164, prep.dados.texto);
      out.push({
        procedimento: p.nome,
        estado: r.ok ? "enviada" : "falhou",
        detalhe: r.ok ? `enviada (${r.canal})` : r.erro,
      });
    } else if (p.acao === "alertar_gestor") {
      const partes = [ctx.matricula, ctx.valor ? `${ctx.valor} €` : null, ctx.data].filter(Boolean);
      const ok = await enviarTelegramTexto(`⚠️ *${p.nome}*\n${partes.join(" · ")}`);
      out.push({ procedimento: p.nome, estado: ok ? "enviada" : "falhou", detalhe: ok ? "telegram" : "telegram indisponível" });
    }
  }
  return out;
}
