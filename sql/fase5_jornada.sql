-- ═══════════════════════════════════════════════════════════════════════════
-- F1 da jornada: o contrato passa a ser a espinha dorsal, estendido para trás.
--
-- Em vez de nascer só quando já há mota+preço+data, o contrato passa a poder
-- nascer no REGISTO como 'pre_contrato' — carregando apenas o motorista. Toda a
-- jornada (do link à recolha) fica a ser UM objeto, com estado e próxima ação.
-- Acrescenta também a caixa de notificações internas (inbox do gestor).
--
-- Correr no SQL Editor do Supabase. Idempotente.
-- ANTES de correr, confirmar que não há contratos legados com campos nulos:
--   select count(*) from contrato_aluguer
--    where veiculo_id is null or preco_periodo is null or data_inicio is null;
--   -- deve dar 0 (senão, esses violam o novo CHECK contrato_pronto_se_ativo).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Novo estado 'pre_contrato' no CHECK do estado.
alter table contrato_aluguer drop constraint if exists contrato_aluguer_estado_check;
alter table contrato_aluguer add constraint contrato_aluguer_estado_check
  check (estado in ('pre_contrato', 'rascunho', 'ativo', 'pendente_fecho',
                    'suspenso', 'concluido', 'cancelado'));

-- 2. Largar o NOT NULL de mota/preço/data — um pré-contrato ainda não os tem.
alter table contrato_aluguer alter column veiculo_id drop not null;
alter table contrato_aluguer alter column preco_periodo drop not null;
alter table contrato_aluguer alter column data_inicio drop not null;

-- 3. Invariante: FORA do pré-contrato/cancelado, mota+preço+data são obrigatórios
--    (mesmo padrão do moto_preco_se_ativo). 'cancelado' é isento para permitir
--    DESCARTAR uma jornada abandonada que nunca chegou a ter mota (senão ficaria
--    presa: não se pode concluir nem cancelar um pré-contrato vazio).
alter table contrato_aluguer drop constraint if exists contrato_pronto_se_ativo;
alter table contrato_aluguer add constraint contrato_pronto_se_ativo
  check (
    estado in ('pre_contrato', 'cancelado')
    or (veiculo_id is not null and preco_periodo is not null and data_inicio is not null)
  );

-- 4. Um pré-contrato aberto por motorista (evita jornadas duplicadas).
create unique index if not exists contrato_um_pre_por_motorista
  on contrato_aluguer (motorista_id) where estado = 'pre_contrato';

-- 5. Caixa de notificações internas (inbox partilhado do gestor). Best-effort:
--    nunca reverte a operação de negócio — espelha o notifications.ts.
create table if not exists notificacao (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,          -- slug do evento (ex.: 'pre_contrato_sem_mota')
  titulo      text not null,
  detalhe     text,
  href        text,                   -- deep-link para a ação
  entidade    text,                   -- ex.: 'contrato', 'motorista', 'acerto'
  entidade_id uuid,
  estado      text not null default 'nova' check (estado in ('nova', 'lida', 'feita')),
  feita_por   uuid,                   -- auth uid (só auditoria)
  feita_em    timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notificacao_estado_idx on notificacao (estado, created_at desc);
-- Não repetir a MESMA notificação enquanto estiver por resolver (idempotência dos
-- eventos e das varreduras derivadas). entidade_id nulo → não deduplica (ok).
create unique index if not exists notificacao_unica_aberta
  on notificacao (tipo, entidade_id) where estado <> 'feita';

alter table notificacao enable row level security;
