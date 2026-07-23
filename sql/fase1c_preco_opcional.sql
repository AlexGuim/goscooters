-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1c — Preço obrigatório só para veículos publicados no catálogo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr no SQL Editor do Supabase.
--
-- Porquê: a constraint anterior (moto_pelo_menos_um_preco) exigia um preço em
-- TODOS os veículos. Mas a frota inclui veículos internos sem renda atribuída
-- (inativos, do Alexandre). Um preço só faz sentido obrigatório quando o
-- veículo é anunciado publicamente (ativo=true).

alter table moto drop constraint if exists moto_pelo_menos_um_preco;

alter table moto add constraint moto_preco_se_ativo
  check (
    ativo = false
    or preco_dia is not null
    or preco_semana is not null
    or preco_mes is not null
  );
