-- ═══════════════════════════════════════════════════════════════════════════
-- Quem recebeu cada pagamento: GoScooters ou o parceiro (na conta dele).
--
-- Por omissão, os pagamentos são recebidos pela GoScooters. Mas em motos de
-- parceiro pago direto, o dinheiro entra na conta do parceiro — e o admin marca
-- isso ao registar o pagamento. Pode variar POR PAGAMENTO (às vezes um parceiro
-- pago direto recebe via GoScooters, e vice-versa).
--
-- O acerto usa isto para separar a receita cobrada pela GoScooters da que foi
-- direta ao parceiro, e assim calcular o líquido/dívida com precisão.
-- ═══════════════════════════════════════════════════════════════════════════

alter table pagamento
  add column if not exists recebido_por text not null default 'goscooters'
    check (recebido_por in ('goscooters', 'proprietario'));

comment on column pagamento.recebido_por is
  'goscooters = a GoScooters recebeu; proprietario = pago direto na conta do parceiro.';

-- Retroativo (uma vez): os pagamentos JÁ alocados a cobranças de parceiros com
-- recebe_pagamento_direto = true passam a 'proprietario' — assume-se que
-- seguiram o arranjo em vigor. Daí em diante, é o toggle por pagamento que manda.
update pagamento p
   set recebido_por = 'proprietario'
 where p.recebido_por = 'goscooters'
   and exists (
     select 1
       from pagamento_cobranca pc
       join cobranca c on c.id = pc.cobranca_id
       join proprietario pr on pr.id = c.proprietario_id
      where pc.pagamento_id = p.id
        and pr.recebe_pagamento_direto = true
   );
