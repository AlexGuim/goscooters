import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// A mota tem DOIS planos de estado, de propósito separados:
//  - OPERAÇÃO: `estado_operacional` (disponivel/ocupado/manutencao/inativo),
//    escrito pela operação (contratos/vistorias) e lido pelo portal do parceiro;
//  - CATÁLOGO: `estado` (disponivel/alugada/manutencao) + `ativo` (publicado),
//    que é o que o SITE PÚBLICO mostra.
// Estes helpers mantêm os dois planos em SINCRONIA quando a operação ocupa/liberta
// a mota, para o site não mostrar "Disponível" numa mota alugada. A sincronização
// do catálogo é GUARDADA: só troca disponivel<->alugada (via .eq no estado atual),
// nunca mexe em 'manutencao' nem na flag de publicação `ativo`.

/** Ocupa a mota (contrato ativo/entrega): operacional=ocupado e catálogo→alugada. */
export async function ocuparMota(motoId: string): Promise<void> {
  await supabaseAdmin.from("moto").update({ estado_operacional: "ocupado" }).eq("id", motoId);
  await supabaseAdmin
    .from("moto")
    .update({ estado: "alugada" })
    .eq("id", motoId)
    .eq("estado", "disponivel"); // só se estava disponível — não toca em 'manutencao'
}

/** Liberta a mota (concluir/cancelar/recolher): operacional=disponivel e catálogo→disponivel. */
export async function libertarMota(motoId: string): Promise<void> {
  await supabaseAdmin.from("moto").update({ estado_operacional: "disponivel" }).eq("id", motoId);
  await supabaseAdmin
    .from("moto")
    .update({ estado: "disponivel" })
    .eq("id", motoId)
    .eq("estado", "alugada"); // só reverte 'alugada' — não toca em 'manutencao'
}
