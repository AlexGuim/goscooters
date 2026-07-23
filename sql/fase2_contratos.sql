-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 2 — CONTRATOS, VISTORIAS, KM, COBRANÇA E PAGAMENTOS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase. Só cria tabelas/funções novas — não toca no
-- que já existe (site e admin continuam a funcionar). Convenções do projeto:
-- text + check (não enums nativos), RLS ligado sem política pública.
--
-- Princípio financeiro: a receita vive UMA vez em `cobranca`; o dinheiro real em
-- `pagamento`; a alocação (que semanas cada pagamento cobre) em `pagamento_cobranca`.
-- "Em atraso" é derivado, não uma coluna que um cron tem de virar.

-- ── Sequências para numeração legível ───────────────────────────────────────
create sequence if not exists seq_contrato;
create sequence if not exists seq_cobranca;

-- ── 1. CONTRATO DE ALUGUER ──────────────────────────────────────────────────
create table if not exists contrato_aluguer (
  id             uuid primary key default gen_random_uuid(),
  numero         text not null unique
                 default ('ALU-' || lpad(nextval('seq_contrato')::text, 5, '0')),
  pedido_aluguer_id uuid references pedido_aluguer (id),
  motorista_id   uuid not null references motorista (id),
  veiculo_id     uuid not null references moto (id),
  -- Proprietário congelado à data: preserva o histórico se o veículo mudar de dono.
  proprietario_id uuid references proprietario (id),

  periodicidade  text not null default 'semanal'
                 check (periodicidade in ('semanal', 'quinzenal', 'mensal', 'diaria')),
  -- Dia da semana do vencimento em ISO (1=segunda … 7=domingo). Substitui o caos
  -- "Quinta feira"/"Terça"/"Sexta" do Notion.
  dia_vencimento smallint check (dia_vencimento between 1 and 7),
  preco_periodo  numeric not null,
  caucao         numeric,
  -- Data do 1.º vencimento; a partir daqui o gerador materializa as cobranças.
  ancora_vencimento date,
  data_inicio    date not null,
  data_fim_prevista date,
  data_fim       date,               -- NULL = a decorrer
  km_inicio      int,
  km_fim         int,
  km_rodados     int generated always as (
                   case when km_fim is not null and km_inicio is not null
                        then km_fim - km_inicio end
                 ) stored,
  estado         text not null default 'rascunho'
                 check (estado in ('rascunho', 'ativo', 'pendente_fecho',
                                   'suspenso', 'concluido', 'cancelado')),
  contrato_assinado_url text,
  assinado_em    timestamptz,
  observacoes    text,
  import_notion_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists contrato_motorista_idx on contrato_aluguer (motorista_id);
create index if not exists contrato_veiculo_idx on contrato_aluguer (veiculo_id);
create index if not exists contrato_estado_idx on contrato_aluguer (estado);

drop trigger if exists contrato_set_updated_at on contrato_aluguer;
create trigger contrato_set_updated_at
  before update on contrato_aluguer
  for each row execute function set_updated_at();

-- ── 2. VISTORIA (entrega/recolha com prova) ─────────────────────────────────
create table if not exists vistoria (
  id           uuid primary key default gen_random_uuid(),
  contrato_id  uuid not null references contrato_aluguer (id) on delete cascade,
  tipo         text not null check (tipo in ('entrega', 'recolha', 'intermedia')),
  realizada_em timestamptz not null default now(),
  km           int,
  nivel_combustivel smallint,        -- 0..100 (%)
  video_url    text,
  foto_urls    text[],
  checklist    jsonb,
  notas        text,
  assinatura_cliente_url text,
  created_at   timestamptz not null default now()
);

create index if not exists vistoria_contrato_idx on vistoria (contrato_id);
-- Só uma entrega e uma recolha por contrato (intermédias podem repetir).
create unique index if not exists vistoria_unica_idx
  on vistoria (contrato_id, tipo) where tipo in ('entrega', 'recolha');

-- ── 3. REGISTO DE KM (série temporal) ───────────────────────────────────────
-- O Notion só guardava o último valor, sobrescrito. Aqui fica o histórico.
create table if not exists km_registo (
  id          uuid primary key default gen_random_uuid(),
  veiculo_id  uuid not null references moto (id) on delete cascade,
  km          int not null,
  data        date not null default current_date,
  fonte       text not null default 'manual'
              check (fonte in ('entrega', 'recolha', 'manutencao', 'manual')),
  contrato_id uuid references contrato_aluguer (id),
  created_at  timestamptz not null default now()
);

create index if not exists km_veiculo_idx on km_registo (veiculo_id, data);

-- Ao registar km, atualiza o km_atual do veículo se for o mais recente.
create or replace function fn_km_atual()
returns trigger language plpgsql as $$
begin
  update moto
     set km_atual = new.km, km_atual_em = new.data
   where id = new.veiculo_id
     and (km_atual_em is null or new.data >= km_atual_em);
  return new;
end $$;

drop trigger if exists trg_km_atual on km_registo;
create trigger trg_km_atual after insert on km_registo
  for each row execute function fn_km_atual();

-- ── 4. COBRANÇA (uma linha por período devido) ──────────────────────────────
create table if not exists cobranca (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique
                default ('COB-' || lpad(nextval('seq_cobranca')::text, 6, '0')),
  contrato_id   uuid not null references contrato_aluguer (id) on delete cascade,
  -- Denormalizados de propósito: o painel e o acerto leem sem cadeia de joins.
  motorista_id  uuid not null references motorista (id),
  veiculo_id    uuid not null references moto (id),
  proprietario_id uuid references proprietario (id),
  periodo_inicio date not null,
  periodo_fim   date not null,
  data_vencimento date not null,
  tipo          text not null default 'renda'
                check (tipo in ('renda', 'caucao', 'extra')),
  valor_devido  numeric not null,
  valor_pago    numeric not null default 0,   -- cache, mantido por trigger
  estado_liquidacao text not null default 'por_liquidar'
                check (estado_liquidacao in ('por_liquidar', 'parcial',
                                             'liquidada', 'isenta', 'anulada')),
  observacoes   text,
  created_at    timestamptz not null default now(),
  -- Idempotência do gerador: um período por contrato e tipo.
  unique (contrato_id, periodo_inicio, tipo)
);

create index if not exists cobranca_vencimento_idx on cobranca (data_vencimento);
create index if not exists cobranca_estado_idx on cobranca (estado_liquidacao);
create index if not exists cobranca_motorista_idx on cobranca (motorista_id);

-- Rede de segurança contra faturação duplicada: nenhuma cobrança do mesmo
-- contrato e tipo pode SOBREPOR-SE a outra (não só datas de início iguais — isso
-- é o unique acima). Protege se alguém mudar a âncora/periodicidade e regenerar.
create extension if not exists btree_gist;
alter table cobranca drop constraint if exists cobranca_sem_sobreposicao;
alter table cobranca add constraint cobranca_sem_sobreposicao
  exclude using gist (
    contrato_id with =,
    tipo with =,
    daterange(periodo_inicio, periodo_fim, '[]') with &&
  );

-- Corrigir valor_devido reavalia o estado de liquidação (senão ficava obsoleto).
create or replace function fn_cobranca_reavaliar()
returns trigger language plpgsql as $$
begin
  if new.estado_liquidacao not in ('isenta', 'anulada') then
    new.estado_liquidacao := case
      when new.valor_pago >= new.valor_devido then 'liquidada'
      when new.valor_pago > 0 then 'parcial'
      else 'por_liquidar' end;
  end if;
  return new;
end $$;

drop trigger if exists trg_cobranca_reavaliar on cobranca;
create trigger trg_cobranca_reavaliar
  before update of valor_devido on cobranca
  for each row execute function fn_cobranca_reavaliar();

-- ── 5. PAGAMENTO (dinheiro real recebido) ───────────────────────────────────
create table if not exists pagamento (
  id           uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motorista (id),
  valor        numeric not null,
  data_recebimento date not null default current_date,
  metodo       text check (metodo in ('transferencia', 'mbway', 'numerario',
                                       'multibanco', 'outro')),
  referencia   text,
  comprovativo_url text,
  origem       text not null default 'manual'
               check (origem in ('manual', 'ingestao', 'webhook')),
  observacoes  text,
  created_at   timestamptz not null default now()
);

create index if not exists pagamento_motorista_idx on pagamento (motorista_id);

-- ── 6. ALOCAÇÃO PAGAMENTO ↔ COBRANÇA (N:M) ──────────────────────────────────
-- "Uma transferência cobre 3 semanas" e pagamentos parciais são a norma.
create table if not exists pagamento_cobranca (
  id            uuid primary key default gen_random_uuid(),
  pagamento_id  uuid not null references pagamento (id) on delete cascade,
  cobranca_id   uuid not null references cobranca (id) on delete cascade,
  valor_alocado numeric not null check (valor_alocado > 0),
  created_at    timestamptz not null default now(),
  unique (pagamento_id, cobranca_id)
);

-- Recalcula o valor_pago e o estado da cobrança sempre que a alocação muda.
create or replace function fn_recalc_cobranca()
returns trigger language plpgsql as $$
declare
  v_cob uuid;
  pago numeric;
  devido numeric;
  est text;
begin
  v_cob := coalesce(new.cobranca_id, old.cobranca_id);
  -- Bloqueia a linha da cobrança para serializar recálculos concorrentes
  -- (dois pagamentos alocados à mesma cobrança ao mesmo tempo).
  select valor_devido, estado_liquidacao into devido, est
    from cobranca where id = v_cob for update;
  select coalesce(sum(valor_alocado), 0) into pago
    from pagamento_cobranca where cobranca_id = v_cob;

  if est in ('isenta', 'anulada') then
    update cobranca set valor_pago = pago where id = v_cob;
  else
    update cobranca set valor_pago = pago,
      estado_liquidacao = case
        when pago >= devido then 'liquidada'
        when pago > 0 then 'parcial'
        else 'por_liquidar' end
     where id = v_cob;
  end if;
  return null;
end $$;

drop trigger if exists trg_recalc_cobranca on pagamento_cobranca;
create trigger trg_recalc_cobranca
  after insert or update or delete on pagamento_cobranca
  for each row execute function fn_recalc_cobranca();

-- ── 7. GERADOR IDEMPOTENTE DE COBRANÇAS ─────────────────────────────────────
-- Materializa as cobranças de renda de um contrato até uma data. Correr várias
-- vezes não duplica (ON CONFLICT DO NOTHING sobre o unique do período).
create or replace function fn_gerar_cobrancas(p_contrato_id uuid, p_ate date)
returns int language plpgsql as $$
declare
  c contrato_aluguer%rowtype;
  passo interval;
  base date;
  ini date;
  fim date;
  n int := 0;
  cnt int := 0;
begin
  select * into c from contrato_aluguer where id = p_contrato_id;
  if not found or c.estado not in ('ativo', 'pendente_fecho') then
    return 0;
  end if;

  passo := case c.periodicidade
    when 'semanal' then interval '7 days'
    when 'quinzenal' then interval '14 days'
    when 'mensal' then interval '1 month'
    when 'diaria' then interval '1 day'
    else interval '7 days' end;

  base := coalesce(c.ancora_vencimento, c.data_inicio);
  -- Cada vencimento é (base + n*passo) a partir da âncora FIXA — nunca
  -- cumulativo. Assim um mês curto (fev) não puxa o dia de vencimento para
  -- trás nos meses seguintes.
  loop
    ini := (base + (n * passo))::date;
    exit when ini > p_ate;
    exit when c.data_fim is not null and ini > c.data_fim;
    exit when n > 1040;  -- salvaguarda (20 anos de semanas)
    fim := ((base + ((n + 1) * passo)) - interval '1 day')::date;
    begin
      insert into cobranca (contrato_id, motorista_id, veiculo_id, proprietario_id,
                            periodo_inicio, periodo_fim, data_vencimento,
                            tipo, valor_devido)
      values (c.id, c.motorista_id, c.veiculo_id, c.proprietario_id,
              ini, fim, ini, 'renda', c.preco_periodo);
      cnt := cnt + 1;
    exception when unique_violation or exclusion_violation then
      -- Período já coberto (igual ou sobreposto): nunca duplicar receita.
      null;
    end;
    n := n + 1;
  end loop;
  return cnt;
end $$;

-- ── 8. VIEWS (verdade única para painel e, amanhã, IA) ──────────────────────
-- "Em atraso" derivado, sem cron a virar estados.
create or replace view vw_cobranca_estado as
  select c.*,
         (c.estado_liquidacao in ('por_liquidar', 'parcial')
          and c.data_vencimento < current_date) as em_atraso,
         -- Anuladas/isentas não são dívida: em_falta = 0.
         case when c.estado_liquidacao in ('anulada', 'isenta') then 0
              else greatest(c.valor_devido - c.valor_pago, 0) end as em_falta
    from cobranca c;

-- ── 9. Ligação lead → cliente ───────────────────────────────────────────────
alter table pedido_aluguer
  add column if not exists motorista_id uuid references motorista (id);

-- ── 10. Segurança ───────────────────────────────────────────────────────────
alter table contrato_aluguer enable row level security;
alter table vistoria enable row level security;
alter table km_registo enable row level security;
alter table cobranca enable row level security;
alter table pagamento enable row level security;
alter table pagamento_cobranca enable row level security;
