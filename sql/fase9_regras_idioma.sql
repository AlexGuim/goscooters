-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 9 — Regras do aluguer em várias línguas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr DEPOIS do fase4_regras.sql. Cada versão das regras passa a ter uma
-- LÍNGUA (pt/en) e há uma versão ativa POR LÍNGUA — o motorista vê/aceita as
-- regras na sua língua (idioma_preferido), com recuo para PT se ainda não houver
-- versão nessa língua. As linhas existentes ficam em 'pt' (default). Idempotente.

alter table regras_aluguer add column if not exists idioma text not null default 'pt';

alter table regras_aluguer drop constraint if exists regras_idioma_check;
alter table regras_aluguer add constraint regras_idioma_check check (idioma in ('pt', 'en'));

-- "só uma ativa" passa a "só uma ativa POR LÍNGUA".
drop index if exists regras_uma_ativa;
create unique index if not exists regras_uma_ativa_idioma
  on regras_aluguer (idioma) where ativa;
