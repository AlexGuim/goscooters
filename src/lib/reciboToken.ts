import "server-only";
import { createHmac } from "node:crypto";

/**
 * Token do contrato/recibo de entrega, SEM ESTADO: `<vistoriaId>.<iat>.<assinatura>`.
 * A assinatura é um HMAC-SHA256 de (vistoria + data de emissão) com a service-role
 * key (server-only), por isso o token não é forjável sem o segredo. Continua sem
 * estado na BD; a data de emissão vai ASSINADA no próprio token e dá-lhe validade
 * (VALIDADE_MS) — como o documento passou a expor KYC (NIF, nº documento, morada,
 * carta), um link partilhável não pode ficar válido para sempre. Passada a
 * validade, gera-se um novo link (o motorista guarda o PDF, que não expira).
 */
const VALIDADE_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

function assinaturaDe(payload: string): string {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHmac("sha256", chave).update(payload).digest("base64url").slice(0, 32);
}

// Comparação em tempo constante (evita timing attacks na assinatura).
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function assinarRecibo(vistoriaId: string): string {
  const iat = Date.now().toString(36);
  const sig = assinaturaDe(`recibo:${vistoriaId}:${iat}`);
  return `${vistoriaId}.${iat}.${sig}`;
}

/**
 * Devolve a vistoriaId se o token for válido E dentro da validade, senão null.
 * (UUID e iat/base36 e assinatura/base64url não contêm ".", logo o split é seguro.)
 */
export function validarRecibo(token: string): string | null {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null; // formato antigo (sem validade) já não é aceite
  const [id, iat, sig] = partes;
  if (!id || !iat || !sig) return null;
  if (!iguais(sig, assinaturaDe(`recibo:${id}:${iat}`))) return null;
  const ts = parseInt(iat, 36);
  if (!Number.isFinite(ts) || Date.now() - ts > VALIDADE_MS) return null;
  return id;
}

/**
 * Token do COMPROVATIVO DE PAGAMENTO — mesmo mecanismo, namespace diferente.
 *
 * O payload assinado começa por "comprovativo:" (e não "recibo:"), por isso um
 * token de contrato/entrega nunca valida como comprovativo, nem o inverso:
 * trocar de documento exigiria forjar uma assinatura. Validade maior (1 ano)
 * porque este documento expõe muito menos dados pessoais — nome, NIF e montantes,
 * sem morada, nº de documento ou carta — e é precisamente o papel que o motorista
 * vai querer meses depois.
 */
const VALIDADE_COMPROVATIVO_MS = 365 * 24 * 60 * 60 * 1000;

export function assinarComprovativo(comprovativoId: string): string {
  const iat = Date.now().toString(36);
  const sig = assinaturaDe(`comprovativo:${comprovativoId}:${iat}`);
  return `${comprovativoId}.${iat}.${sig}`;
}

/** Devolve o comprovativoId se o token for válido e dentro da validade, senão null. */
export function validarComprovativo(token: string): string | null {
  const partes = (token ?? "").split(".");
  if (partes.length !== 3) return null;
  const [id, iat, sig] = partes;
  if (!id || !iat || !sig) return null;
  if (!iguais(sig, assinaturaDe(`comprovativo:${id}:${iat}`))) return null;
  const ts = parseInt(iat, 36);
  if (!Number.isFinite(ts) || Date.now() - ts > VALIDADE_COMPROVATIVO_MS) return null;
  return id;
}
