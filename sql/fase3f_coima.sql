-- ═══════════════════════════════════════════════════════════════════════════
-- Coimas/multas: reembolso automático ao motorista (não é receita, sem comissão)
--
-- Ao registar uma coima, o sistema descobre quem conduzia a mota na DATA DA
-- INFRAÇÃO (o contrato ativo do veículo nessa data), imputa a despesa ao
-- motorista e gera-lhe uma dívida (cobrança tipo='extra'). A GoScooters só
-- adianta o pagamento à autoridade — depois é reembolsada; por isso não conta
-- como receita nem gera comissão (o acerto só olha renda + imputar_a='proprietario').
--
-- Correr no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Campos da coima na despesa. (motorista_id e contrato_id já existem em
--    fase3_despesas.sql — aqui só a data da infração, os pontos e o elo à dívida.)
alter table despesa add column if not exists data_infracao date;
alter table despesa add column if not exists pontos smallint;
alter table despesa add column if not exists cobranca_id uuid references cobranca (id);

comment on column despesa.data_infracao is
  'Data em que a infração ocorreu (≠ data do auto/documento). Usa-se para achar o condutor.';
comment on column despesa.pontos is 'Pontos da carta associados à infração, se aplicável.';
comment on column despesa.cobranca_id is 'Dívida (cobranca tipo=extra) gerada ao motorista por esta coima.';

create index if not exists despesa_motorista_idx on despesa (motorista_id);
create index if not exists despesa_cobranca_idx on despesa (cobranca_id);

-- 2. Permitir várias cobranças 'extra' (coimas) no mesmo contrato, mesmo em datas
--    sobrepostas. As proteções contra duplicação de RENDA passam a aplicar-se só
--    à renda; extra e caução ficam livres (o gerador de renda continua protegido).
alter table cobranca drop constraint if exists cobranca_contrato_id_periodo_inicio_tipo_key;
create unique index if not exists cobranca_periodo_renda_key
  on cobranca (contrato_id, periodo_inicio) where tipo = 'renda';

alter table cobranca drop constraint if exists cobranca_sem_sobreposicao;
alter table cobranca add constraint cobranca_sem_sobreposicao
  exclude using gist (
    contrato_id with =,
    tipo with =,
    daterange(periodo_inicio, periodo_fim, '[]') with &&
  ) where (tipo = 'renda');
