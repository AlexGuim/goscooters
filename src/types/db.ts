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
  | "rascunho"
  | "ativo"
  | "pendente_fecho"
  | "suspenso"
  | "concluido"
  | "cancelado";
export type VistoriaTipo = "entrega" | "recolha" | "intermedia";
export type KmFonte = "entrega" | "recolha" | "manutencao" | "manual";
export type CobrancaTipo = "renda" | "caucao" | "extra";
export type EstadoLiquidacao =
  | "por_liquidar"
  | "parcial"
  | "liquidada"
  | "isenta"
  | "anulada";
export type PagamentoMetodo =
  | "transferencia"
  | "mbway"
  | "numerario"
  | "multibanco"
  | "outro";
export type PagamentoOrigem = "manual" | "ingestao" | "webhook";

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
  veiculo_id: string;
  /** Dono congelado à data — preserva o histórico se o veículo mudar de dono. */
  proprietario_id: string | null;
  periodicidade: Periodicidade;
  /** Dia da semana do vencimento em ISO (1=segunda … 7=domingo). */
  dia_vencimento: number | null;
  preco_periodo: string;
  caucao: string | null;
  ancora_vencimento: string | null;
  data_inicio: string;
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
  estado_liquidacao: EstadoLiquidacao;
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
        Insert: Partial<
          Omit<ContratoAluguer, "id" | "created_at" | "updated_at" | "numero" | "km_rodados">
        > & {
          motorista_id: string;
          veiculo_id: string;
          data_inicio: string;
          preco_periodo: string;
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
    };
    // Forma canónica gerada pelo Supabase. `Record<string, never>` não satisfaz
    // o GenericSchema do supabase-js e faz o schema inteiro colapsar para `never`.
    Views: { [_ in never]: never };
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
