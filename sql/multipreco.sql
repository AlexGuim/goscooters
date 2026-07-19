-- Multi-preço: diária, semanal e mensal
--
-- Modelo: um preço a NULL significa "este período não é oferecido nesta mota".
-- Não são precisos campos extra a dizer o que mostrar — a ausência de preço
-- decide, e o catálogo adapta-se ao que existir.
--
-- Correr no SQL Editor do Supabase. Pode ser corrido mais do que uma vez sem
-- estragar nada.

-- 1. Novos períodos ─────────────────────────────────────────────────────────
alter table moto
  add column if not exists preco_dia numeric,
  add column if not exists preco_semana numeric;

comment on column moto.preco_dia is 'Preço por dia. Null = período não oferecido.';
comment on column moto.preco_semana is 'Preço por semana. Null = período não oferecido.';
comment on column moto.preco_mes is 'Preço por mês. Null = período não oferecido.';

-- 2. preco_mes deixa de ser obrigatório ─────────────────────────────────────
-- Sem isto não seria possível ter uma mota só com preço semanal.
alter table moto alter column preco_mes drop not null;

-- 3. Mas pelo menos um preço tem de existir ─────────────────────────────────
-- Uma mota sem preço nenhum não faz sentido no catálogo.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'moto_pelo_menos_um_preco'
  ) then
    alter table moto add constraint moto_pelo_menos_um_preco
      check (
        preco_dia is not null
        or preco_semana is not null
        or preco_mes is not null
      );
  end if;
end $$;

-- 4. Pedidos: guardar o período escolhido ───────────────────────────────────
-- A duração deixa de ser sempre em meses, por isso a coluna muda de nome e
-- passa a acompanhar um período.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'pedido_aluguer' and column_name = 'duracao_meses'
  ) then
    alter table pedido_aluguer rename column duracao_meses to duracao;
  end if;
end $$;

alter table pedido_aluguer
  add column if not exists periodo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pedido_periodo_valido'
  ) then
    alter table pedido_aluguer add constraint pedido_periodo_valido
      check (periodo is null or periodo in ('dia', 'semana', 'mes'));
  end if;
end $$;

comment on column pedido_aluguer.duracao is
  'Número de unidades do período escolhido (ex.: 3 com periodo=semana são 3 semanas).';
comment on column pedido_aluguer.periodo is
  'Período de aluguer pedido: dia, semana ou mes.';

-- 5. Pedidos antigos eram todos mensais ─────────────────────────────────────
update pedido_aluguer
   set periodo = 'mes'
 where periodo is null
   and duracao is not null;
