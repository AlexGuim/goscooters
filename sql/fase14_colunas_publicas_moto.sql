-- fase14: a chave pública só lê as colunas de `moto` que o site mostra.
--
-- ============================================================================
-- ORDEM OBRIGATÓRIA
--   1. PRIMEIRO publicar o código que deixa de pedir select("*") nas leituras
--      públicas (src/lib/motoPublica.ts, src/app/[lang]/page.tsx,
--      src/app/[lang]/moto/[id]/page.tsx,
--      src/app/[lang]/moto/[id]/pedido/page.tsx e src/app/sitemap.ts) e
--      confirmar no admin que essa versão está no ar.
--   2. SÓ DEPOIS correr este ficheiro:
--        produção, no checkout do main:  npm run sql -- sql/fase14_colunas_publicas_moto.sql
--        instância com controlo da plataforma (ramo feat/instancias):
--          npm run sql -- --instancia <nome> --forcar [--aplicar] sql/fase14_colunas_publicas_moto.sql
--
--   Pela ordem inversa, o código antigo continua a pedir todas as colunas e o
--   PostgREST responde "permission denied for table moto": o catálogo fica
--   vazio e as páginas das motas dão 404 até o deploy novo entrar.
--   Pela mesma razão, um rollback do deploy para uma versão anterior a esta
--   obriga a correr PRIMEIRO a REVERSÃO (no fim do ficheiro).
--   E, depois de correr, qualquer deploy de um ramo sem este commit (um hotfix
--   feito a partir de um main antigo, ou o feat/instancias antes do rebase)
--   volta a pedir select("*") e esvazia o catálogo. Por isso: só correr com o
--   commit já no main, e fazer rebase dos ramos em curso antes de os publicar.
--   No script de atualizações das instâncias, esta fase é uma exceção à regra
--   "base antes do código": aqui o código vai primeiro.
-- ============================================================================
--
-- PORQUÊ
-- A anon key é pública: vai no bundle do browser. As default privileges do
-- Supabase dão SELECT na tabela inteira a anon e authenticated, e a política
-- RLS "leitura pública de motas ativas" (USING ativo = true) só escolhe LINHAS,
-- não colunas. Resultado: um GET anónimo a /rest/v1/moto?select=* devolvia as
-- 30 colunas de cada mota ativa, incluindo proprietario_id, matricula,
-- km_atual, valor_aquisicao e comissao_valor_override, e o site não usa
-- nenhuma delas. A página do pedido chegava a mandá-las todas para o browser,
-- porque passava a linha inteira ao formulário (Client Component).
--
-- O QUE FAZ
-- Retira o SELECT de tabela a anon e authenticated e devolve à anon só as colunas
-- que as leituras públicas usam: as que vêm na resposta e as que só aparecem
-- em filtros e ordenação (o Postgres exige SELECT em ambas). A lista tem de
-- coincidir com src/lib/motoPublica.ts; src/lib/motoPublica.test.mjs compara
-- as duas e falha se encontrar uma leitura de moto com a chave anónima fora
-- dessas listas.
-- `authenticated` perde o SELECT e não recebe colunas: nenhum código lê moto com
-- esse papel (o site usa supabaseServer, sem sessão, que é sempre anon), e a lista
-- branca do pacote de instâncias só admite colunas para a anon.
--
-- O QUE NÃO MUDA
-- - A política RLS fica como está: continua a decidir QUE motas se veem; isto
--   decide QUE colunas. `ativo` está na lista porque as leituras filtram por ele.
-- - service_role não é tocado: mantém o SELECT de tabela e ignora a RLS. É por
--   ele (supabaseAdmin) que leem moto o admin, o portal do parceiro, as actions
--   (incluindo createPedido), as páginas por token e os crons.
--
-- EFEITO LATERAL (esperado)
-- A vista vw_manutencao_proxima (security_invoker, fase11b) junta
-- moto.matricula, km_atual e estado_operacional. Com a chave anónima passa de
-- "0 linhas" (RLS de manutencao) a "permission denied for table moto". Só é
-- lida por service_role (chatActions, notificacoesDerivadas): nada muda na app.
--
-- ANTES DE CORRER (só leitura): as políticas RLS não estão em sql/, por isso
-- confirmar em produção que nenhuma política de OUTRA tabela consulta moto (se
-- houvesse, correria como anon/authenticated e passava a falhar):
--   select schemaname, tablename, policyname from pg_policies
--    where coalesce(qual, '') || coalesce(with_check, '') ~* '\mmoto\M';
--   Esperado: nenhuma linha.
--   select view_schema, view_name from information_schema.view_table_usage
--    where table_schema = 'public' and table_name = 'moto';
--   Esperado: só vw_manutencao_proxima (ver EFEITO LATERAL).
--
-- IDEMPOTENTE: um REVOKE de tabela retira também os privilégios por coluna, por
-- isso voltar a correr (mesmo com a lista alterada) deixa exatamente esta lista.
-- As duas instruções têm de correr juntas: o `npm run sql` põe o ficheiro
-- inteiro numa transação, e se o GRANT falhar o REVOKE também é desfeito.
--
-- ENSAIADO NA DEMO a 12/09/2026 (13 colunas só para a anon; provas pela API ok;
-- demo reposta a seguir). NÃO APLICADO na produção. Correr só depois do passo 1
-- da ORDEM OBRIGATÓRIA.

revoke select on public.moto from anon, authenticated;

grant select (
  id,                                 -- links; filtro da página da mota
  modelo, cilindrada, descricao,      -- cartão, página, metadata
  preco_dia, preco_semana, preco_mes, -- preços e filtro de preço máximo
  estado, disponivel_em,              -- selo de disponibilidade; exclui "manutencao"
  foto_urls, video_url,               -- galeria, imagem de partilha, vídeo
  ativo,                              -- só em filtros (motas ativas)
  created_at                          -- ordem do catálogo; lastModified do sitemap
) on public.moto to anon;

-- VERIFICAR (só leitura, depois de correr)
--   select grantee, string_agg(column_name, ', ' order by column_name) as colunas
--     from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'moto'
--      and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
--    group by grantee;
--   Esperado: as 13 colunas acima para anon e nenhuma linha para authenticated
--   (antes: as 30 para os dois).
--   Pela API, com a anon key: /rest/v1/moto?select=id,modelo -> 200;
--   /rest/v1/moto?select=matricula -> 401, code 42501, "permission denied for table moto".
--
-- REVERSÃO (volta ao SELECT da tabela inteira; correr ANTES de um rollback do
-- deploy para uma versão que ainda faça select("*"))
--   revoke select (id, modelo, cilindrada, descricao, preco_dia, preco_semana,
--                  preco_mes, estado, disponivel_em, foto_urls, video_url,
--                  ativo, created_at)
--     on public.moto from anon;
--   grant select on public.moto to anon, authenticated;
