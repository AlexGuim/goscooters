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
--
-- NOTA: estas tabelas já existem na BD (foram criadas fora do repo). Este DDL é
-- para REPRODUTIBILIDADE — reconstruído a partir dos tipos (src/types/db.ts) e
-- das ações (src/actions/acertoActions.ts). É `if not exists`, por isso não
-- altera as tabelas existentes; ao recriar do zero, confirmar no Supabase os
-- pontos marcados «# conferir».

-- acerto: fecho mensal por parceiro (o extrato congelado do mês).
create table if not exists acerto (
  id                 uuid primary key default gen_random_uuid(),
  proprietario_id    uuid not null references proprietario (id),
  competencia_mes    date not null,                          -- 1.º dia do mês ('YYYY-MM-01')  # conferir date vs text
  periodo_inicio     date not null,
  periodo_fim        date not null,
  receita_total      numeric not null default 0,
  receita_goscooters numeric not null default 0,             -- fase3d (confirmado)
  comissao_total     numeric not null default 0,
  despesa_total      numeric not null default 0,
  pago_direto        boolean not null default false,         -- fase3d (confirmado)
  liquido            numeric not null default 0,
  estado             text not null default 'rascunho'
                     check (estado in ('rascunho', 'fechado', 'pago', 'parcial')),
  fechado_em         timestamptz default now(),              -- # conferir (lido pela UI, nunca escrito pela app)
  fechado_por        text,
  observacoes        text,
  created_at         timestamptz not null default now(),
  unique (proprietario_id, competencia_mes)                  -- um acerto por parceiro e mês (anti-duplicado no fecho)
);

-- acerto_linha: linhas congeladas do extrato (não recalculadas — snapshot no fecho).
create table if not exists acerto_linha (
  id                 uuid primary key default gen_random_uuid(),
  acerto_id          uuid not null references acerto (id) on delete cascade,
  tipo               text not null check (tipo in ('receita', 'despesa', 'comissao')),
  cobranca_id        uuid references cobranca (id),          -- # conferir on delete (snapshot desacopla via matricula_snapshot)
  despesa_id         uuid references despesa (id),
  veiculo_id         uuid references moto (id),
  matricula_snapshot text,                                   -- preserva a matrícula mesmo que a mota mude/saia
  descricao          text,
  valor              numeric not null,
  created_at         timestamptz not null default now()
);
create index if not exists acerto_linha_acerto_id_idx on acerto_linha (acerto_id);

