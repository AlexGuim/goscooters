export type MotoEstado = "disponivel" | "alugada" | "manutencao";
export type PedidoEstado = "novo" | "contactado" | "fechado" | "perdido";

export interface Moto {
  id: string;
  modelo: string;
  cilindrada: number | null;
  matricula: string | null;
  preco_mes: string;
  estado: MotoEstado;
  disponivel_em: string | null;
  foto_urls: string[] | null;
  descricao: string | null;
  ativo: boolean;
  created_at: string;
}

export interface PedidoAluguer {
  id: string;
  moto_id: string | null;
  nome: string;
  telefone: string;
  email: string | null;
  plataforma: string | null;
  data_inicio: string | null;
  duracao_meses: number | null;
  mensagem: string | null;
  estado: PedidoEstado;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      moto: {
        Row: Moto;
        Insert: Omit<Moto, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Moto, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
      };
      pedido_aluguer: {
        Row: PedidoAluguer;
        Insert: Omit<PedidoAluguer, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PedidoAluguer, "id" | "created_at">> & {
          id?: string;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      estado_moto: MotoEstado;
      estado_pedido: PedidoEstado;
    };
  };
}
