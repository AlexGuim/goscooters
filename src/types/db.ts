export type MotoEstado = "disponivel" | "alugada" | "manutencao";
export type PedidoEstado = "novo" | "contactado" | "fechado" | "perdido";
export type AvaliacaoTipo = "positiva" | "negativa" | "neutra";

// ── Gestão de frota (Fase 1) ────────────────────────────────────────────────
export type TipoVeiculo = "moto" | "carro";
export type EstadoOperacional = "disponivel" | "ocupado" | "manutencao" | "inativo";
export type TipoParceiro = "gerido" | "anunciante";
export type ComissaoModelo = "percentagem" | "fixo_veiculo" | "fixo_mensal";
export type TipoPessoa = "singular" | "coletiva";
export type EstadoMotorista = "lead" | "ativo" | "inativo" | "bloqueado";
export type OrigemMotorista = "site" | "referral" | "walk_in" | "importado";
export type DocIdTipo = "cc" | "passaporte" | "titulo_residencia" | "aima";

// ── Contratos e cobrança (Fase 2) ───────────────────────────────────────────
export type Periodicidade = "semanal" | "quinzenal" | "mensal" | "diaria";
export type ContratoEstado =
  | "pre_contrato" // jornada aberta só com o motorista (sem mota/preço/data)
  | "rascunho"
  | "ativo"
  | "pendente_fecho"
  | "suspenso"
  | "concluido"
  | "cancelado";

export type NotificacaoEstado = "nova" | "lida" | "feita";
export type VistoriaTipo = "entrega" | "recolha" | "intermedia";
export type KmFonte = "entrega" | "recolha" | "manutencao" | "manual";
export type CobrancaTipo = "renda" | "caucao" | "extra";
export type EstadoLiquidacao =
  | "por_liquidar"
  | "parcial"
  | "liquidada"
  | "isenta"
  /** Nunca foi devida (o contrato acabou antes de a semana começar). Sem perda. */
  | "anulada"
  /** Era devida e usada, mas não vai ser paga. É uma PERDA — ver fase12. */
  | "incobravel";
export type PagamentoMetodo =
  | "transferencia"
  | "mbway"
  | "numerario"
  | "multibanco"
  | "outro";
export type PagamentoOrigem = "manual" | "ingestao" | "webhook";
export type PagamentoRecebidoPor = "goscooters" | "proprietario";

// ── Despesas (Fase 3) ───────────────────────────────────────────────────────
export type DespesaCategoria =
  | "manutencao"
  | "portagem"
  | "coima"
  | "seguro"
  | "gps"
  | "comissao"
  | "outro";
export type EstadoPagamentoDespesa = "pendente" | "parcial" | "paga" | "isenta";
export type ImputarA = "goscooters" | "proprietario" | "motorista";
export type DespesaOrigem = "manual" | "recorrente" | "ingestao";

// ── Seguros e Manutenção (Fase 6) ───────────────────────────────────────────
export type SeguroTipo = "responsabilidade_civil" | "danos_proprios" | "outro";
export type SeguroPeriodicidade = "anual" | "semestral" | "trimestral" | "mensal";
export type SeguroEstado = "ativa" | "expirada" | "cancelada";
export type ManutencaoTipo =
  | "revisao"
  | "oleo"
  | "pneu_frente"
  | "pneu_tras"
  | "pneus"
  | "travoes"
  | "corrente"
  | "inspecao"
  | "outro";

// ── Procedimentos (Fase 7 — motor de regras) ────────────────────────────────
export type ProcedimentoGatilho =
  | "coima_registada"
  | "portagem_registada"
  | "seguro_registado"
  | "seguro_a_expirar"
  | "manutencao_a_vencer"
  | "doc_motorista_a_expirar"
  | "pagamento_a_vencer";
export type ProcedimentoAcao = "comunicar_motorista" | "alertar_gestor";
export type ProcedimentoCanal = "preparar" | "whatsapp" | "sms" | "telegram" | "email";
export type ProcedimentoModo = "manual" | "auto";

