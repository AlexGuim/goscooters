-- fase15: a chave pública deixa de poder escrever, ler tabelas e chamar funções da aplicação.
--
-- ============================================================================
-- ORDEM
--   1. Só DEPOIS da fase14 aplicada e com o código dela no ar. Esta fase não
--      mexe no SELECT por colunas de moto que a fase14 dá à anon.
--   2. Não precisa de deploy: nenhum código usa a chave pública para escrever,
--      chamar funções ou ler outra tabela além de moto (verificado a
--      12/09/2026: só as 4 leituras de moto do site usam supabaseServer, sem
--      sessão; tudo o resto usa supabaseAdmin; os carregamentos usam
--      uploadToSignedUrl).
--   3. Comandos:
--        produção, no checkout do main:  npm run sql -- sql/fase15_endurecer_chave_publica.sql
--        instância com controlo da plataforma (ramo feat/instancias):
--          npm run sql -- --instancia <nome> --forcar [--aplicar] sql/fase15_endurecer_chave_publica.sql
--      O ensaio (sem --aplicar) não lista os dois blocos DO, que fazem quase
--      todas as revogações: é normal.
-- ============================================================================
--
-- PORQUÊ
-- As default privileges do Supabase dão a anon e authenticated todos os
-- privilégios nas tabelas e vistas de public (arwdDxtm), nas sequências (rwU)
-- e EXECUTE nas funções, que o Postgres também dá a PUBLIC por omissão. Hoje é
-- só a RLS que trava, com duas exceções:
--  1. A política "criar pedido publico" (FOR INSERT TO public WITH CHECK (true))
--     em pedido_aluguer deixa qualquer pessoa com a chave pública (vai no código
--     do site) criar pedidos diretamente pela API, sem passar pelo createPedido:
--     sem consentimento registado, com qualquer estado e sem aviso ao gestor. O
--     site não precisa dela: createPedido grava com service_role
--     (src/actions/createPedido.ts:95-99).
--  2. /rest/v1/rpc/fn_gerar_cobrancas está exposto à chave pública (por anon,
--     authenticated e PUBLIC). A função é SECURITY INVOKER e a RLS trava as
--     escritas, mas não há razão para estar exposta: só é chamada com
--     service_role (cron /api/cron/lembretes, contratoActions, vistoriaActions).
--
-- O QUE FAZ
--  - Apaga a política "criar pedido publico".
--  - Tabelas, vistas e sequências de public: retira tudo a anon e authenticated.
--    Em moto, a anon mantém só o SELECT por colunas da fase14.
--  - Funções DA APLICAÇÃO em public (não as das extensões): retira o EXECUTE a
--    PUBLIC, anon e authenticated e confirma-o ao service_role. Os gatilhos
--    continuam a disparar: o EXECUTE verifica-se quando o gatilho é criado.
--  - Default privileges do postgres em public: tabelas, sequências e funções
--    que o postgres criar daqui em diante já não dão nada a anon e authenticated.
--    As linhas do postgres já incluem o service_role (verificado na demo a
--    12/09/2026), por isso não se lhes junta nada.
--
-- LIMITES (o que esta fase não resolve, de propósito)
--  - O EXECUTE a PUBLIC numa função NOVA vem do valor por omissão do Postgres, e
--    uma default privilege por esquema só soma a esse valor. Cada função nova tem
--    de fazer `revoke execute on function … from public, anon, authenticated`
--    (como a migração 0003 do pacote de instâncias).
--  - As 3 default privileges do supabase_admin em public, e as funções das
--    extensões instaladas em public (btree_gist e outras, donas supabase_admin),
--    não se mudam com o utilizador postgres. Não se toca no EXECUTE delas: a
--    restrição EXCLUDE de cobranca usa a btree_gist ao gravar. Mover as
--    extensões para o esquema extensions é uma decisão à parte.
--
-- O QUE NÃO MUDA
--  - service_role mantém tudo: é por ele que a app lê e escreve.
--  - A RLS continua ativa, e a política de leitura de motas ativas fica.
--  - Storage (buckets) e Auth não são tocados.
--
-- PACOTE DE INSTÂNCIAS
--  - Com as fases 14 e 15 aplicadas, as pós-verificações de permissões mínimas
--    do pacote (avaliarPosVerificacoes com permissoesMinimas) dão 0 bloqueios e
--    0 avisos (antes: 445 bloqueios). Ensaio na demo a 12/09/2026.
--  - db/base/0001_esquema_public.sql foi extraído antes desta fase: voltar a
--    extrair a base depois de aplicar as fases 14 e 15 na produção.
--  - Alinhar a 0004_permissoes_minimas_anon planeada com esta fase: 13 colunas
--    só para a anon (a lista branca de scripts/db/lib.mjs tem 17, incluindo
--    marca, ano, cor e tipo_veiculo, que o site não usa), apagar a política
--    "criar pedido publico" e retirar também o EXECUTE a PUBLIC nas funções da
--    aplicação (a 0004 planeada só o retira a anon e authenticated).
--
-- ANTES DE CORRER (só leitura)
--   select grantee, count(*) from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'moto'
--      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT'
--    group by grantee;
--   Esperado: anon 13 e nenhuma linha para authenticated (a fase14 está
--   aplicada). Se der 30, parar: falta a fase14.
--
-- IDEMPOTENTE: pode correr-se de novo com o mesmo resultado. O ficheiro corre
-- inteiro numa transação.
--
-- ENSAIADO NA DEMO a 12/09/2026: VERIFICAR 1 a 6 ok (401, code 42501 e a
-- mensagem exata), gatilhos e restrição EXCLUDE ok, reversões testadas e demo
-- reposta. NÃO APLICADO na produção: falta o ok do Alex.

