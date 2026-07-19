import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServerClient";

/**
 * Lista de emails autorizados a entrar na administração, vinda de ADMIN_EMAIL.
 * Aceita vários separados por vírgula.
 */
function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Devolve o utilizador autenticado, ou null.
 *
 * Usa getUser() e não getSession(): getSession apenas lê o cookie, que o
 * cliente controla; getUser valida o token junto do servidor de auth. Para
 * decisões de autorização só a segunda serve.
 *
 * Memoizado com cache() para não repetir a chamada dentro do mesmo render.
 */
export const getAuthenticatedAdmin = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const adminEmails = getAdminEmails();

  // Sem ADMIN_EMAIL configurado ninguém entra — falhar fechado, não aberto.
  if (adminEmails.length === 0) {
    console.error(
      "ADMIN_EMAIL não está configurado: acesso à administração recusado.",
    );
    return null;
  }

  const email = data.user.email?.toLowerCase();

  if (!email || !adminEmails.includes(email)) {
    console.warn("Acesso à administração recusado para:", email);
    return null;
  }

  return data.user;
});

/**
 * Garante que há um admin autenticado; caso contrário redirecciona para o login.
 * Usar no topo de cada página de administração.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getAuthenticatedAdmin();

  if (!user) {
    redirect("/admin/login");
  }

  return user;
}

/**
 * Variante para Server Actions: devolve um erro em vez de redireccionar,
 * para a UI poder mostrar a mensagem.
 */
export async function requireAdminForAction(): Promise<
  { ok: true; user: User } | { ok: false; error: string }
> {
  const user = await getAuthenticatedAdmin();

  if (!user) {
    return { ok: false, error: "Sessão expirada ou sem permissões. Entra novamente." };
  }

  return { ok: true, user };
}
