-- ═══════════════════════════════════════════════════════════════════════════
-- Alargar as línguas do motorista para além de pt/en.
--
-- O público é imigrante e multilíngue. Removemos o CHECK que só permitia pt/en;
-- os valores válidos passam a ser controlados pela aplicação (lista IDIOMAS),
-- evitando ter de mexer no schema sempre que se acrescenta uma língua.
-- ═══════════════════════════════════════════════════════════════════════════

alter table motorista drop constraint if exists motorista_idioma_preferido_check;
