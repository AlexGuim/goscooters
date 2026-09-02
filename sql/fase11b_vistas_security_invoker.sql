-- fase11b: fechar as VISTAS, que estavam a contornar o RLS (CORRER JÁ).
--
-- Em Postgres, uma vista corre com os privilégios de QUEM A CRIOU, não de quem
-- a consulta. Por isso as três vistas do projeto liam as tabelas por baixo com
-- os poderes do dono e devolviam tudo — mesmo com RLS ativo nessas tabelas.
--
-- Verificado contra produção, com a chave anónima (a que vai no bundle do
-- browser, visível a qualquer pessoa que abra o site):
--   cobranca              → 0 linhas   (RLS a funcionar)
--   vw_cobranca_estado    → 207 linhas ⚠️  motorista, valores, o que está em dívida
--   vw_manutencao_proxima → 4 linhas   ⚠️
--   vw_seguro_estado      → 2 linhas   ⚠️
--
-- `security_invoker` (Postgres 15+; este projeto corre 17.6) inverte isso: a
-- vista passa a ser avaliada com os direitos de quem consulta, portanto o RLS
-- das tabelas de base aplica-se. A aplicação não nota diferença — lê tudo por
-- service_role, que ignora RLS por definição.

alter view vw_cobranca_estado    set (security_invoker = on);
alter view vw_manutencao_proxima set (security_invoker = on);
alter view vw_seguro_estado      set (security_invoker = on);
