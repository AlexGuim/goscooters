import "server-only";

export interface AnexoEmail {
  nome: string;
  /** Conteúdo do ficheiro em base64. */
  base64: string;
}

export interface EmailParaEnviar {
  para: string[];
  assunto: string;
  texto: string;
  cc?: string[];
  responderPara?: string | null;
  anexos?: AnexoEmail[];
}

export type ResultadoEmail = { ok: true; id: string } | { ok: false; erro: string };

/**
 * Envio pelo Resend para destinatários EXTERNOS (entidades, parceiros).
 *
 * Ao contrário dos avisos internos de src/lib/notifications.ts, que falham em
 * silêncio, aqui a falha volta sempre para quem chamou: um envio a uma entidade
 * que não saiu tem de ficar registado como não enviado, nunca como feito.
 *
 * O remetente `@resend.dev` só entrega ao dono da conta Resend, por isso é
 * recusado logo — sem domínio verificado o email "sairia" sem chegar a ninguém.
 */
export async function enviarEmailExterno(e: EmailParaEnviar): Promise<ResultadoEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.RESEND_FROM?.trim();
  if (!apiKey) return { ok: false, erro: "O envio de email não está configurado (RESEND_API_KEY em falta)." };
  if (!remetente || /@resend\.dev>?$/i.test(remetente)) {
    return {
      ok: false,
      erro: "Falta verificar um domínio no Resend e definir RESEND_FROM com um endereço desse domínio.",
    };
  }
  const para = e.para.map((x) => x.trim()).filter(Boolean);
  if (!para.length) return { ok: false, erro: "Sem destinatário." };

  let resposta: Response;
  try {
    resposta = await fetch("https://api.resend.com/emails", {
      // Sem resposta a tempo, falha aqui — e não com a função cortada a meio, sem
      // ninguém saber se o email saiu.
      signal: AbortSignal.timeout(20_000),
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remetente,
        to: para,
        ...(e.cc?.length ? { cc: e.cc } : {}),
        ...(e.responderPara ? { reply_to: e.responderPara } : {}),
        subject: e.assunto,
        text: e.texto,
        ...(e.anexos?.length
          ? { attachments: e.anexos.map((a) => ({ filename: a.nome, content: a.base64 })) }
          : {}),
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, erro: "O Resend não respondeu a tempo — tenta outra vez daqui a pouco." };
    }
    return { ok: false, erro: `Não consegui contactar o Resend: ${err instanceof Error ? err.message : String(err)}` };
  }

  const corpo = (await resposta.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!resposta.ok) {
    return { ok: false, erro: `O Resend recusou o envio (${resposta.status}): ${corpo?.message ?? "sem detalhe"}` };
  }
  return { ok: true, id: corpo?.id ?? "" };
}
