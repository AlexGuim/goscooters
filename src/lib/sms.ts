import "server-only";

/**
 * Envio de SMS via Twilio (API REST, sem SDK — mesma abordagem das notificações).
 *
 * Sem as variáveis de ambiente configuradas, o envio é simplesmente saltado com
 * um log — a aplicação funciona antes de existirem credenciais.
 *
 * Variáveis: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (número ou
 * sender ID alfanumérico aprovado).
 */
export function smsConfigurado(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM,
  );
}

export async function enviarSMS(
  para: string,
  texto: string,
): Promise<{ ok: boolean; erro?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;

  if (!sid || !token || !from) {
    return { ok: false, erro: "SMS não configurado (faltam variáveis Twilio)." };
  }
  if (!para) {
    return { ok: false, erro: "Sem número de destino." };
  }

  const corpo = new URLSearchParams({ To: para, From: from, Body: texto });

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: corpo,
    },
  );

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    return { ok: false, erro: `Twilio ${resp.status}: ${detalhe.slice(0, 200)}` };
  }
  return { ok: true };
}