// ── Acerto com parceiros (Fase 3) ───────────────────────────────────────────
export type AcertoEstado = "rascunho" | "fechado" | "pago" | "parcial";
/** `perda` é só informativa no extrato — nunca entra no líquido. */

/**
 * O que aconteceu a UMA moto numa semana do mês. O extrato passa a mostrar as
 * 4 ou 5 semanas TODAS, e não só as que geraram receita — sem isto, o parceiro
 * via um mês com duas linhas e não sabia se as outras semanas foram paragem,
 * calote ou esquecimento.
 */
export type SemanaEstado = "paga" | "parcial" | "por_cobrar" | "perda" | "isenta" | "parada";

export interface SemanaMoto {
  veiculo_id: string;
  matricula: string | null;
  /** "Semana 2 de agosto" */
  rotulo: string;
  /** Domingo e sábado da semana (ISO), para mostrar as datas reais. */
  inicio: string;
  fim: string;
  estado: SemanaEstado;
  /** Recebido nessa semana (0 quando não entrou nada). */
  valor: number;
  /**
   * Quem recebeu o dinheiro desta semana. Null quando não entrou nada. "misto"
   * quando a semana foi paga em parte à GoScooters e em parte ao parceiro.
   */
  recebido: "goscooters" | "parceiro" | "misto" | null;
  /** Preço da semana, para se ver o que se deixou de receber. */
  devido: number;
  desconto: number;
  motorista: string | null;
  /** Motivo do desconto ou da perda. */
  nota: string | null;
  /**
   * Intervenções de manutenção nesta semana, cada uma com a sua fatura. É uma
   * lista (e não texto) para cada intervenção poder ser clicada até ao
   * documento — o parceiro não tem de acreditar, pode ver.
   */
  manutencao: ManutencaoNaSemana[];
}

/** Uma intervenção de manutenção, com ligação à fatura que a comprova. */
export interface ManutencaoNaSemana {
  /** "óleo 05/08" */
  rotulo: string;
  /** Documento da despesa que a pagou (null se não houver). */
  documento_url: string | null;
}

export type AcertoLinhaTipo = "receita" | "despesa" | "comissao" | "ajuste" | "perda";

// Declarados como `type` e não `interface` de propósito: interfaces não recebem
// index signature implícita, por isso falham o `Record<string, unknown>` que o
// GenericTable do supabase-js exige — e o schema todo colapsa para `never`.
/** Períodos de aluguer oferecidos. */
export type Periodo = "dia" | "semana" | "mes";

export type Moto = {
  id: string;
  modelo: string;
  cilindrada: number | null;
  matricula: string | null;
  /** Preço por período. Null significa que a mota não é oferecida nesse período. */
  preco_dia: string | null;
  preco_semana: string | null;
  preco_mes: string | null;
  estado: MotoEstado;
  disponivel_em: string | null;
  foto_urls: string[] | null;
  /** Vídeo de apresentação no Storage. Null = sem vídeo. */
  video_url: string | null;
  descricao: string | null;
  ativo: boolean;
  created_at: string;
  // ── Campos de frota (Fase 1) ──
  tipo_veiculo: TipoVeiculo;
  nome_interno: string | null;
  marca: string | null;
  ano: number | null;
  cor: string | null;
  proprietario_id: string | null;
  estado_operacional: EstadoOperacional;
  km_atual: number | null;
  km_atual_em: string | null;
  proxima_manutencao_km: number | null;
  data_aquisicao: string | null;
  valor_aquisicao: string | null;
  /** Comissão % específica deste veículo. Null = usa a base do proprietário. */
  comissao_valor_override: string | null;
  matricula_norm: string | null;
  updated_at: string | null;
}

