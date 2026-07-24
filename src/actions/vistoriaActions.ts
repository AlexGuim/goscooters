"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";

export interface DanoPrevio {
  zona: string;
  nota: string;
  foto_path?: string | null;
}

export interface SubmeterEntregaInput {
  contrato_id: string;
  km: number | null;
  nivel_combustivel: number | null; // 0..100
  video_path: string | null; // caminho no bucket privado
  foto_paths: string[]; // caminhos no bucket privado, por ordem dos slots
  assinatura_path: string | null;
  checklist_itens: Record<string, boolean>;
  danos: DanoPrevio[];
  notas: string | null;
  // Prova de aceitação das regras (versão + hash da versão exata mostrada).
  regras_versao?: string | null;
  regras_hash?: string | null;
  regras_aceite?: boolean;
}

/**
 * Submete a vistoria de ENTREGA e ativa o contrato, numa só operação:
 * grava a vistoria (fotos/vídeo/assinatura como caminhos privados), regista a
 * KM, ativa o contrato (moto → ocupada), e promove o motorista lead → ativo.
 * O índice único vistoria(contrato_id,'entrega') garante que só há uma.
 */
export async function submeterVistoriaEntrega(
  input: SubmeterEntregaInput,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.contrato_id) return { success: false, error: "Contrato em falta." };

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, veiculo_id, motorista_id, estado")
    .eq("id", input.contrato_id)
    .maybeSingle();
  if (!c) return { success: false, error: "Contrato não encontrado." };

  const { data: jaExiste } = await supabaseAdmin
    .from("vistoria")
    .select("id")
    .eq("contrato_id", input.contrato_id)
    .eq("tipo", "entrega")
    .maybeSingle();
  if (jaExiste) return { success: false, error: "Este contrato já tem uma vistoria de entrega." };

  const agora = new Date().toISOString();

  const { error: vErr } = await supabaseAdmin.from("vistoria").insert({
    contrato_id: input.contrato_id,
    tipo: "entrega",
    realizada_em: agora,
    km: input.km,
    nivel_combustivel: input.nivel_combustivel,
    // Guardamos o CAMINHO privado (não um URL público) — lê-se por URL assinado.
    video_url: input.video_path,
    foto_urls: input.foto_paths.length ? input.foto_paths : null,
    checklist: {
      itens: input.checklist_itens,
      danos: input.danos,
      regras: input.regras_versao
        ? {
            versao: input.regras_versao,
            hash: input.regras_hash ?? null,
            aceite: !!input.regras_aceite,
            em: agora,
          }
        : null,
    },
    notas: input.notas?.trim() || null,
    assinatura_cliente_url: input.assinatura_path,
  });
  if (vErr) {
    console.error("submeterVistoriaEntrega vistoria error:", vErr);
    return { success: false, error: "Erro ao gravar a vistoria." };
  }

  if (input.km != null && c.veiculo_id) {
    await supabaseAdmin.from("km_registo").insert({
      veiculo_id: c.veiculo_id,
      km: input.km,
      data: agora.slice(0, 10),
      fonte: "entrega",
    });
  }

  const upd: { estado: "ativo"; km_inicio?: number } = { estado: "ativo" };
  if (input.km != null) upd.km_inicio = input.km;
  await supabaseAdmin.from("contrato_aluguer").update(upd).eq("id", input.contrato_id);

  if (c.veiculo_id) {
    await supabaseAdmin
      .from("moto")
      .update({ estado_operacional: "ocupado" })
      .eq("id", c.veiculo_id);
  }
  if (c.motorista_id) {
    // Promove só se ainda for lead — não mexe num já ativo/bloqueado.
    await supabaseAdmin
      .from("motorista")
      .update({ estado: "ativo" })
      .eq("id", c.motorista_id)
      .eq("estado", "lead");
  }

  revalidatePath("/admin/contratos");
  revalidatePath("/admin/motas");
  return { success: true };
}
