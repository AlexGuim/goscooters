-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1b — Adenda: comissão por veículo + tipo de parceiro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr DEPOIS do fase1_nucleo.sql. Só acrescenta colunas.
--
-- Porquê: a comissão não é uniforme por parceiro — é por VEÍCULO. O Felipe tem
-- 3 motos pioneiras a 20% e a CJ a 25%. Logo, a % base vive no proprietário e um
-- override pontual vive no veículo. Comissão efetiva = COALESCE(override, base).

alter table moto
  add column if not exists comissao_valor_override numeric;

comment on column moto.comissao_valor_override is
  'Comissão % específica deste veículo. NULL = usa a base do proprietário (comissao_valor).';

-- Distinção de parceiro, como semente para o futuro (sem lógica associada agora):
--   gerido     = GoScooters gere as motos e faz o acerto (modelo atual).
--   anunciante = só divulga as motos na plataforma; monetização a definir
--                (venda de leads, tráfego/anúncios, parcerias com oficinas...).
alter table proprietario
  add column if not exists tipo_parceiro text not null default 'gerido'
      check (tipo_parceiro in ('gerido', 'anunciante'));

comment on column proprietario.tipo_parceiro is
  'gerido = frota gerida pela GoScooters; anunciante = só divulgação (modelo futuro).';
