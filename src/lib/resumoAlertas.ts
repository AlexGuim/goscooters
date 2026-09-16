/**
 * O resumo dos alertas que o cron diário envia para o Telegram do gestor.
 *
 * O Telegram é um serviço de terceiros, e a conversa fica em todos os
 * dispositivos onde a sessão estiver aberta. Por isso o resumo leva SÓ quantos
 * alertas há de cada tipo e o link para as Notificações — nada de nomes de
 * motoristas, matrículas, números de auto ou datas de documentos. O detalhe
 * continua na caixa de notificações dentro da app, que pede sessão.
 *
 * A função nem recebe o detalhe: por construção, não há como o deixar escapar.
 * (Pura, sem Supabase nem Next — testada em resumoAlertas.test.mjs.) A mesma
 * regra vale para as outras mensagens ao Telegram: ver mensagensTelegram.ts.
 */

const ROTULOS = new Map<string, readonly [singular: string, plural: string]>([
  ["seguro_a_expirar", ["seguro a expirar", "seguros a expirar"]],
  ["manutencao_a_vencer", ["manutenção a vencer", "manutenções a vencer"]],
  ["doc_motorista_a_expirar", ["documento de motorista a expirar", "documentos de motorista a expirar"]],
  ["infracao_prazo", ["coima com prazo para identificar o condutor", "coimas com prazo para identificar o condutor"]],
]);

/**
 * `tipos` = o tipo de cada alerta em aberto (um por notificação). Devolve null
 * quando não há nada a enviar. Tipos desconhecidos contam como "outros alertas"
 * — o próprio nome do tipo não sai.
 */
export function resumoAlertasTelegram(tipos: readonly string[], linkNotificacoes: string): string | null {
  if (!tipos.length) return null;

  const contagem = new Map<string, number>();
  for (const t of tipos) contagem.set(t, (contagem.get(t) ?? 0) + 1);

  const linhas: string[] = [];
  for (const [tipo, [um, varios]] of ROTULOS) {
    const n = contagem.get(tipo);
    if (n) linhas.push(`• ${n} ${n === 1 ? um : varios}`);
  }
  let outros = 0;
  for (const [tipo, n] of contagem) if (!ROTULOS.has(tipo)) outros += n;
  if (outros) linhas.push(`• ${outros} ${outros === 1 ? "outro alerta" : "outros alertas"}`);

  // Link em sintaxe Markdown: um URL solto com "_" partia o parse_mode do Telegram.
  return `⚠️ *Alertas GoScooters* (${tipos.length})\n\n${linhas.join("\n")}\n\n[Abrir as notificações](${linkNotificacoes})`;
}
