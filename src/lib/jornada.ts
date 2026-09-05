/**
 * Os hrefs da jornada motorista → contrato → entrega → recibo, num só sítio.
 *
 * Cartões "próximo passo", notificações e redirects apontavam cada um para a
 * sua versão do mesmo destino (uns para a lista filtrada, outros para a lista
 * sem filtro, onde o pré-contrato nem aparece). Com um helper, o passo seguinte
 * é o mesmo visto de qualquer ecrã.
 */
export const hrefJornada = {
  /** Wizard de aluguer a arrancar no passo do contrato, com o motorista já escolhido. */
  criarContrato: (motoristaId: string) => `/admin/aluguel/novo?motorista=${motoristaId}`,
  /** Ficha do motorista aberta na lista. */
  ficha: (motoristaId: string) => `/admin/motoristas?m=${motoristaId}`,
  /** Entrega presencial (vistoria, fotos, assinatura). */
  entregar: (contratoId: string) => `/admin/contratos/${contratoId}/entrega`,
  /** Vistoria do contrato; `entregue` mostra o cartão pós-entrega com o envio do recibo. */
  vistoria: (contratoId: string, entregue = false) =>
    `/admin/contratos/${contratoId}/vistoria${entregue ? "?entregue=1" : ""}`,
  /** Lista de contratos com o filtro onde pré-contratos e rascunhos aparecem. */
  preenchimento: "/admin/contratos?f=preenchimento",
} as const;
