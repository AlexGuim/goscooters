-- ═══════════════════════════════════════════════════════════════════════════
-- Carta de condução do motorista (o documento mais crítico para a PCX 125).
--
-- Sem carta válida e adequada à categoria, o motorista conduz sem cobertura do
-- seguro. Guardamos número, categoria, país emissor e validade; as imagens
-- (frente/verso) ficam em motorista.doc_urls (bucket privado).
-- ═══════════════════════════════════════════════════════════════════════════

alter table motorista
  add column if not exists carta_numero    text,
  add column if not exists carta_categoria text,   -- ex.: A1, A, B
  add column if not exists carta_pais      text,   -- ISO-2 do país emissor
  add column if not exists carta_validade  date;
