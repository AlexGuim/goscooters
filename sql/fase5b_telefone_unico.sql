-- ═══════════════════════════════════════════════════════════════════════════
-- Backstop de deduplicação de motoristas por telefone.
--
-- As jornadas (converterPedidoEmJornada, criarSessaoRegisto) fazem "procura por
-- telefone → se não existe, cria". Sem um índice ÚNICO, duas execuções em
-- paralelo com o mesmo número criam dois motoristas (TOCTOU). Este índice fecha
-- essa janela na base de dados — o código já trata o conflito (23505) reusando o
-- registo existente.
--
-- ⚠️ SEPARADO do fase5_jornada de propósito: se existirem telefones DUPLICADOS
-- em registos legados (import do Notion), a criação do índice FALHA. Corre antes:
--   select telefone_digitos, count(*) from motorista
--    where telefone_digitos is not null and telefone_digitos <> ''
--    group by telefone_digitos having count(*) > 1;
--   -- deve dar 0 linhas. Se der, funde/limpa os duplicados primeiro.
-- ═══════════════════════════════════════════════════════════════════════════

create unique index if not exists motorista_telefone_digitos_unico
  on motorista (telefone_digitos)
  where telefone_digitos is not null and telefone_digitos <> '';
