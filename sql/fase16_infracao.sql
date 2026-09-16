-- fase16: IDENTIFICAÇÃO DO CONDUTOR nas coimas (formulário F306 da ANSR).
--
-- Um auto de contraordenação chega em nome do dono da mota — o "arguido". Se
-- quem conduzia era o motorista do aluguer, o dono tem 15 dias úteis a contar da
-- notificação para o identificar (Código da Estrada, art. 171.º); se não o fizer,
-- o processo segue contra ele. Até aqui a plataforma registava a coima como
-- despesa e, se pedido, gerava a dívida ao motorista, mas não guardava nada do
-- PROCESSO: o n.º do auto, a entidade, a data da notificação, o prazo, o F306
-- gerado, o assinado, e se, quando e por onde foi enviado. É o que fica aqui.
--
-- Uma linha por auto, ligada à despesa da coima. Os ficheiros (F306 gerado,
-- F306 assinado, comprovativo do envio) vivem no bucket "privado", em
-- `infracoes/…` — a regra dos avisos de coima (F0a): trazem nome, NIF, documento
-- e morada do condutor. As colunas guardam o CAMINHO, nunca um URL.
--
-- RLS ativa e sem políticas, de propósito: só a service_role (a app) lê e
-- escreve. Desde a fase15, anon e authenticated não têm privilégios por omissão.
-- Correr duas vezes não parte nada.
--
-- ORDEM: aplicar ANTES de publicar o código do ramo feat/coimas-f306. Esse código
-- lê a tabela infracao e as colunas novas de motorista e proprietario.

-- ── 1. O PROCESSO DE CADA AUTO ──────────────────────────────────────────────
create table if not exists infracao (
  id                   uuid primary key default gen_random_uuid(),
  despesa_id           uuid unique references despesa(id) on delete cascade,
  veiculo_id           uuid references moto(id) on delete set null,
  proprietario_id      uuid references proprietario(id) on delete set null,
  motorista_id         uuid references motorista(id) on delete set null,
  contrato_id          uuid references contrato_aluguer(id) on delete set null,

  -- Quem instrui o processo. 'ansr' usa o F306; 'outro' (EMEL, câmaras,
  -- concessionárias) tem formulário e canal próprios e fica só registado.
  regime               text not null default 'ansr' check (regime in ('ansr', 'outro')),
  entidade             text not null default 'ANSR',
  numero_auto          text,
  data_infracao        date,
  -- A data que conta para o prazo. Registada pelo gestor a partir do envelope,
  -- do aviso de receção ou da notificação eletrónica.
  data_notificacao     date,
  prazo_identificacao  date,
  -- Quando o n.º do auto e a data da notificação foram lidos do documento pela IA
  -- (null = ainda não): a leitura automática ao abrir corre uma vez só.
  auto_lido_em         timestamptz,

  estado               text not null default 'por_identificar'
                         check (estado in ('por_identificar', 'gerada', 'assinada', 'enviada', 'nao_aplicavel')),
  signatario           text check (signatario in ('arguido', 'mandatario', 'representante_legal')),

  f306_path            text,
  f306_gerado_em       timestamptz,
  f306_assinado_path   text,

  envio_canal          text check (envio_canal in ('email', 'portal', 'correio_registado', 'presencial')),
  envio_destino        text,
  -- Id do email no fornecedor, n.º do registo dos CTT ou referência do portal.
  envio_referencia     text,
  enviado_em           timestamptz,
  comprovativo_path    text,

  observacoes          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Colunas acrescentadas depois do primeiro desenho: também por alter, para o
-- ficheiro correr sem erros numa base onde a tabela já exista sem elas.
alter table infracao add column if not exists auto_lido_em timestamptz;

create index if not exists infracao_prazo_aberto_idx
  on infracao (prazo_identificacao)
  where estado in ('por_identificar', 'gerada', 'assinada');

alter table infracao enable row level security;

comment on table infracao is
  'Processo de identificação do condutor de um auto de contraordenação (F306 da ANSR). Uma linha por auto, ligada à despesa da coima.';
comment on column infracao.data_notificacao is
  'Data da notificação ao arguido — é dela que contam os 15 dias úteis para identificar o condutor.';
comment on column infracao.prazo_identificacao is
  'Último dia útil para identificar o condutor (estimativa: dias úteis sem feriados municipais).';
comment on column infracao.f306_assinado_path is
  'Caminho no bucket privado (infracoes/f306/…) do F306 assinado com assinatura qualificada.';

-- O padrão explícito da fase15: não depender das default privileges de quem corre.
revoke all on table infracao from public, anon, authenticated;
grant all on table infracao to service_role;

-- ── 2. DADOS DO ARGUIDO SINGULAR QUE O F306 PEDE ────────────────────────────
-- Quando o dono da mota é pessoa singular, o F306 pede-lhe o n.º do documento
-- de identificação e o da carta de condução. O proprietário não os tinha. Os
-- nomes e os valores são os do motorista, para reaproveitar rótulos e leitura.
-- `titular_nome`: o nome no registo das motas quando não é o `nome` — a frota
-- própria aparece como "GoScooters", mas as motas estão no nome do dono.
alter table proprietario
  add column if not exists titular_nome     text,
  add column if not exists doc_id_tipo      text,
  add column if not exists doc_id_numero    text,
  add column if not exists doc_id_validade  date,
  add column if not exists carta_numero     text,
  add column if not exists carta_validade   date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'proprietario_doc_id_tipo_check') then
    alter table proprietario add constraint proprietario_doc_id_tipo_check
      check (doc_id_tipo is null or doc_id_tipo in ('cc', 'passaporte', 'titulo_residencia', 'aima'));
  end if;
end $$;

comment on column proprietario.doc_id_numero is
  'N.º do documento de identificação do proprietário singular (F306: arguido).';
comment on column proprietario.carta_numero is
  'N.º da carta de condução do proprietário singular (F306: arguido).';

-- ── 3. DATA E EMISSOR DO DOCUMENTO DE IDENTIFICAÇÃO ─────────────────────────
-- O art. 171.º, n.º 1, al. c), do Código da Estrada pede, do documento legal de
-- identificação, o número, a data e o serviço emissor. O F306 em uso só tem campo
-- para o número, por isso a plataforma escreve os três nesse campo. Faltavam a
-- data de emissão (só havia a validade) e o emissor.
alter table motorista
  add column if not exists doc_id_emissao date,
  add column if not exists doc_id_emissor text;

alter table proprietario
  add column if not exists doc_id_emissao date,
  add column if not exists doc_id_emissor text;

comment on column motorista.doc_id_emissao is
  'Data de emissão do documento de identificação (CE art. 171.º, n.º 1, al. c)).';
comment on column motorista.doc_id_emissor is
  'Serviço emissor do documento, como impresso (ex.: República Portuguesa, AIMA, SEF, autoridade ou país do passaporte).';
comment on column proprietario.doc_id_emissao is
  'Data de emissão do documento de identificação do proprietário singular.';
comment on column proprietario.doc_id_emissor is
  'Serviço emissor do documento de identificação do proprietário singular, como impresso.';
