-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 6 — SEGUROS e MANUTENÇÃO estruturados (base para alertas e IA)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase. Só ACRESCENTA tabelas/vistas — não apaga
-- nada. Convenções do projeto: text + check (não enums nativos), RLS ligado sem
-- política pública (a anon key não lê; o admin usa a service_role).
--
-- PORQUÊ: até aqui "seguro" e "manutenção" só existiam como CATEGORIAS de
-- despesa (custo). Não dava para responder a "que seguros expiram este mês?" ou
-- "que motos precisam de pneu?" porque faltava a VALIDADE da apólice e o registo
-- estruturado de intervenções. Estas tabelas dão esses dados — e são a fonte que
-- o agente de IA vai consultar. `despesa` continua a ser o livro-razão do custo;
-- estas linhas descrevem o EVENTO (a cobertura, a intervenção) e ligam-se à
-- despesa correspondente por `despesa_id`.

-- ── 1. SEGURO (apólice por veículo) ─────────────────────────────────────────
-- Histórico, não substituição: cada renovação é uma linha nova. A "apólice atual"
-- é a de estado 'ativa' com maior data_fim. É `data_fim` que "expira".
create table if not exists seguro (
  id            uuid primary key default gen_random_uuid(),
  veiculo_id    uuid not null references moto (id),

  seguradora    text,
  apolice       text,                                  -- nº da apólice
  tipo          text not null default 'responsabilidade_civil'
                check (tipo in ('responsabilidade_civil', 'danos_proprios', 'outro')),

  data_inicio   date,
  data_fim      date not null,                         -- VALIDADE da cobertura
  premio        numeric,                               -- valor do prémio
  periodicidade text not null default 'anual'
                check (periodicidade in ('anual', 'semestral', 'trimestral', 'mensal')),

  -- Quem SUPORTA o custo (mesmos valores de despesa.imputar_a; default segue a
  -- regra do parceiro proprietario.imputa_seguro, mas fica editável por apólice).
  quem_paga     text not null default 'goscooters'
                check (quem_paga in ('goscooters', 'proprietario', 'motorista')),

  estado        text not null default 'ativa'
                check (estado in ('ativa', 'expirada', 'cancelada')),

  observacoes   text,
  detalhe       jsonb,                                 -- específicos sem multiplicar colunas

  -- Costuras: liga ao custo (pagamento do prémio) e à ingestão de documentos.
  despesa_id    uuid references despesa (id),
  documento_id  uuid,                                  -- apólice em PDF (sem FK rígida)
  origem        text not null default 'manual'
                check (origem in ('manual', 'ingestao')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists seguro_veiculo_idx on seguro (veiculo_id);
create index if not exists seguro_data_fim_idx on seguro (data_fim);
create index if not exists seguro_estado_idx on seguro (estado);

alter table seguro enable row level security;

-- Reutiliza o set_updated_at() já definido na fase 1.
drop trigger if exists seguro_set_updated_at on seguro;
create trigger seguro_set_updated_at
  before update on seguro
  for each row execute function set_updated_at();

-- ── 2. MANUTENÇÃO (intervenções e trocas de pneu por veículo) ───────────────
-- Cada linha é uma intervenção feita (com km e custo), e regista a PRÓXIMA
-- prevista (proxima_km / proxima_data) — é isso que alimenta os alertas.
create table if not exists manutencao (
  id            uuid primary key default gen_random_uuid(),
  veiculo_id    uuid not null references moto (id),

  tipo          text not null default 'revisao'
                check (tipo in ('revisao', 'oleo', 'pneu_frente', 'pneu_tras',
                                'pneus', 'travoes', 'corrente', 'inspecao', 'outro')),

  data          date not null default current_date,
  km            int,                                   -- odómetro na intervenção
  oficina       text,
  custo         numeric,

  -- Próxima intervenção prevista — a base dos alertas "está a chegar".
  proxima_km    int,
  proxima_data  date,

  observacoes   text,
  detalhe       jsonb,

  -- Costuras: liga ao custo (despesa de manutenção) e à ingestão de documentos.
  despesa_id    uuid references despesa (id),
  documento_id  uuid,
  origem        text not null default 'manual'
                check (origem in ('manual', 'ingestao')),

  created_at    timestamptz not null default now()
);

create index if not exists manutencao_veiculo_idx on manutencao (veiculo_id);
create index if not exists manutencao_data_idx on manutencao (data);
create index if not exists manutencao_tipo_idx on manutencao (tipo);

alter table manutencao enable row level security;

-- ── 3. VISTAS DE ALERTA (verdade única para o painel e o agente de IA) ──────
-- Seguro: dias para expirar e flag de expirado, por apólice.
create or replace view vw_seguro_estado as
select
  s.*,
  (s.data_fim - current_date) as dias_para_expirar,
  (s.estado = 'ativa' and s.data_fim < current_date) as expirado
from seguro s;

-- Manutenção: a ÚLTIMA intervenção planeada por (veículo, tipo), com quanto
-- falta em km e em dias. Responde a "que motos precisam de pneu/revisão em breve?".
create or replace view vw_manutencao_proxima as
select distinct on (m.veiculo_id, m.tipo)
  m.veiculo_id,
  m.tipo,
  m.data              as ultima_data,
  m.km                as ultima_km,
  m.proxima_km,
  m.proxima_data,
  mo.matricula,
  mo.km_atual,
  mo.estado_operacional,
  case when m.proxima_km is not null and mo.km_atual is not null
       then m.proxima_km - mo.km_atual end                as km_em_falta,
  case when m.proxima_data is not null
       then m.proxima_data - current_date end             as dias_em_falta
from manutencao m
join moto mo on mo.id = m.veiculo_id
where m.proxima_km is not null or m.proxima_data is not null
order by m.veiculo_id, m.tipo, m.data desc;
