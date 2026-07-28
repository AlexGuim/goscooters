import "server-only";

export interface NovoPedidoNotificacao {
  pedidoId: string;
  nome: string;
  telefone: string;
  email?: string | null;
  motoModelo: string;
  plataforma: string;
  dataInicio?: string | null;
  /** Já formatado com a unidade certa, ex.: "3 semanas". */
  duracaoTexto?: string | null;
  mensagem?: string | null;
}

/**
 * Aviso de novo pedido de aluguer.
 *
 * Princípio que orienta este ficheiro: o lead JÁ está gravado quando isto corre.
 * Uma falha a notificar nunca pode fazer o cliente pensar que o pedido se perdeu,
 * por isso nada aqui deita excepções para fora — falha-se em silêncio, com log.
 *
 * Ambos os canais são opcionais: sem as variáveis de ambiente respectivas, o
 * canal é simplesmente saltado. Assim a aplicação funciona antes de as
 * credenciais existirem.
 */

const linha = (rotulo: string, valor?: string | null) =>
  `${rotulo}: ${valor && String(valor).trim() ? valor : "—"}`;

function corpoTexto(p: NovoPedidoNotificacao): string {
  return [
    linha("Nome", p.nome),
    linha("Telefone", p.telefone),
    linha("Email", p.email),
    linha("Mota", p.motoModelo),
    linha("Plataforma", p.plataforma),
    linha("Data de início", p.dataInicio),
    linha("Duração", p.duracaoTexto),
    linha("Mensagem", p.mensagem),
  ].join("\n");
}

async function enviarEmail(p: NovoPedidoNotificacao): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const destinatario = process.env.ADMIN_EMAIL;
  const remetente = process.env.RESEND_FROM ?? "onboarding@resend.dev";

  if (!apiKey || !destinatario) {
    console.info("[notificacao] Email ignorado: RESEND_API_KEY ou ADMIN_EMAIL em falta.");
    return;
  }

  const texto = corpoTexto(p);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remetente,
      // ADMIN_EMAIL aceita vários emails separados por vírgula.
      to: destinatario.split(",").map((e) => e.trim()).filter(Boolean),
      // Responder ao email vai directamente para o cliente, quando o deixou.
      ...(p.email ? { reply_to: p.email } : {}),
      subject: `Novo pedido de aluguer — ${p.nome} (${p.motoModelo})`,
      text: `${texto}\n\nReferência do pedido: ${p.pedidoId}`,
    }),
  });

  if (!response.ok) {
    const detalhe = await response.text().catch(() => "");
    throw new Error(`Resend respondeu ${response.status}: ${detalhe.slice(0, 300)}`);
  }
}

async function enviarTelegram(p: NovoPedidoNotificacao): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.info(
      "[notificacao] Telegram ignorado: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID em falta.",
    );
    return;
  }

  const texto = `🛵 *Novo pedido de aluguer*\n\n${corpoTexto(p)}`;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const detalhe = await response.text().catch(() => "");
    throw new Error(`Telegram respondeu ${response.status}: ${detalhe.slice(0, 300)}`);
  }
}

/**
 * Envia uma mensagem de texto simples ao Telegram do gestor (canal de alertas).
 * Best-effort: devolve false e não lança se não estiver configurado ou falhar.
 */
export async function enviarTelegramTexto(texto: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: "Markdown" }),
    });
    if (!r.ok) console.error("[telegram] resposta", r.status);
    return r.ok;
  } catch (e) {
    console.error("[telegram] falha:", e);
    return false;
  }
}

/**
 * Dispara os dois canais em paralelo. Usa allSettled de propósito: um canal
 * avariado não deve impedir o outro de entregar o aviso.
 */
export async function notificarNovoPedido(p: NovoPedidoNotificacao): Promise<void> {
  const resultados = await Promise.allSettled([enviarEmail(p), enviarTelegram(p)]);
  const canais = ["email", "telegram"] as const;

  resultados.forEach((resultado, i) => {
    if (resultado.status === "rejected") {
      console.error(
        `[notificacao] Falha no canal ${canais[i]} para o pedido ${p.pedidoId}:`,
        resultado.reason,
      );
    }
  });
}
