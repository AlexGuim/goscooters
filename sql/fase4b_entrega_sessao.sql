-- ═══════════════════════════════════════════════════════════════════════════
-- Sessão de entrega (self-service do motorista, por LINK sem conta).
--
-- O admin cria uma sessão ligada a um contrato; o motorista abre /entrega/<token>
-- e prepara em casa (consentimento, documentos, dados, aceite das regras +
-- assinatura). O token guarda-se HASHEADO (sha256) — o link em claro só existe
-- no momento da criação; expira em pouco tempo e é de âmbito estrito.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists entrega_sessao (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,           -- sha256 hex do token (o link tem o token em claro)
  contrato_id   uuid references contrato_aluguer (id) on delete cascade,
  motorista_id  uuid references motorista (id) on delete set null,
  estado        text not null default 'enviado'
                  check (estado in ('enviado','aberto','docs_carregados','concluido','expirado','cancelado')),
  dados         jsonb,                           -- docs, dados do motorista, aceite das regras, assinatura
  consentimento_em timestamptz,
  expira_em     timestamptz not null,
  concluido_em  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists entrega_sessao_contrato_idx on entrega_sessao (contrato_id);

-- RLS ligada, sem política pública: toda a leitura/escrita passa por Server
-- Actions com service_role que validam o token (a chave anónima não lê nada).
alter table entrega_sessao enable row level security;
