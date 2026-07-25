-- ═══════════════════════════════════════════════════════════════════════════
-- GoScooters — migrações pendentes, todas de uma vez (ordem correta).
-- Idempotente: seguro correr mesmo que alguma já tenha sido aplicada.
-- Correr no SQL Editor do Supabase.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase3d_acerto_direto.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Congelar a direção do acerto no snapshot.
--
-- Quando a renda é paga direto ao parceiro, o líquido do acerto é NEGATIVO (o
-- parceiro deve a comissão + despesas à GoScooters). Para o extrato fechado ser
-- auto-consistente e reconstruível anos depois — mesmo que a flag do parceiro
-- mude — congelamos aqui a receita cobrada pela GoScooters e se foi pago direto.
-- ═══════════════════════════════════════════════════════════════════════════

alter table acerto
  add column if not exists receita_goscooters numeric not null default 0,
  add column if not exists pago_direto boolean not null default false;

comment on column acerto.receita_goscooters is
  'Parte da receita_total efetivamente cobrada pela GoScooters (0 se pago direto).';
comment on column acerto.pago_direto is
  'true = renda paga direto ao parceiro; liquido negativo significa que o parceiro deve a GoScooters.';


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase3e_recebido_por.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Quem recebeu cada pagamento: GoScooters ou o parceiro (na conta dele).
--
-- Por omissão, os pagamentos são recebidos pela GoScooters. Mas em motos de
-- parceiro pago direto, o dinheiro entra na conta do parceiro — e o admin marca
-- isso ao registar o pagamento. Pode variar POR PAGAMENTO (às vezes um parceiro
-- pago direto recebe via GoScooters, e vice-versa).
--
-- O acerto usa isto para separar a receita cobrada pela GoScooters da que foi
-- direta ao parceiro, e assim calcular o líquido/dívida com precisão.
-- ═══════════════════════════════════════════════════════════════════════════

alter table pagamento
  add column if not exists recebido_por text not null default 'goscooters'
    check (recebido_por in ('goscooters', 'proprietario'));

comment on column pagamento.recebido_por is
  'goscooters = a GoScooters recebeu; proprietario = pago direto na conta do parceiro.';

-- Retroativo (uma vez): os pagamentos JÁ alocados a cobranças de parceiros com
-- recebe_pagamento_direto = true passam a 'proprietario' — assume-se que
-- seguiram o arranjo em vigor. Daí em diante, é o toggle por pagamento que manda.
update pagamento p
   set recebido_por = 'proprietario'
 where p.recebido_por = 'goscooters'
   and exists (
     select 1
       from pagamento_cobranca pc
       join cobranca c on c.id = pc.cobranca_id
       join proprietario pr on pr.id = c.proprietario_id
      where pc.pagamento_id = p.id
        and pr.recebe_pagamento_direto = true
   );


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase3f_coima.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
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


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase4_portal.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Portal do parceiro — Fase 1 (fundação de auth).
--
-- Cada proprietário pode ser ligado a UM utilizador Supabase Auth (auth_user_id,
-- já existente no schema) para entrar no portal. O índice único garante o
-- vínculo 1↔1: um utilizador Auth nunca fica ligado a dois proprietários.
-- A ativação faz-se por portal_ativo = true (já existente).
-- ═══════════════════════════════════════════════════════════════════════════

create unique index if not exists proprietario_auth_user_unico
  on proprietario (auth_user_id)
  where auth_user_id is not null;


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase4_regras.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
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


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase4b_entrega_sessao.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
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


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase4c_carta.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Carta de condução do motorista (o documento mais crítico para a PCX 125).
--
-- Sem carta válida e adequada à categoria, o motorista conduz sem cobertura do
-- seguro. Guardamos número, categoria, país emissor e validade; as imagens
-- (frente/verso) ficam em motorista.doc_urls (bucket privado).
-- ═══════════════════════════════════════════════════════════════════════════

alter table motorista
  add column if not exists carta_numero    text,
  add column if not exists carta_categoria text,   -- ex.: A1, A, B
  add column if not exists carta_pais      text,   -- ISO-2 do país emissor
  add column if not exists carta_validade  date;


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase4d_idiomas.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Alargar as línguas do motorista para além de pt/en.
--
-- O público é imigrante e multilíngue. Removemos o CHECK que só permitia pt/en;
-- os valores válidos passam a ser controlados pela aplicação (lista IDIOMAS),
-- evitando ter de mexer no schema sempre que se acrescenta uma língua.
-- ═══════════════════════════════════════════════════════════════════════════

alter table motorista drop constraint if exists motorista_idioma_preferido_check;



-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase5_jornada.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
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

-- 3. Invariante: FORA do pré-contrato/cancelado, mota+preço+data são obrigatórios.
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


-- ╭─────────────────────────────────────────────────────────────────────────╮
-- │  fase5b_telefone_unico.sql
-- ╰─────────────────────────────────────────────────────────────────────────╯
-- ═══════════════════════════════════════════════════════════════════════════
-- Backstop de deduplicação de motoristas por telefone.
--
-- As jornadas (converterPedidoEmJornada, criarSessaoRegisto) fazem "procura por
-- telefone → se não existe, cria". Sem um índice ÚNICO, duas execuções em
-- paralelo com o mesmo número criam dois motoristas (TOCTOU). Este índice fecha
-- essa janela na base de dados — o código já trata o conflito (23505) reusando o
-- registo existente.
--
-- ⚠️ SEPARADO do fase5_jornada de propósito: se existirem telefones DUPLICADOS
-- em registos legados (import do Notion), a criação do índice FALHA. Corre antes:
--   select telefone_digitos, count(*) from motorista
--    where telefone_digitos is not null and telefone_digitos <> ''
--    group by telefone_digitos having count(*) > 1;
--   -- deve dar 0 linhas. Se der, funde/limpa os duplicados primeiro.
-- ═══════════════════════════════════════════════════════════════════════════

create unique index if not exists motorista_telefone_digitos_unico
  on motorista (telefone_digitos)
  where telefone_digitos is not null and telefone_digitos <> '';