drop policy if exists "criar pedido publico" on public.pedido_aluguer;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if r.relname = 'moto' then
      -- Um REVOKE ALL de tabela à anon apagava também o SELECT por colunas da fase14.
      execute format(
        'revoke insert, update, delete, truncate, references, trigger, maintain on public.%I from anon',
        r.relname);
      execute format('revoke all on public.%I from authenticated', r.relname);
    else
      execute format('revoke all on public.%I from anon, authenticated', r.relname);
    end if;
  end loop;
end
$$;

revoke all on all sequences in schema public from anon, authenticated;

do $$
declare
  f record;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
end
$$;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- VERIFICAR (só leitura, depois de correr)
--   1) Políticas:
--        select tablename, policyname, cmd from pg_policies where schemaname = 'public';
--      Esperado: só moto | leitura publica de motas ativas | SELECT.
--   2) Privilégios de tabela, vista e sequência para anon e authenticated:
--        select c.relname, c.relacl from pg_class c
--         where c.relnamespace = 'public'::regnamespace
--           and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
--           and c.relacl::text ~ '(^|[{,])(anon|authenticated)=';
--      Esperado: nenhuma linha.
--   3) Colunas de moto: a consulta de ANTES DE CORRER. Esperado: anon 13; authenticated nenhuma.
--   4) Funções da aplicação:
--        select p.oid::regprocedure from pg_proc p
--         where p.pronamespace = 'public'::regnamespace
--           and not exists (select 1 from pg_depend d
--                            where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
--           and (has_function_privilege('anon', p.oid, 'EXECUTE')
--                or has_function_privilege('authenticated', p.oid, 'EXECUTE')
--                or not has_function_privilege('service_role', p.oid, 'EXECUTE'));
--      Esperado: nenhuma linha.
--   5) Default privileges:
--        select pg_get_userbyid(defaclrole) as dono, defaclobjtype, defaclacl
--          from pg_default_acl where defaclnamespace = 'public'::regnamespace order by 1, 2;
--      Esperado: nas linhas do postgres (r, S, f) não aparecem anon nem authenticated;
--      as 3 linhas do supabase_admin ficam como estavam (ver LIMITES).
--   6) Pela API, com a chave PÚBLICA (confirmar antes, sem a mostrar, que o JWT
--      tem role anon e não é a service role):
--        GET  /rest/v1/moto?select=id,modelo&ativo=eq.true  -> 200
--        POST /rest/v1/pedido_aluguer com o corpo {"nome": null, "telefone": null}
--             -> 401, code 42501, "permission denied for table pedido_aluguer".
--             Os nulos garantem que nenhuma linha fica gravada. Um erro de RLS
--             ("row-level security") ou 400/23502 quer dizer que o privilégio
--             continua lá.
--        POST /rest/v1/rpc/fn_gerar_cobrancas com
--             {"p_contrato_id": "00000000-0000-0000-0000-000000000000", "p_ate": "2000-01-01"}
--             -> 401, code 42501, "permission denied for function fn_gerar_cobrancas"
--        GET  /rest/v1/contrato_aluguer?select=id  -> 401, code 42501 (antes: 200 com [])
--      Um 404 com PGRST20x NÃO é prova: é tabela ou função fora da cache do PostgREST.
--   7) Na app: catálogo, página de uma mota, enviar um pedido pelo formulário (e
--      apagá-lo no admin), admin (contratos, cobranças, despesas, acertos),
--      portal do parceiro e o cron.
--
-- REVERSÃO (volta ao estado pós-fase14 com os mesmos privilégios; só muda a
-- ordem dos itens nos ACL — anon e authenticated, e PUBLIC nas 5 funções,
-- ficam depois de service_role —, o que não altera o acesso)
--   create policy "criar pedido publico" on public.pedido_aluguer
--     as permissive for insert to public with check (true);
--   do $$ declare r record; begin
--     for r in select c.relname from pg_class c
--               where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
--                 and c.relname not in ('moto', 'configuracao_instancia')
--     loop execute format('grant all on public.%I to anon, authenticated', r.relname); end loop;
--   end $$;
--   grant insert, update, delete, truncate, references, trigger, maintain on public.moto to anon, authenticated;
--   grant all on all sequences in schema public to anon, authenticated;
--   grant execute on function public.fn_gerar_cobrancas(uuid, date), public.fn_cobranca_reavaliar(),
--     public.fn_km_atual(), public.fn_recalc_cobranca(), public.set_updated_at()
--     to public, anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
-- Para voltar ao estado ANTES da fase14, correr a seguir a REVERSÃO da fase14.
-- Ensaiada na demo (pacote 0001–0003) a 12/09/2026: repõe os mesmos
-- privilégios. Se uma migração futura do pacote criar tabelas ou vistas só para
-- service_role, acrescentá-las ao "not in" do ciclo. Para repor também a ordem
-- dos itens, usar uma fotografia dos ACL tirada antes de aplicar.
