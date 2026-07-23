-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1 — NÚCLEO: Proprietários, Frota e Motoristas (perfil completo)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase. Só ACRESCENTA colunas/tabelas — não apaga
-- nada e não parte o site público (que continua a ler as mesmas colunas).
-- Segue as convenções do projeto: text + check (não enums nativos), RLS ligado
-- sem política pública (a chave anónima não lê; o admin usa a service_role).
--
-- Decisão de implementação: a tabela mantém o nome `moto` (não se renomeia para
-- `veiculo`) para não quebrar o site já em produção. O modelo — colunas e
-- relações — é o que importa. `tipo_veiculo` distingue motos de carros.

-- ── 1. PROPRIETÁRIO (parceiro-dono, alvo do acerto) ─────────────────────────
create table if not exists proprietario (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo_pessoa   text not null default 'singular'
                check (tipo_pessoa in ('singular', 'coletiva')),
  nif           text,
  email         text,
  telefone      text,
  telefone_e164 text,
  iban          text,
  morada        text,

  -- Frota própria do GoScooters (ex.: veículos do Alexandre): não geram acerto
  -- com terceiros — a receita é toda da casa.
  eh_goscooters boolean not null default false,

  -- Saldo acordado ao arranque, já que não migramos meses de histórico dos
  -- Sheets. Sem ele, o 1.º acerto "deve" tudo desde zero.
  saldo_inicial numeric not null default 0,

  -- Comissão por parceiro. Modelo escolhido: percentagem, variável por parceiro.
  -- comissao_valor fica a null até definires a % de cada um.
  comissao_modelo text default 'percentagem'
                  check (comissao_modelo in ('percentagem', 'fixo_veiculo', 'fixo_mensal')),
  comissao_valor  numeric,

  -- Regra de quem suporta cada custo (override pontual em despesa.imputar_a).
  imputa_gps        boolean not null default true,
  imputa_seguro     boolean not null default true,
  imputa_manutencao boolean not null default true,

  ativo         boolean not null default true,

  -- Costura para o portal de parceiro futuro (login próprio) — sem construir agora.
  auth_user_id  uuid references auth.users (id),
  portal_ativo  boolean not null default false,

  import_notion_id text,
  created_at    timestamptz not null default now()
);

alter table proprietario enable row level security;

-- ── 2. FROTA (estende `moto`) ───────────────────────────────────────────────
alter table moto
  add column if not exists tipo_veiculo text not null default 'moto'
      check (tipo_veiculo in ('moto', 'carro')),
  add column if not exists nome_interno text,          -- o apelido "PCX 2024"
  add column if not exists marca text,
  add column if not exists ano int,
  add column if not exists cor text,
  add column if not exists proprietario_id uuid references proprietario (id),

  -- Estado operacional da frota, distinto de `estado` (catálogo) e de `ativo`
  -- (visível no site). `estado` continua a servir o site; este serve a operação.
  add column if not exists estado_operacional text not null default 'disponivel'
      check (estado_operacional in ('disponivel', 'ocupado', 'manutencao', 'inativo')),

  add column if not exists km_atual int,
  add column if not exists km_atual_em date,
  add column if not exists proxima_manutencao_km int,
  add column if not exists data_aquisicao date,
  add column if not exists valor_aquisicao numeric,
  add column if not exists import_notion_id text,
  add column if not exists updated_at timestamptz not null default now();

-- Matrícula normalizada (maiúsculas, só alfanuméricos) — chave natural e de
-- roteamento (a mesma matrícula escrita de formas diferentes bate certo, e a
-- ingestão de documentos futura encontra o veículo por aqui).
alter table moto
  add column if not exists matricula_norm text
  generated always as (upper(regexp_replace(coalesce(matricula, ''), '[^A-Za-z0-9]', '', 'g'))) stored;

create unique index if not exists moto_matricula_norm_uidx
  on moto (matricula_norm) where matricula_norm <> '';

-- ── 3. MOTORISTA (estende a tabela viva: de registo leve a perfil KYC) ──────
alter table motorista
  -- Chave de dedup e de roteamento WhatsApp. Inbound chega sempre em E.164;
  -- assume-se +351 para os 9 dígitos portugueses.
  add column if not exists telefone_e164 text,
  add column if not exists telefones_extra text[],

  add column if not exists nif text,                   -- SEM unique (imigrantes)
  add column if not exists nif_valido boolean,
  add column if not exists pais_iso char(2),           -- ISO normalizado no import
  add column if not exists data_nascimento date,

  add column if not exists doc_id_tipo text
      check (doc_id_tipo in ('cc', 'passaporte', 'titulo_residencia', 'aima')),
  add column if not exists doc_id_numero text,
  add column if not exists doc_id_validade date,        -- → lembretes de expiração
  add column if not exists doc_urls text[],             -- HubSpot/Drive de hoje

  add column if not exists morada_linha1 text,
  add column if not exists codigo_postal text,
  add column if not exists localidade text,

  add column if not exists estado text not null default 'lead'
      check (estado in ('lead', 'ativo', 'inativo', 'bloqueado')),
  add column if not exists origem text default 'importado'
      check (origem in ('site', 'referral', 'walk_in', 'importado')),

  add column if not exists idioma_preferido text not null default 'pt'
      check (idioma_preferido in ('pt', 'en')),

  -- Costuras de reconciliação de pagamentos futura.
  add column if not exists iban text,
  add column if not exists telefone_mbway text,

  add column if not exists precisa_revisao boolean not null default false,
  add column if not exists import_notion_id text;

-- ── 4. updated_at automático (moto) ─────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists moto_set_updated_at on moto;
create trigger moto_set_updated_at
  before update on moto
  for each row execute function set_updated_at();