export type Proprietario = {
  id: string;
  nome: string;
  tipo_pessoa: TipoPessoa;
  tipo_parceiro: TipoParceiro;
  nif: string | null;
  email: string | null;
  telefone: string | null;
  telefone_e164: string | null;
  iban: string | null;
  morada: string | null;
  /** Frota própria do GoScooters: não gera acerto com terceiros. */
  eh_goscooters: boolean;
  /** true = a renda é paga direto na conta do parceiro (inverte o acerto). */
  recebe_pagamento_direto: boolean;
  saldo_inicial: string;
  comissao_modelo: ComissaoModelo | null;
  /** % de comissão base (ou valor fixo, conforme o modelo). */
  comissao_valor: string | null;
  imputa_gps: boolean;
  imputa_seguro: boolean;
  imputa_manutencao: boolean;
  ativo: boolean;
  created_at: string;
  // Costuras do portal de parceiro futuro (sem lógica associada agora).
  auth_user_id: string | null;
  portal_ativo: boolean;
  import_notion_id: string | null;
};

export type PedidoAluguer = {
  id: string;
  moto_id: string | null;
  nome: string;
  telefone: string;
  email: string | null;
  plataforma: string | null;
  data_inicio: string | null;
  /** Número de unidades do período escolhido (3 + periodo "semana" = 3 semanas). */
  duracao: number | null;
  periodo: Periodo | null;
  mensagem: string | null;
  estado: PedidoEstado;
  created_at: string;
  /** Momento do consentimento RGPD. Null nos pedidos anteriores à sua introdução. */
  consentimento_em: string | null;
  /** Cliente real ligado a este lead, quando o funil fecha. */
  motorista_id: string | null;
}

export type ContratoAluguer = {
  id: string;
  numero: string;
  pedido_aluguer_id: string | null;
  motorista_id: string;
  // Nulos enquanto 'pre_contrato'; obrigatórios a partir de 'rascunho'
  // (invariante contrato_pronto_se_ativo).
  veiculo_id: string | null;
  /** Dono congelado à data — preserva o histórico se o veículo mudar de dono. */
  proprietario_id: string | null;
  periodicidade: Periodicidade;
  /** Dia da semana do vencimento em ISO (1=segunda … 7=domingo). */
  dia_vencimento: number | null;
  preco_periodo: string | null;
  caucao: string | null;
  ancora_vencimento: string | null;
  data_inicio: string | null;
  data_fim_prevista: string | null;
  data_fim: string | null;
  km_inicio: number | null;
  km_fim: number | null;
  km_rodados: number | null;
  estado: ContratoEstado;
  contrato_assinado_url: string | null;
  assinado_em: string | null;
  observacoes: string | null;
  import_notion_id: string | null;
  created_at: string;
  updated_at: string | null;
};

/** Notificação interna e acionável do gestor (caixa/inbox). */
export type Notificacao = {
  id: string;
  tipo: string; // slug do evento (ex.: 'pre_contrato_sem_mota')
  titulo: string;
  detalhe: string | null;
  href: string | null; // deep-link para a ação
  entidade: string | null;
  entidade_id: string | null;
  estado: NotificacaoEstado;
  feita_por: string | null;
  feita_em: string | null;
  created_at: string;
};

export type Vistoria = {
  id: string;
  contrato_id: string;
  tipo: VistoriaTipo;
  realizada_em: string;
  km: number | null;
  nivel_combustivel: number | null;
  video_url: string | null;
  foto_urls: string[] | null;
  checklist: unknown | null;
  notas: string | null;
  assinatura_cliente_url: string | null;
  created_at: string;
};

export type KmRegisto = {
  id: string;
  veiculo_id: string;
  km: number;
  data: string;
  fonte: KmFonte;
  contrato_id: string | null;
  created_at: string;
};

export type Cobranca = {
  id: string;
  numero: string;
  contrato_id: string;
  motorista_id: string;
  veiculo_id: string;
  proprietario_id: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  data_vencimento: string;
  tipo: CobrancaTipo;
  valor_devido: string;
  valor_pago: string;
  /** Abatimento por serviço não prestado (ex.: moto avariada). Não é perda. */
  desconto: string;
  desconto_motivo: string | null;
  estado_liquidacao: EstadoLiquidacao;
  /** Quando foi dada como perda (só em estado 'incobravel'). */
  incobravel_em: string | null;
  incobravel_motivo: string | null;
  observacoes: string | null;
  created_at: string;
};

