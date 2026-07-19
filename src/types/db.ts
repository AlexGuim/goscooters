export type MotoEstado = "disponivel" | "alugada" | "manutencao";
export type PedidoEstado = "novo" | "contactado" | "fechado" | "perdido";

// Declarados como `type` e não `interface` de propósito: interfaces não recebem
// index signature implícita, por isso falham o `Record<string, unknown>` que o
// GenericTable do supabase-js exige — e o schema todo colapsa para `never`.
export type Moto = {
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

export type PedidoAluguer = {
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
        // O supabase-js exige esta chave para inferir os tipos das queries.
        // Sem ela, as operações resolvem para `never` e o build falha.
        Relationships: [];
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
    };
    // Forma canónica gerada pelo Supabase. `Record<string, never>` não satisfaz
    // o GenericSchema do supabase-js e faz o schema inteiro colapsar para `never`.
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      estado_moto: MotoEstado;
      estado_pedido: PedidoEstado;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
