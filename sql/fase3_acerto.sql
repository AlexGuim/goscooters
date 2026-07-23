-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 3b — ACERTO mensal por parceiro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr DEPOIS de fase3_despesas.sql. Só cria tabelas novas.
--
-- Fórmula do acerto (a validar): para um parceiro e um mês —
--   Receita  = renda COBRADA (valor pago) das cobranças dos veículos do
--              parceiro cujo vencimento cai no mês.
--   Comissão = por veículo, receita × comissão% do veículo (override do veículo
--              ou a % base do proprietário). É a receita da GoScooters.
--   Despesas = despesas imputadas ao PROPRIETÁRIO, dos seus veículos, no mês.
--   Líquido  = Receita − Comissão − Despesas  (o que se transfere ao parceiro).
--
-- Ao FECHAR, cada linha é CONGELADA em acerto_linha: o extrato de um mês nunca
-- muda, mesmo que se corrija uma fatura antiga — a falha exacta do Sheets.

create table if not exists acerto (
  id             uuid primary key default gen_random_uuid(),
  proprietario_id uuid not null references proprietario (id),
  competencia_mes date not null,          -- primeiro dia do mês
  periodo_inicio date not null,
  periodo_fim    date not null,
  receita_total  numeric not null default 0,
  comissao_total numeric not null default 0,
  despesa_total  numeric not null default 0,
  liquido        numeric not null default 0,
  estado         text not null default 'fechado'
                 check (estado in ('rascunho', 'fechado', 'pago', 'parcial')),
  fechado_em     timestamptz default now(),
  fechado_por    text,
  observacoes    text,
  created_at     timestamptz not null default now(),
  unique (proprietario_id, competencia_mes)
);

create index if not exists acerto_proprietario_idx on acerto (proprietario_id);

-- Snapshot congelado de cada item incluído no acerto.
create table if not exists acerto_linha (
  id           uuid primary key default gen_random_uuid(),
  acerto_id    uuid not null references acerto (id) on delete cascade,
  tipo         text not null check (tipo in ('receita', 'despesa', 'comissao')),
  cobranca_id  uuid references cobranca (id),
  despesa_id   uuid references despesa (id),
  veiculo_id   uuid references moto (id),
  matricula_snapshot text,
  descricao    text,
  -- Receita positiva; despesa e comissão negativas.
  valor        numeric not null,
  created_at   timestamptz not null default now()
);

create index if not exists acerto_linha_acerto_idx on acerto_linha (acerto_id);

alter table acerto enable row level security;
alter table acerto_linha enable row level security;
