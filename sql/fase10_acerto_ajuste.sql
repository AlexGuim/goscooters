-- fase10: ajustes manuais no acerto (valor avulso: bónus, correção, dedução).
-- Persistem por (proprietário, competência) para sobreviverem a recalcular; ao
-- fechar, congelam como acerto_linha (tipo 'ajuste'). O código é tolerante: sem
-- esta migração não há ajustes (o form devolve erro), o resto do acerto funciona.

create table if not exists acerto_ajuste (
  id              uuid primary key default gen_random_uuid(),
  proprietario_id uuid not null references proprietario (id) on delete cascade,
  competencia_mes date not null,                 -- 'YYYY-MM-01'
  descricao       text not null,
  valor           numeric(12,2) not null,        -- assinado: + soma ao líquido, − desconta
  criado_por      text,
  created_at      timestamptz not null default now()
);

create index if not exists acerto_ajuste_comp_idx
  on acerto_ajuste (proprietario_id, competencia_mes);

-- acerto_linha.tipo passa a aceitar 'ajuste' (o snapshot no fecho grava a linha).
alter table acerto_linha drop constraint if exists acerto_linha_tipo_check;
alter table acerto_linha add constraint acerto_linha_tipo_check
  check (tipo in ('receita', 'despesa', 'comissao', 'ajuste'));
