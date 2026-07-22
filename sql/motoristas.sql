-- Registo privado de motoristas
--
-- Base de dados dos motoristas a quem alugaste e da tua experiência com eles.
-- É PRIVADA: só acessível pela administração, nunca pelo site público. É a
-- fundação sobre a qual um dia se poderá construir um sistema de avaliações
-- recíprocas (com contas e consentimento) — mas isso fica para quando existir.
--
-- Correr no SQL Editor do Supabase. Pode ser corrido mais do que uma vez.

-- ── Motorista ───────────────────────────────────────────────────────────────
create table if not exists motorista (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  -- Guardado como escrito, mas o reconhecimento de quem volta faz-se pelos
  -- dígitos (ver telefone_digitos). É a "chave" natural para identificar alguém.
  telefone    text not null,
  -- Só dígitos, para comparar números escritos de formas diferentes
  -- (+351 91..., 0091 91..., 91 1234567). Preenchido pela aplicação.
  telefone_digitos text not null,
  email       text,
  plataforma  text,
  notas       text,
  created_at  timestamptz not null default now()
);

create index if not exists motorista_telefone_digitos_idx
  on motorista (telefone_digitos);

-- ── Avaliação ───────────────────────────────────────────────────────────────
-- Um motorista tem várias avaliações ao longo do tempo — é o histórico.
create table if not exists avaliacao (
  id           uuid primary key default gen_random_uuid(),
  motorista_id uuid not null references motorista (id) on delete cascade,
  tipo         text not null check (tipo in ('positiva', 'negativa', 'neutra')),
  -- Nota opcional de 1 a 5.
  nota         int check (nota between 1 and 5),
  comentario   text,
  -- Data do aluguer a que a avaliação diz respeito (opcional).
  data_aluguer date,
  created_at   timestamptz not null default now()
);

create index if not exists avaliacao_motorista_idx
  on avaliacao (motorista_id);

comment on column avaliacao.comentario is
  'Deve registar factos (ex.: "danos não pagos"), não juízos difamatórios.';

-- ── Segurança ───────────────────────────────────────────────────────────────
-- RLS ligado sem política de leitura pública: a chave anónima do site não
-- consegue ver nada. A administração usa a service_role, que ignora o RLS.
alter table motorista enable row level security;
alter table avaliacao enable row level security;
