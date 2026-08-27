-- fase10b: fechar a acerto_ajuste (correção de segurança — CORRER JÁ).
--
-- A fase10 criou a tabela sem `enable row level security`. Como o projeto não
-- usa `revoke`, valem as default privileges do Supabase (grant a anon e
-- authenticated) e a RLS é a ÚNICA barreira — por isso a tabela ficou legível
-- (e escrevível) por quem tenha a anon key, que é pública: vai no bundle do
-- browser. Verificado contra produção: um GET anónimo a /rest/v1/acerto_ajuste
-- devolvia linhas, enquanto motorista/pagamento/cobranca devolviam vazio.
--
-- Sem políticas, de propósito: todo o acesso da app é por service_role, que
-- ignora a RLS. É exatamente o que as outras tabelas fazem (ver fase2, fase3).

alter table acerto_ajuste enable row level security;
