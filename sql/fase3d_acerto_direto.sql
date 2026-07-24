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
