"use server";

import { requireAdminForAction } from "@/lib/dal";
import { createSupabaseServerClient } from "@/lib/supabaseServerClient";
import { validarEscolha } from "@/lib/inicioBlocos";

/** Uma linha do painel «Personalizar o Início», como chega do browser. */
export interface EscolhaDeBloco {
  id: string;
  largura: string;
  visivel: boolean;
}

/**
 * Guarda o Início que o gestor montou, na conta DELE.
 *
 * Fica em `user_metadata.inicio` — só ids, ordem, largura e o que está
 * escondido. É uma preferência de ecrã e mais nada: NUNCA serve para autorizar
 * o que quer que seja (quem decide o que se pode ver é a sessão, no servidor).
 *
 * Escreve-se pela sessão (`auth.updateUser`), e não pela chave de serviço: uma
 * função de servidor é alcançável por um POST direto, e com o cliente de
 * administração bastava um id no corpo do pedido para mexer na conta de outra
 * pessoa. Por aqui, o único utilizador que se pode tocar é o que está ligado.
 *
 * O que já lá estava no metadata mantém-se: junta-se a chave, não se troca o
 * conjunto.
 */
export async function guardarInicio(
  escolha: EscolhaDeBloco[],
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  // Vem do browser: valida-se tudo — ids do catálogo, sem repetições, largura
  // conhecida, dentro do limite de blocos e de bytes. O resto recusa-se.
  const validada = validarEscolha(escolha);
  if (!validada.ok) return { success: false, error: validada.erro };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({
    data: { ...auth.user.user_metadata, inicio: validada.guardado },
  });
  if (error) {
    console.error("guardarInicio:", error);
    return { success: false, error: "Não foi possível guardar o Início." };
  }

  return { success: true };
}
