import "server-only";
import { createHmac } from "node:crypto";

/**
 * Token do recibo de entrega, SEM ESTADO: `<vistoriaId>.<assinatura>`.
 * A assinatura é um HMAC-SHA256 da vistoria com a service-role key (server-only),
 * por isso o token não é forjável sem o segredo. Um recibo é um documento estático
 * (não muda, não precisa de revogação), logo não guardamos nada na BD — ao
 * contrário do token de entrega, que é uma sessão com estado.
 */
function assinaturaDe(vistoriaId: string): string {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", chave).update(`recibo:${vistoriaId}`).digest("base64url").slice(0, 32);
}

export function assinarRecibo(vistoriaId: string): string {
  return `${vistoriaId}.${assinaturaDe(vistoriaId)}`;
}

/** Devolve a vistoriaId se o token for válido, senão null. (UUID não contém ".") */
export function validarRecibo(token: string): string | null {
  const [id, sig] = (token ?? "").split(".");
  if (!id || !sig) return null;
  const esperado = assinaturaDe(id);
  if (sig.length !== esperado.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0 ? id : null;
}
