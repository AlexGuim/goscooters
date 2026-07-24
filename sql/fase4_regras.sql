-- ═══════════════════════════════════════════════════════════════════════════
-- Regras do Aluguer, versionadas (para a prova de aceitação).
--
-- Cada gravação em /admin/regras cria uma VERSÃO nova (conteúdo + hash SHA-256),
-- e marca-a como a ativa. Guarda-se o hash para, na aceitação do motorista, ficar
-- provado EXATAMENTE que texto ele aceitou — oponível meses depois.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists regras_aluguer (
  id          uuid primary key default gen_random_uuid(),
  versao      text not null,                 -- rótulo amigável (ex.: 2026-07-24)
  conteudo    text not null,
  hash        text not null,                 -- sha256 hex do conteúdo
  ativa       boolean not null default true,
  criado_por  text,
  created_at  timestamptz not null default now()
);

-- Garante que só uma versão está ativa de cada vez.
create unique index if not exists regras_uma_ativa
  on regras_aluguer (ativa) where ativa;

alter table regras_aluguer enable row level security;
