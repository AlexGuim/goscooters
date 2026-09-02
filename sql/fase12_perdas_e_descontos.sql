-- fase12: PERDAS (incobráveis) e DESCONTOS (abatimentos).
--
-- Duas situações que pareciam a mesma coisa e não são:
--
--   INCOBRÁVEL — a semana foi usada, era devida, e o motorista não vai pagar
--   (devolveu a moto e desapareceu). É uma PERDA: aconteceu, custou dinheiro,
--   e tem de ficar registada como tal. Marcar isto como 'anulada' apagaria a
--   perda dos livros e a operação pareceria mais saudável do que é — daqui a um
--   ano não se responde a "quanto perdi em incobráveis?" nem "que parceiro tem
--   mais calotes?".
--
--   DESCONTO — a moto avariou e o motorista esteve dias sem rodar, por isso
--   paga 40 em vez de 55. NÃO é perda nem calote: o serviço não foi prestado,
--   logo aquele valor nunca chegou a ser devido. Guarda-se o preço contratado
--   em `valor_devido` e o abatimento à parte, para a diferença ser explicável.
--
-- Os três estados que já existiam continuam a valer:
--   anulada  — nunca foi devido (o contrato acabou antes da semana começar)
--   isenta   — perdoado por decisão comercial
--   liquidada/parcial/por_liquidar — o ciclo normal
--
-- Quem suporta a perda: ninguém precisa de decidir por linha. O acerto é a
-- regime de CAIXA (só conta rendas efectivamente pagas), por isso a perda já se
-- reparte sozinha na proporção de cada um — o parceiro não recebe a parte dele
-- e a GoScooters não recebe comissão. Esta migração não muda nenhum cálculo de
-- dinheiro: só passa a saber NOMEAR o que se perdeu, para o poder mostrar.

-- ── 1. COLUNAS NOVAS ────────────────────────────────────────────────────────
alter table cobranca
  add column if not exists desconto         numeric(12,2) not null default 0,
  add column if not exists desconto_motivo  text,
  add column if not exists incobravel_em    timestamptz,
  add column if not exists incobravel_motivo text;

comment on column cobranca.desconto is
  'Abatimento ao valor devido por serviço não prestado (ex.: moto avariada). Não é perda.';
comment on column cobranca.incobravel_em is
  'Quando foi dada como perda. Era devida e usada, mas não vai ser paga.';

-- ── 2. O ESTADO ACEITA 'incobravel' ─────────────────────────────────────────
-- O nome da restrição é gerado pelo Postgres, por isso descobre-se em vez de
-- se adivinhar (correr isto duas vezes não parte nada).
do $$
declare nome text;
begin
  select conname into nome
    from pg_constraint
   where conrelid = 'cobranca'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%estado_liquidacao%';
  if nome is not null then
    execute format('alter table cobranca drop constraint %I', nome);
  end if;
end $$;

alter table cobranca add constraint cobranca_estado_liquidacao_check
  check (estado_liquidacao in ('por_liquidar', 'parcial', 'liquidada',
                               'isenta', 'anulada', 'incobravel'));

-- ── 3. GATILHOS ─────────────────────────────────────────────────────────────
-- Dois pontos, ambos necessários:
--   (a) 'incobravel' passa a ser PEGAJOSO, como 'isenta'/'anulada': sem isto, o
--       primeiro recálculo devolvia a cobrança a 'por_liquidar' e a perda
--       desaparecia sozinha.
--   (b) o desconto entra na conta: uma semana de 55 com 15 de desconto fica
--       liquidada com 40 pagos, e não eternamente 'parcial' a pedir 15.

create or replace function fn_cobranca_reavaliar()
returns trigger language plpgsql as $$
begin
  if new.estado_liquidacao not in ('isenta', 'anulada', 'incobravel') then
    new.estado_liquidacao := case
      when new.valor_pago >= new.valor_devido - coalesce(new.desconto, 0) then 'liquidada'
      when new.valor_pago > 0 then 'parcial'
      else 'por_liquidar' end;
  end if;
  return new;
end $$;

