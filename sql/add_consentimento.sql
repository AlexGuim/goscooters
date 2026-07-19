-- Prova de consentimento RGPD
--
-- A aplicação já EXIGE o consentimento antes de gravar um pedido, mas ainda não
-- guarda a prova de que foi dado. O RGPD exige que o responsável consiga
-- demonstrar esse consentimento (art. 7.º, n.º 1), por isso convém registar o
-- momento em que foi prestado.
--
-- Correr no SQL Editor do Supabase. Depois, acrescentar o campo a
-- src/types/db.ts e preenchê-lo em src/actions/createPedido.ts.

alter table pedido_aluguer
  add column if not exists consentimento_em timestamptz;

comment on column pedido_aluguer.consentimento_em is
  'Momento em que o titular autorizou o tratamento dos dados no formulário de pedido.';
