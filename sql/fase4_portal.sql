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
