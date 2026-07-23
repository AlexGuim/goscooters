-- ═══════════════════════════════════════════════════════════════════════════
-- Deduplicação de faturas importadas.
--
-- Impede registar duas vezes a MESMA fatura (mesmo fornecedor + referência).
-- Índice PARCIAL: só se aplica quando ambos os campos existem — despesas
-- manuais sem referência não são afetadas.
--
-- A verificação também é feita na aplicação (gravarDespesaDeFatura), mas o
-- índice é a rede de segurança na base de dados (corridas, imports, etc.).
-- ═══════════════════════════════════════════════════════════════════════════

-- A chave inclui o VALOR: faturas diferentes do mesmo fornecedor com a mesma
-- referência (ex.: um "Processo Nº" repetido) mas valores distintos não colidem.
create unique index if not exists despesa_fatura_unica
  on despesa (fornecedor, referencia_externa, valor)
  where fornecedor is not null and referencia_externa is not null;
