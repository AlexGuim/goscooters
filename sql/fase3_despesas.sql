-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 3a — DESPESAS por veículo (manutenção, portagens, coimas, seguro, GPS)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase. Só cria a tabela nova. Convenções do
-- projeto: text + check, RLS ligado sem política pública.
--
-- Livro-razão único de CUSTOS. Cada despesa vincula-se a um veículo (ou é custo
-- de estrutura, veiculo_id null) e a `imputar_a` decide QUEM a suporta — é isso
-- que, mais tarde, o acerto com o parceiro vai usar.

create table if not exists despesa (
  id            uuid primary key default gen_random_uuid(),
  veiculo_id    uuid references moto (id),          -- null = custo de estrutura

  categoria     text not null
                check (categoria in ('manutencao', 'portagem', 'coima',
                                     'seguro', 'gps', 'comissao', 'outro')),
  descricao     text,

  valor         numeric not null,
  iva           numeric,
  valor_total   numeric generated always as (valor + coalesce(iva, 0)) stored,

  data_despesa  date not null default current_date,  -- competência
  data_vencimento date,
  estado_pagamento text not null default 'pendente'
                check (estado_pagamento in ('pendente', 'parcial', 'paga', 'isenta')),

  -- Quem SUPORTA o custo — decide de que lado do acerto cai.
  imputar_a     text not null default 'goscooters'
                check (imputar_a in ('goscooters', 'proprietario', 'motorista')),

  -- Snapshot do dono à data (o acerto usa isto, não o dono atual do veículo).
  proprietario_id uuid references proprietario (id),
  motorista_id  uuid references motorista (id),      -- ex.: coima re-faturada
  contrato_id   uuid references contrato_aluguer (id),

  recorrente    boolean not null default false,      -- GPS/seguro
  fornecedor    text,
  referencia_externa text,                            -- nº fatura/auto (dedup)

  -- Campos específicos por categoria (oficina/km/itens; nº auto/prazos) sem
  -- multiplicar tabelas até haver necessidade real.
  detalhe       jsonb,

  -- Costura para a ingestão de documentos futura (sem FK rígida agora).
  documento_id  uuid,
  origem        text not null default 'manual'
                check (origem in ('manual', 'recorrente', 'ingestao')),

  created_at    timestamptz not null default now()
);

create index if not exists despesa_veiculo_idx on despesa (veiculo_id);
create index if not exists despesa_categoria_idx on despesa (categoria);
create index if not exists despesa_data_idx on despesa (data_despesa);
create index if not exists despesa_proprietario_idx on despesa (proprietario_id);

alter table despesa enable row level security;
