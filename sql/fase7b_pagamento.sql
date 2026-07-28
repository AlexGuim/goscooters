-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 7b — Gatilho 'pagamento_a_vencer' (lembretes de pagamento)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr DEPOIS do fase7_procedimentos.sql. Adiciona o gatilho de lembrete de
-- pagamento ao motor de procedimentos e semeia a regra por omissão (véspera,
-- manual). O cron/varredura gera então uma notificação por cobrança a vencer,
-- com o link WhatsApp pronto, e empurra um aviso por Telegram ao gestor.

alter table procedimento drop constraint if exists procedimento_gatilho_check;
alter table procedimento add constraint procedimento_gatilho_check
  check (gatilho in ('coima_registada', 'portagem_registada', 'seguro_registado',
                     'seguro_a_expirar', 'manutencao_a_vencer', 'doc_motorista_a_expirar',
                     'pagamento_a_vencer'));

-- Regra por omissão: lembrar 1 dia antes (véspera), modo manual (prepara o wa.me).
-- condicoes.dias_antes = horizonte (0 = no próprio dia; 1 = também a véspera).
insert into procedimento (nome, gatilho, acao, canal, modo, condicoes)
select 'Lembrar pagamento (véspera)', 'pagamento_a_vencer', 'comunicar_motorista', 'preparar', 'manual', '{"dias_antes": 1}'::jsonb
where not exists (select 1 from procedimento p where p.gatilho = 'pagamento_a_vencer');
