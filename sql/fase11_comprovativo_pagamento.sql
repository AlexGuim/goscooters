-- fase11: comprovativo de pagamento ao motorista (documento EMITIDO).
--
-- Um comprovativo não é uma vista sobre `pagamento` — é um documento que saiu
-- por WhatsApp e que o motorista guardou. Depois de sair, não pode mudar
-- sozinho, e mudaria: `alterarRecebidoPor` reescreve quem recebeu, uma correção
-- do nome/NIF reescreve o destinatário, e apagar uma cobrança leva à frente as
-- alocações (`on delete cascade`), fazendo desaparecer as semanas cobertas.
-- Por isso guardam-se VALORES (snapshot), não só chaves — a mesma doutrina do
-- `acerto_linha.matricula_snapshot`. As FK ficam anuláveis e `on delete set
-- null`: estornar um pagamento nunca pode mutilar um documento já entregue.
--
-- Um comprovativo cobre 1..N pagamentos do MESMO motorista: com um, é o recibo
-- simples do dia-a-dia; com vários, é o consolidado do mês (o total é a soma).
--
-- NÃO É DOCUMENTO FISCAL. A série 'CP-' é uma REFERÊNCIA de gestão — uma
-- sequence tem buracos por natureza (um rollback queima o número), o que é
-- correto aqui e mais uma razão para lhe chamar referência e não número.
--
-- O código é tolerante: sem esta migração o sistema funciona como hoje (a lista
-- de pagamentos não mostra referência e a ação de emitir devolve erro).

create sequence if not exists seq_comprovativo;

-- ── 1. COMPROVATIVO (cabeçalho, congelado na emissão) ───────────────────────
create table if not exists comprovativo_pagamento (
  id             uuid primary key default gen_random_uuid(),
  numero         text not null unique
                 default ('CP-' || lpad(nextval('seq_comprovativo')::text, 6, '0')),

  -- FK só para rasto e para a regra "um pagamento num só comprovativo activo".
  -- Anulável: apagar o motorista não pode apagar o documento emitido.
  motorista_id   uuid references motorista (id) on delete set null,

  -- Snapshot do destinatário à data da emissão (é o que está impresso).
  motorista_nome text not null,
  motorista_nif  text,

  -- Fuso de Lisboa: current_date é UTC e dataria de ontem um documento
  -- emitido depois da meia-noite (hora local) no Verão.
  data_emissao   date not null default ((now() at time zone 'Europe/Lisbon')::date),
  valor_total    numeric(12,2) not null,
  -- Idioma em que o documento foi emitido ('pt' | 'en'); congelado para reabrir igual.
  idioma         text not null default 'pt' check (idioma in ('pt', 'en')),
  observacoes    text,

  -- Anulado ≠ apagado: o link continua a abrir e mostra "ANULADO". Um documento
  -- financeiro nunca desaparece — dar 404 num link já enviado lê-se como
  -- "apagaram a prova".
  anulado_em     timestamptz,
  anulado_motivo text,

  criado_por     text,
  created_at     timestamptz not null default now()
);

create index if not exists comprovativo_motorista_idx
  on comprovativo_pagamento (motorista_id, data_emissao desc);

-- ── 2. ITENS (uma linha por pagamento incluído, com snapshot) ───────────────
create table if not exists comprovativo_pagamento_item (
  id               uuid primary key default gen_random_uuid(),
  comprovativo_id  uuid not null references comprovativo_pagamento (id) on delete cascade,

  -- Anulável + set null: sobrevive ao estorno (que faz DELETE do pagamento).
  pagamento_id     uuid references pagamento (id) on delete set null,

  -- Snapshot do pagamento à data da emissão.
  data_recebimento date not null,
  valor            numeric(12,2) not null,
  metodo           text,
  referencia       text,
  -- Semanas cobertas, congeladas: [{matricula, inicio, fim, tipo, valor}]
  semanas          jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),
  unique (comprovativo_id, pagamento_id)
);
-- NOTA: a regra "um pagamento só num comprovativo ACTIVO" é imposta no código
-- (emitirComprovativo verifica e falha fechado), não aqui: um índice único
-- parcial não consegue exprimi-la, porque `anulado_em` vive no cabeçalho e o
-- predicado não atravessa tabelas. Com um só gestor a operar, não há corrida
-- real; se um dia houver vários, isto passa a precisar de uma função SQL.

-- (não é preciso índice por comprovativo_id: o unique abaixo já o cobre.)
create index if not exists comprovativo_item_pag_idx
  on comprovativo_pagamento_item (pagamento_id);

comment on table comprovativo_pagamento is
  'Documento de gestão emitido ao motorista a confirmar pagamentos recebidos. Não é fatura nem recibo fiscal.';
-- Cuidado a não confundir com `pagamento.comprovativo_url`, que é a prova que o
-- MOTORISTA enviou (print da transferência). Esta tabela é o que a GoScooters EMITE.
comment on column comprovativo_pagamento_item.semanas is
  'Snapshot das semanas cobertas na emissão: [{matricula, inicio, fim, tipo, valor}].';

-- ── 3. SEGURANÇA (RLS) ──────────────────────────────────────────────────────
-- Sem isto, as default privileges do Supabase (grant a anon/authenticated) dão
-- acesso de LEITURA E ESCRITA a quem tenha a anon key — que é pública, vai no
-- bundle do browser. Estas tabelas contêm nome, NIF e montantes.
-- Sem políticas de propósito: todo o acesso da app é por service_role (que
-- ignora a RLS), incluindo a página pública, cuja autorização é o token HMAC.
alter table comprovativo_pagamento enable row level security;
alter table comprovativo_pagamento_item enable row level security;
