/** Processo de identificação do condutor de um auto (tabela `infracao`, fase16). */

export type InfracaoRegime = "ansr" | "outro";
export type InfracaoEstado = "por_identificar" | "gerada" | "assinada" | "enviada" | "nao_aplicavel";
export type InfracaoSignatario = "arguido" | "mandatario" | "representante_legal";
export type InfracaoEnvioCanal = "email" | "portal" | "correio_registado" | "presencial";

export type Infracao = {
  id: string;
  despesa_id: string | null;
  veiculo_id: string | null;
  proprietario_id: string | null;
  motorista_id: string | null;
  contrato_id: string | null;
  regime: InfracaoRegime;
  entidade: string;
  numero_auto: string | null;
  data_infracao: string | null;
  data_notificacao: string | null;
  prazo_identificacao: string | null;
  /** Quando o n.º do auto e a data da notificação foram lidos do documento pela IA. */
  auto_lido_em: string | null;
  estado: InfracaoEstado;
  signatario: InfracaoSignatario | null;
  f306_path: string | null;
  f306_gerado_em: string | null;
  f306_assinado_path: string | null;
  envio_canal: InfracaoEnvioCanal | null;
  envio_destino: string | null;
  envio_referencia: string | null;
  enviado_em: string | null;
  comprovativo_path: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};

/** Dias úteis para identificar o condutor, a contar da notificação (Código da Estrada, art. 171.º). */
export const DIAS_UTEIS_PARA_IDENTIFICAR = 15;

/** Um dado que falta para preencher o F306. Os `obrigatorio: false` não impedem gerar. */
export type FaltaF306 = { quem: "auto" | "arguido" | "condutor"; campo: string; obrigatorio: boolean };

export const ESTADO_INFRACAO_ROTULO: Record<InfracaoEstado, string> = {
  por_identificar: "Por identificar",
  gerada: "F306 gerado",
  assinada: "F306 assinado",
  enviada: "Enviada",
  nao_aplicavel: "Não aplicável",
};

export const CANAL_ENVIO_ROTULO: Record<InfracaoEnvioCanal, string> = {
  email: "Email (mail@ansr.pt)",
  portal: "Portal das Contraordenações",
  correio_registado: "Correio registado",
  presencial: "PSP ou GNR",
};
