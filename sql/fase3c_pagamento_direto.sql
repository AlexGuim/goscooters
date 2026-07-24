-- ═══════════════════════════════════════════════════════════════════════════
-- Direção do acerto: renda paga diretamente na conta do parceiro.
--
-- A maioria das motos de parceiro é paga direto na conta do dono. Nesse caso o
-- parceiro já recebeu a renda, pelo que no acerto DEVE a comissão (e o reembolso
-- de despesas adiantadas) à GoScooters — em vez de receber o líquido.
--
-- Líquido a transferir ao parceiro = renda cobrada PELA GoScooters − comissão −
-- despesas. Se a renda foi paga direto, a parte cobrada pela GoScooters é 0, e o
-- líquido fica negativo (o parceiro paga à GoScooters).
-- ═══════════════════════════════════════════════════════════════════════════

alter table proprietario
  add column if not exists recebe_pagamento_direto boolean not null default false;

comment on column proprietario.recebe_pagamento_direto is
  'true = rendas pagas direto na conta do parceiro; no acerto o parceiro deve a comissao a GoScooters.';