export type Pagamento = {
  id: string;
  motorista_id: string;
  valor: string;
  data_recebimento: string;
  metodo: PagamentoMetodo | null;
  referencia: string | null;
  comprovativo_url: string | null;
  origem: PagamentoOrigem;
  /** Quem recebeu o dinheiro: a GoScooters ou o parceiro (conta dele). */
  recebido_por: PagamentoRecebidoPor;
  observacoes: string | null;
  created_at: string;
};

export type PagamentoCobranca = {
  id: string;
  pagamento_id: string;
  cobranca_id: string;
  valor_alocado: string;
  created_at: string;
};

export type Despesa = {
  id: string;
  veiculo_id: string | null;
  categoria: DespesaCategoria;
  descricao: string | null;
  valor: string;
  iva: string | null;
  valor_total: string;
  data_despesa: string;
  data_vencimento: string | null;
  estado_pagamento: EstadoPagamentoDespesa;
  imputar_a: ImputarA;
  proprietario_id: string | null;
  motorista_id: string | null;
  contrato_id: string | null;
  recorrente: boolean;
  fornecedor: string | null;
  referencia_externa: string | null;
  detalhe: unknown | null;
  documento_id: string | null;
  origem: DespesaOrigem;
  // Coima (fase3f): data da infração, pontos e elo à dívida gerada ao motorista.
  data_infracao: string | null;
  pontos: number | null;
  cobranca_id: string | null;
  created_at: string;
};

// ── Seguros e Manutenção (Fase 6) ───────────────────────────────────────────
export type Seguro = {
  id: string;
  veiculo_id: string;
  seguradora: string | null;
  apolice: string | null;
  tipo: SeguroTipo;
  data_inicio: string | null;
  data_fim: string;
  premio: string | null;
  periodicidade: SeguroPeriodicidade;
  quem_paga: ImputarA;
  estado: SeguroEstado;
  observacoes: string | null;
  detalhe: unknown | null;
  despesa_id: string | null;
  documento_id: string | null;
  origem: "manual" | "ingestao";
  created_at: string;
  updated_at: string;
};

// Vista vw_seguro_estado: seguro + dias para expirar (derivado).
export type SeguroEstadoView = Seguro & {
  dias_para_expirar: number;
  expirado: boolean;
};

export type Manutencao = {
  id: string;
  veiculo_id: string;
  tipo: ManutencaoTipo;
  data: string;
  km: number | null;
  oficina: string | null;
  custo: string | null;
  proxima_km: number | null;
  proxima_data: string | null;
  observacoes: string | null;
  detalhe: unknown | null;
  despesa_id: string | null;
  documento_id: string | null;
  origem: "manual" | "ingestao";
  created_at: string;
};

