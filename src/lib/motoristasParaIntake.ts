import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { MotoristaParaKyc } from "@/app/(admin)/admin/(protected)/documentos/KycDeDocumento";

/**
 * Os motoristas que o intake de documentos precisa de conhecer — com o perfil
 * KYC, para completar a ficha em vez de a substituir, e os ficheiros que já lá
 * estão, para dizer se a entrega já tem tudo.
 *
 * Partilhado por Documentos e Despesas: um documento de identidade que entre
 * por qualquer dos dois ecrãs tem de encontrar o mesmo caminho até à ficha.
 */
export async function motoristasParaIntake(): Promise<MotoristaParaKyc[]> {
  const { data } = await supabaseAdmin
    .from("motorista")
    .select(
      "id, nome, nif, pais_iso, data_nascimento, doc_id_tipo, doc_id_numero, doc_id_validade, carta_numero, carta_categoria, carta_pais, carta_validade, morada_linha1, codigo_postal, localidade, doc_urls",
    )
    .neq("estado", "bloqueado")
    .order("nome");
  return (data ?? []).map(({ id, nome, doc_urls, ...ficha }) => ({
    id,
    nome,
    ficha,
    docUrls: (doc_urls as string[] | null) ?? null,
  }));
}
