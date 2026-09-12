/**
 * As mensagens para o Telegram do gestor, fora do resumo do cron (esse está em
 * resumoAlertas.ts): o alerta de um procedimento e o aviso de novo pedido.
 *
 * A regra é a do resumo. O Telegram é um serviço de terceiros, e a conversa fica
 * em todos os dispositivos onde a sessão estiver aberta. Por isso cada mensagem
 * diz SÓ o que aconteceu e dá o link para a página do admin com o detalhe, que
 * pede sessão. Nada de nomes, telefones, emails, matrículas, valores, datas,
 * locais ou texto escrito pelo cliente. O detalhe do pedido continua a ir no
 * email ao admin.
 *
 * As funções nem recebem o detalhe: por construção, não há como o deixar escapar.
 * (Puras, sem Supabase nem Next — testadas em mensagensTelegram.test.mjs.)
 */

type Evento = readonly [rotulo: string, pagina: string, abrir: string];

/** Por gatilho: o rótulo (o do ecrã de Procedimentos) e a página do admin onde está o detalhe. */
const EVENTOS = new Map<string, Evento>([
  ["coima_registada", ["Coima registada", "/admin/despesas", "Abrir as despesas"]],
  ["portagem_registada", ["Portagem registada", "/admin/despesas", "Abrir as despesas"]],
  ["seguro_registado", ["Carta verde / seguro registado", "/admin/motas", "Abrir as motas"]],
  ["seguro_a_expirar", ["Seguro a expirar", "/admin/notificacoes", "Abrir as notificações"]],
  ["manutencao_a_vencer", ["Manutenção a vencer", "/admin/notificacoes", "Abrir as notificações"]],
  ["doc_motorista_a_expirar", ["Documento do motorista a expirar", "/admin/notificacoes", "Abrir as notificações"]],
  ["pagamento_a_vencer", ["Pagamento a vencer", "/admin/notificacoes", "Abrir as notificações"]],
]);

/** Gatilho que não conhecemos: o próprio nome do gatilho não sai. */
const OUTRO_EVENTO: Evento = ["Outro evento", "/admin/notificacoes", "Abrir as notificações"];

/**
 * O texto que não é fixo (o nome que o gestor deu ao procedimento, o modelo da
 * mota): numa linha, curto, e com os caracteres do Markdown do Telegram
 * escapados — um "_" ou um "*" solto fazia o Telegram recusar a mensagem toda.
 */
function linhaSegura(texto: string): string {
  // Corta por pontos de código e não por unidades UTF-16: um emoji na posição 80
  // não fica partido ao meio.
  const curto = Array.from(texto.replace(/\s+/g, " ").trim()).slice(0, 80).join("");
  return curto.replace(/([_*`[])/g, "\\$1");
}

const semBarraFinal = (origem: string) => origem.replace(/\/+$/, "");

/**
 * O alerta de um procedimento 'alertar_gestor'. `origem` = https://… do site.
 * Em TODOS os gatilhos leva o evento, o nome do procedimento e o link: a
 * matrícula, o valor, a data e o local ficam na página, com sessão.
 */
export function alertaProcedimentoTelegram(
  evento: { procedimento: string; gatilho: string },
  origem: string,
): string {
  const [rotulo, pagina, abrir] = EVENTOS.get(evento.gatilho) ?? OUTRO_EVENTO;
  return `⚠️ *${rotulo}*\nProcedimento: ${linhaSegura(evento.procedimento)}\n\n[${abrir}](${semBarraFinal(origem)}${pagina})`;
}

/**
 * O aviso de novo pedido de aluguer: o modelo da mota (lido da base, não do que
 * o cliente escreveu) e o link para os Pedidos.
 */
export function novoPedidoTelegram(pedido: { motoModelo: string }, origem: string): string {
  return `🛵 *Novo pedido de aluguer*\nMota: ${linhaSegura(pedido.motoModelo)}\n\n[Abrir os pedidos](${semBarraFinal(origem)}/admin/pedidos)`;
}