-- Passa a disparar também quando o DESCONTO muda (antes só o valor_devido).
drop trigger if exists trg_cobranca_reavaliar on cobranca;
create trigger trg_cobranca_reavaliar
  before update of valor_devido, desconto on cobranca
  for each row execute function fn_cobranca_reavaliar();

create or replace function fn_recalc_cobranca()
returns trigger language plpgsql as $$
declare
  v_cob uuid;
  pago numeric;
  devido numeric;
  abatido numeric;
  est text;
begin
  v_cob := coalesce(new.cobranca_id, old.cobranca_id);
  select valor_devido, coalesce(desconto, 0), estado_liquidacao
    into devido, abatido, est
    from cobranca where id = v_cob for update;
  select coalesce(sum(valor_alocado), 0) into pago
    from pagamento_cobranca where cobranca_id = v_cob;

  if est in ('isenta', 'anulada', 'incobravel') then
    update cobranca set valor_pago = pago where id = v_cob;
  else
    update cobranca set valor_pago = pago,
      estado_liquidacao = case
        when pago >= devido - abatido then 'liquidada'
        when pago > 0 then 'parcial'
        else 'por_liquidar' end
     where id = v_cob;
  end if;
  return null;
end $$;

-- ── 4. VISTA ────────────────────────────────────────────────────────────────
-- Recriada (não `create or replace`): as colunas novas entram pelo `c.*` e
-- mudariam a posição das calculadas, o que o replace não permite.
drop view if exists vw_cobranca_estado;
create view vw_cobranca_estado as
  select c.*,
         (c.estado_liquidacao in ('por_liquidar', 'parcial')
          and c.data_vencimento < current_date) as em_atraso,
         -- Já não é dívida: anulada (nunca devida), isenta (perdoada) ou
         -- incobrável (perdida). O desconto abate ao que falta.
         case when c.estado_liquidacao in ('anulada', 'isenta', 'incobravel') then 0
              else greatest(c.valor_devido - coalesce(c.desconto, 0) - c.valor_pago, 0)
         end as em_falta,
         -- Quanto se perdeu nesta linha (0 em tudo o que não é incobrável).
         case when c.estado_liquidacao = 'incobravel'
              then greatest(c.valor_devido - coalesce(c.desconto, 0) - c.valor_pago, 0)
              else 0
         end as perda
    from cobranca c;

-- Sem isto a vista voltaria a contornar o RLS (ver fase11b): o `drop` levou a
-- definição antiga à frente, incluindo esta opção.
alter view vw_cobranca_estado set (security_invoker = on);

-- ── 5. O EXTRATO DO PARCEIRO PODE CONGELAR PERDAS ───────────────────────────
-- Sem isto, as perdas só existiam na pré-visualização: depois de fechar o mês,
-- o parceiro abria o extrato e a receita daquelas semanas tinha simplesmente
-- desaparecido, sem explicação. As linhas 'perda' NÃO entram no líquido (o
-- acerto é a regime de caixa e aquilo nunca foi receita) — servem para mostrar.
alter table acerto_linha drop constraint if exists acerto_linha_tipo_check;
alter table acerto_linha add constraint acerto_linha_tipo_check
  check (tipo in ('receita', 'despesa', 'comissao', 'ajuste', 'perda'));

-- ── 6. LINHA DO TEMPO SEMANAL, CONGELADA NO ACERTO ──────────────────────────
-- O extrato passa a mostrar TODAS as semanas do mês (4 ou 5) por moto, e não só
-- as que geraram receita: alugada e paga, com desconto, por cobrar, perdida, ou
-- a moto parada. Sem isto, uma moto parada e uma moto com calote eram
-- indistinguíveis no extrato — as duas apareciam como ausência de linha.
--
-- Guardado em jsonb no próprio acerto (e não como acerto_linha) porque é
-- CONTEXTO, não movimento de dinheiro: não pode entrar em nenhum somatório, e
-- em acerto_linha acabaria por entrar mais cedo ou mais tarde.
alter table acerto
  add column if not exists semanas jsonb not null default '[]'::jsonb;

comment on column acerto.semanas is
  'Snapshot da linha do tempo semanal por moto no fecho: [{matricula, rotulo, inicio, fim, estado, valor, devido, desconto, motorista, nota}]. Informativo — nunca entra no líquido.';
