"use server";

import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { assinarRecibo } from "@/lib/reciboToken";

/**
 * Gera o link do recibo de entrega (página pública com token) para enviar ao
 * motorista, com a mensagem de WhatsApp pronta. O recibo mostra a vistoria de
 * entrega desse contrato (km, fotos, danos, materiais, assinatura).
 */
export async function criarLinkRecibo(
  contratoId: string,
): Promise<{ success: boolean; link?: string; whatsapp?: string | null; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const { data: v } = await supabaseAdmin
    .from("vistoria")
    .select("id")
    .eq("contrato_id", contratoId)
    .eq("tipo", "entrega")
    .order("realizada_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!v) return { success: false, error: "Ainda não há vistoria de entrega para este contrato." };

  const token = assinarRecibo(v.id);
  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host") ?? "goscooters.vercel.app"}`;
  const link = `${origin}/recibo/${token}`;

  let whatsapp: string | null = null;
  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("motorista_id")
    .eq("id", contratoId)
    .maybeSingle();
  if (c?.motorista_id) {
    const { data: m } = await supabaseAdmin
      .from("motorista")
      .select("nome, telefone_e164, idioma_preferido")
      .eq("id", c.motorista_id)
      .maybeSingle();
    if (m?.telefone_e164) {
      const num = m.telefone_e164.replace(/\D/g, "");
      const primeiro = (m.nome ?? "").split(" ")[0];
      const texto =
        (m.idioma_preferido ?? "pt") !== "pt"
          ? `Hi ${primeiro}, here is your GoScooters delivery receipt: ${link}`
          : `Olá ${primeiro}, aqui está o recibo de entrega da tua mota (GoScooters): ${link}`;
      whatsapp = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
    }
  }

  return { success: true, link, whatsapp };
}
