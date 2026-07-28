-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 7 — PROCEDIMENTOS (motor de regras: gatilho → condições → ação → canal)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase. Só ACRESCENTA — não apaga nada. Convenções:
-- text + check, RLS ligado sem política, set_updated_at reutilizado.
--
-- "Procedimento padrão": uma regra que, quando um EVENTO acontece (gatilho) e as
-- CONDIÇÕES batem, executa uma AÇÃO por um CANAL, em modo manual (prepara e o
-- gestor confirma) ou automático (envia sozinho). Extensível: novos gatilhos/
-- ações entram no check. NÃO confundir com "regras do aluguer" (regras_aluguer),
-- que são os termos que o motorista aceita.

create table if not exists procedimento (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,

  -- Evento que dispara. Comunicações (intake) e alertas (proativos).
  gatilho    text not null
             check (gatilho in ('coima_registada', 'portagem_registada', 'seguro_registado',
                                 'seguro_a_expirar', 'manutencao_a_vencer', 'doc_motorista_a_expirar')),

  acao       text not null default 'comunicar_motorista'
             check (acao in ('comunicar_motorista', 'alertar_gestor')),

  canal      text not null default 'preparar'
             check (canal in ('preparar', 'whatsapp', 'sms', 'telegram', 'email')),

  -- manual = prepara e o gestor envia (1 clique); auto = envia sozinho.
  modo       text not null default 'manual'
             check (modo in ('manual', 'auto')),

  -- Filtros opcionais avaliados contra o contexto do evento.
  -- Chaves suportadas: { "valor_min": number, "categoria": text }.
  condicoes  jsonb,

  ativo      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists procedimento_gatilho_idx on procedimento (gatilho) where ativo;

alter table procedimento enable row level security;

drop trigger if exists procedimento_set_updated_at on procedimento;
create trigger procedimento_set_updated_at
  before update on procedimento
  for each row execute function set_updated_at();

-- Procedimentos por omissão (idempotente): comunicações manuais (1 clique) para
-- os três eventos que já existiam no intake. O gestor pode editar/ligar/desligar.
insert into procedimento (nome, gatilho, acao, canal, modo)
select v.nome, v.gatilho, 'comunicar_motorista', 'preparar', 'manual'
from (values
  ('Avisar motorista de coima', 'coima_registada'),
  ('Avisar motorista de portagem', 'portagem_registada'),
  ('Enviar carta verde ao motorista', 'seguro_registado')
) as v(nome, gatilho)
where not exists (
  select 1 from procedimento p where p.gatilho = v.gatilho and p.acao = 'comunicar_motorista'
);
