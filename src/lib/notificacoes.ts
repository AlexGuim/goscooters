import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export interface NovaNotificacao {
  tipo: string; // slug do evento (ex.: 'pre_contrato_sem_mota')
  titulo: string;
  detalhe?: string | null;
  href?: string | null; // deep-link para a ação
  entidade?: string | null;
  entidade_id?: string | null;
}

/**
 * Cria uma notificação interna do gestor. BEST-EFFORT: nunca lança nem reverte a
 * operação de negócio (espelha o princípio do notifications.ts). O índice único
 * parcial (tipo, entidade_id) WHERE estado<>'feita' evita duplicados — se a
 * notificação já existir por resolver, o erro 23505 é ignorado. Se a tabela ainda
 * não estiver migrada (fase5), também não parte.
 */
export async function notificar(n: NovaNotificacao): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("notificacao").insert({
      tipo: n.tipo,
      titulo: n.titulo,
      detalhe: n.detalhe ?? null,
      href: n.href ?? null,
      entidade: n.entidade ?? null,
      entidade_id: n.entidade_id ?? null,
    });
    if (error && error.code !== "23505") {
      console.warn("notificar (migrar fase5?):", error.message);
    }
  } catch (err) {
    console.warn("notificar exception:", err);
  }
}
