-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 8 — Limiares configuráveis dos alertas proativos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Correr DEPOIS do fase7_procedimentos.sql. Cria as regras de MANUTENÇÃO e de
-- DOCUMENTOS DO MOTORISTA (a de seguro já vem do fase7), para que os seus limiares
-- (dias antes / km antes) fiquem EDITÁVEIS nos Procedimentos. Os gatilhos já estão
-- no check do fase7. Idempotente — pode correr mais que uma vez sem duplicar.
--
-- Sem esta migração o sistema continua a funcionar: os alertas disparam com os
-- valores por omissão (30 dias / 500 km). Isto só os torna visíveis e ajustáveis.

insert into procedimento (nome, gatilho, acao, canal, modo, condicoes)
select 'Manutenção a vencer (alerta)', 'manutencao_a_vencer', 'alertar_gestor', 'telegram', 'auto',
       '{"dias_antes": 30, "km_antes": 500}'::jsonb
where not exists (select 1 from procedimento p where p.gatilho = 'manutencao_a_vencer');

insert into procedimento (nome, gatilho, acao, canal, modo, condicoes)
select 'Documento do motorista a expirar (alerta)', 'doc_motorista_a_expirar', 'alertar_gestor', 'telegram', 'auto',
       '{"dias_antes": 30}'::jsonb
where not exists (select 1 from procedimento p where p.gatilho = 'doc_motorista_a_expirar');

-- Dá à regra de seguro (já existente) um dias_antes explícito, para aparecer
-- preenchido no ecrã (o motor já assumia 30 por omissão).
update procedimento
   set condicoes = coalesce(condicoes, '{}'::jsonb) || '{"dias_antes": 30}'::jsonb
 where gatilho = 'seguro_a_expirar'
   and (condicoes is null or condicoes->>'dias_antes' is null);