export type Procedimento = {
  id: string;
  nome: string;
  gatilho: ProcedimentoGatilho;
  acao: ProcedimentoAcao;
  canal: ProcedimentoCanal;
  modo: ProcedimentoModo;
  condicoes: { valor_min?: number; categoria?: string; dias_antes?: number; km_antes?: number } | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

// Vista vw_manutencao_proxima: última intervenção planeada por (veículo, tipo).
export type ManutencaoProximaView = {
  veiculo_id: string;
  tipo: ManutencaoTipo;
  ultima_data: string;
  ultima_km: number | null;
  proxima_km: number | null;
  proxima_data: string | null;
  matricula: string | null;
  km_atual: number | null;
  estado_operacional: string;
  km_em_falta: number | null;
  dias_em_falta: number | null;
};

export type Acerto = {
  id: string;
  proprietario_id: string;
  competencia_mes: string;
  periodo_inicio: string;
  periodo_fim: string;
  receita_total: string;
  /** Parte da receita cobrada pela GoScooters (0 se paga direto ao parceiro). */
  receita_goscooters: string;
  comissao_total: string;
  despesa_total: string;
  /** Renda paga direto ao parceiro (o líquido fica negativo = parceiro deve). */
  pago_direto: boolean;
  liquido: string;
  estado: AcertoEstado;
  fechado_em: string | null;
  fechado_por: string | null;
  observacoes: string | null;
  created_at: string;
  /** Linha do tempo semanal congelada no fecho (informativa). */
  semanas: unknown;
};

export type RegrasAluguer = {
  id: string;
  versao: string;
  idioma: string; // 'pt' | 'en' — versão ativa por língua
  conteudo: string;
  hash: string;
  ativa: boolean;
  criado_por: string | null;
  created_at: string;
};

export type EntregaSessaoEstado =
  | "enviado"
  | "aberto"
  | "docs_carregados"
  | "concluido"
  | "expirado"
  | "cancelado";

export type EntregaSessao = {
  id: string;
  token_hash: string;
  contrato_id: string | null;
  motorista_id: string | null;
  estado: EntregaSessaoEstado;
  dados: unknown | null;
  consentimento_em: string | null;
  expira_em: string;
  concluido_em: string | null;
  created_at: string;
};

export type AcertoLinha = {
  id: string;
  acerto_id: string;
  tipo: AcertoLinhaTipo;
  cobranca_id: string | null;
  despesa_id: string | null;
  veiculo_id: string | null;
  matricula_snapshot: string | null;
  descricao: string | null;
  valor: string;
  created_at: string;
};

/** Ajuste manual num acerto (valor avulso: bónus, correção, dedução). fase10. */
export type AcertoAjuste = {
  id: string;
  proprietario_id: string;
  competencia_mes: string; // 'YYYY-MM-01'
  descricao: string;
  valor: string; // assinado: + soma ao líquido, − desconta
  criado_por: string | null;
  created_at: string;
};

/** Semana coberta por um pagamento, congelada no comprovativo emitido. */
export type ComprovativoSemana = {
  matricula: string | null;
  inicio: string;
  fim: string;
  tipo: string | null;
  valor: string;
};

/**
 * Comprovativo de pagamento: documento de gestão EMITIDO ao motorista (não é
 * fatura nem recibo fiscal). Guarda snapshot do destinatário e do total — o que
 * saiu impresso não pode mudar depois. Cobre 1..N pagamentos (ver itens).
 */
export type ComprovativoPagamento = {
  id: string;
  numero: string; // 'CP-000123' — referência de gestão, gerada pela BD
  motorista_id: string | null;
  motorista_nome: string;
  motorista_nif: string | null;
  data_emissao: string;
  valor_total: string;
  idioma: "pt" | "en";
  observacoes: string | null;
  anulado_em: string | null;
  anulado_motivo: string | null;
  criado_por: string | null;
  created_at: string;
};

/** Um pagamento incluído num comprovativo, com os valores congelados. */
export type ComprovativoItem = {
  id: string;
  comprovativo_id: string;
  /** Anulável: sobrevive ao estorno, que apaga o pagamento. */
  pagamento_id: string | null;
  data_recebimento: string;
  valor: string;
  metodo: string | null;
  referencia: string | null;
  semanas: ComprovativoSemana[];
  created_at: string;
};

export type Motorista = {
  id: string;
  nome: string;
  telefone: string;
  /** Só dígitos, para reconhecer o mesmo número escrito de formas diferentes. */
  telefone_digitos: string;
  email: string | null;
  plataforma: string | null;
  notas: string | null;
  created_at: string;
  // ── Perfil KYC (Fase 1) ──
  /** Telefone em formato E.164 (+351...), chave de dedup e roteamento. */
  telefone_e164: string | null;
  telefones_extra: string[] | null;
  nif: string | null;
  nif_valido: boolean | null;
  /** Código ISO 3166-1 alpha-2 (PT, BR, IN...). */
  pais_iso: string | null;
  data_nascimento: string | null;
  doc_id_tipo: DocIdTipo | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null;
  doc_urls: string[] | null;
  carta_numero: string | null;
  carta_categoria: string | null;
  carta_pais: string | null;
  carta_validade: string | null;
  morada_linha1: string | null;
  codigo_postal: string | null;
  localidade: string | null;
  estado: EstadoMotorista;
  origem: OrigemMotorista | null;
  idioma_preferido: string;
  iban: string | null;
  telefone_mbway: string | null;
  /** Registo importado com dados por confirmar (placeholder, telefone incerto). */
  precisa_revisao: boolean;
  import_notion_id: string | null;
};

export type Avaliacao = {
  id: string;
  motorista_id: string;
  tipo: AvaliacaoTipo;
  nota: number | null;
  comentario: string | null;
  data_aluguer: string | null;
  created_at: string;
};

export interface Database {
  public: {
    Tables: {
      moto: {
        Row: Moto;
        // Campos com default ou nulláveis são opcionais no insert (como o
        // Supabase gera). matricula_norm é gerada e updated_at tem default —
        // nunca se inserem. Só `modelo` é sempre obrigatório.
        Insert: Partial<
          Omit<Moto, "id" | "created_at" | "matricula_norm" | "updated_at">
        > & {
          modelo: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Omit<Moto, "id" | "created_at" | "matricula_norm" | "updated_at">
        > & {
          id?: string;
          created_at?: string;
        };
        // O supabase-js exige esta chave para inferir os tipos das queries.
        // Sem ela, as operações resolvem para `never` e o build falha.
        Relationships: [];
      };
      proprietario: {
        Row: Proprietario;
        Insert: Partial<Omit<Proprietario, "id" | "created_at">> & {
          nome: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Proprietario, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      pedido_aluguer: {
        Row: PedidoAluguer;
        // Nulláveis/defaults são opcionais; só nome e telefone são obrigatórios.
        Insert: Partial<Omit<PedidoAluguer, "id" | "created_at">> & {
          nome: string;
          telefone: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PedidoAluguer, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pedido_aluguer_moto_id_fkey";
            columns: ["moto_id"];
            isOneToOne: false;
            referencedRelation: "moto";
            referencedColumns: ["id"];
          },
        ];
      };
      motorista: {
        Row: Motorista;
        // Campos KYC com default/nulláveis são opcionais; só `nome` é obrigatório.
        Insert: Partial<Omit<Motorista, "id" | "created_at">> & {
          nome: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Motorista, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      avaliacao: {
        Row: Avaliacao;
        Insert: Omit<Avaliacao, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Avaliacao, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "avaliacao_motorista_id_fkey";
            columns: ["motorista_id"];
            isOneToOne: false;
            referencedRelation: "motorista";
            referencedColumns: ["id"];
          },
        ];
      };
      contrato_aluguer: {
        Row: ContratoAluguer;
        // numero (default), km_rodados (gerado) e updated_at (default) nunca se inserem.
        // Só motorista_id é obrigatório — um pré-contrato nasce sem mota/preço/data.
        Insert: Partial<
          Omit<ContratoAluguer, "id" | "created_at" | "updated_at" | "numero" | "km_rodados">
        > & {
          motorista_id: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Omit<ContratoAluguer, "id" | "created_at" | "updated_at" | "numero" | "km_rodados">
        > & { id?: string; created_at?: string };
        Relationships: [];
      };
      vistoria: {
        Row: Vistoria;
        Insert: Partial<Omit<Vistoria, "id" | "created_at">> & {
          contrato_id: string;
          tipo: VistoriaTipo;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Vistoria, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      km_registo: {
        Row: KmRegisto;
        Insert: Partial<Omit<KmRegisto, "id" | "created_at">> & {
          veiculo_id: string;
          km: number;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<KmRegisto, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      cobranca: {
        Row: Cobranca;
        Insert: Partial<
          Omit<Cobranca, "id" | "created_at" | "numero" | "valor_pago">
        > & {
          contrato_id: string;
          motorista_id: string;
          veiculo_id: string;
          periodo_inicio: string;
          periodo_fim: string;
          data_vencimento: string;
          valor_devido: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Cobranca, "id" | "created_at" | "numero">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      pagamento: {
        Row: Pagamento;
        Insert: Partial<Omit<Pagamento, "id" | "created_at">> & {
          motorista_id: string;
          valor: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Pagamento, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      pagamento_cobranca: {
        Row: PagamentoCobranca;
        Insert: Partial<Omit<PagamentoCobranca, "id" | "created_at">> & {
          pagamento_id: string;
          cobranca_id: string;
          valor_alocado: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PagamentoCobranca, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      despesa: {
        Row: Despesa;
        // valor_total é gerado — nunca se insere.
        Insert: Partial<Omit<Despesa, "id" | "created_at" | "valor_total">> & {
          categoria: DespesaCategoria;
          valor: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Despesa, "id" | "created_at" | "valor_total">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      seguro: {
        Row: Seguro;
        Insert: Partial<Omit<Seguro, "id" | "created_at" | "updated_at">> & {
          veiculo_id: string;
          data_fim: string;
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Seguro, "id" | "created_at" | "updated_at">> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      manutencao: {
        Row: Manutencao;
        Insert: Partial<Omit<Manutencao, "id" | "created_at">> & {
          veiculo_id: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Manutencao, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      procedimento: {
        Row: Procedimento;
        Insert: Partial<Omit<Procedimento, "id" | "created_at" | "updated_at">> & {
          nome: string;
          gatilho: ProcedimentoGatilho;
          acao: ProcedimentoAcao;
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Procedimento, "id" | "created_at" | "updated_at">> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      acerto: {
        Row: Acerto;
        Insert: Partial<Omit<Acerto, "id" | "created_at">> & {
          proprietario_id: string;
          competencia_mes: string;
          periodo_inicio: string;
          periodo_fim: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Acerto, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      acerto_linha: {
        Row: AcertoLinha;
        Insert: Partial<Omit<AcertoLinha, "id" | "created_at">> & {
          acerto_id: string;
          tipo: AcertoLinhaTipo;
          valor: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<AcertoLinha, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      comprovativo_pagamento: {
        Row: ComprovativoPagamento;
        // `numero` é gerado pela BD (sequence) — nunca se escreve do TypeScript.
        Insert: Partial<Omit<ComprovativoPagamento, "id" | "numero" | "created_at">> & {
          motorista_nome: string;
          valor_total: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ComprovativoPagamento, "id" | "numero" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      comprovativo_pagamento_item: {
        Row: ComprovativoItem;
        Insert: Partial<Omit<ComprovativoItem, "id" | "created_at">> & {
          comprovativo_id: string;
          data_recebimento: string;
          valor: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ComprovativoItem, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      acerto_ajuste: {
        Row: AcertoAjuste;
        Insert: Partial<Omit<AcertoAjuste, "id" | "created_at">> & {
          proprietario_id: string;
          competencia_mes: string;
          descricao: string;
          valor: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<AcertoAjuste, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      regras_aluguer: {
        Row: RegrasAluguer;
        Insert: Partial<Omit<RegrasAluguer, "id" | "created_at">> & {
          versao: string;
          conteudo: string;
          hash: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<RegrasAluguer, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      entrega_sessao: {
        Row: EntregaSessao;
        Insert: Partial<Omit<EntregaSessao, "id" | "created_at">> & {
          token_hash: string;
          expira_em: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<EntregaSessao, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notificacao: {
        Row: Notificacao;
        Insert: Partial<Omit<Notificacao, "id" | "created_at">> & {
          tipo: string;
          titulo: string;
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Notificacao, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    // Forma canónica gerada pelo Supabase. `Record<string, never>` não satisfaz
    // o GenericSchema do supabase-js e faz o schema inteiro colapsar para `never`.
    Views: {
      vw_cobranca_estado: {
        Row: Cobranca & { em_atraso: boolean; em_falta: string };
        Relationships: [];
      };
      vw_seguro_estado: {
        Row: SeguroEstadoView;
        Relationships: [];
      };
      vw_manutencao_proxima: {
        Row: ManutencaoProximaView;
        Relationships: [];
      };
    };
    Functions: {
      fn_gerar_cobrancas: {
        Args: { p_contrato_id: string; p_ate: string };
        Returns: number;
      };
    };
    Enums: {
      estado_moto: MotoEstado;
      estado_pedido: PedidoEstado;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
