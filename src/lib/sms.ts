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

// ── WhatsApp (Twilio) ────────────────────────────────────────────────────────
// Requer TWILIO_ACCOUNT_SID/AUTH_TOKEN e TWILIO_WHATSAPP_FROM (ex.: o número do
// sandbox 'whatsapp:+14155238886' ou um sender WhatsApp aprovado). Para envios
// fora da janela de 24h, o WhatsApp exige templates aprovados.
export function whatsappConfigurado(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM,
  );
}

export async function enviarWhatsApp(
  para: string,
  texto: string,
): Promise<{ ok: boolean; erro?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) return { ok: false, erro: "WhatsApp não configurado." };
  if (!para) return { ok: false, erro: "Sem número de destino." };

  const corpo = new URLSearchParams({
    To: `whatsapp:${para}`,
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    Body: texto,
  });
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
    return { ok: false, erro: `Twilio WA ${resp.status}: ${detalhe.slice(0, 200)}` };
  }
  return { ok: true };
}

/** Envia um lembrete pelo melhor canal disponível: WhatsApp > SMS. */
export async function enviarLembrete(
  para: string,
  texto: string,
): Promise<{ ok: boolean; erro?: string; canal: "whatsapp" | "sms" | "nenhum" }> {
  if (whatsappConfigurado()) return { ...(await enviarWhatsApp(para, texto)), canal: "whatsapp" };
  if (smsConfigurado()) return { ...(await enviarSMS(para, texto)), canal: "sms" };
  return { ok: false, erro: "Sem canal configurado.", canal: "nenhum" };
}
