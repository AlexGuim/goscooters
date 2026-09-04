-- fase13: o idioma por omissão de um motorista novo passa a INGLÊS.
--
-- A frota é maioritariamente estrangeira. Com o default a 'pt', cada motorista
-- novo nascia em português e ninguém se lembrava de corrigir — 44 dos 45
-- estavam a 'pt', quase todos sem o ser. O default certo é o caso comum.
--
-- NÃO mexe nos registos existentes de propósito: há motoristas mesmo lusófonos
-- (nomes portugueses e brasileiros na lista) e virá-los todos para inglês
-- trocaria um erro por outro. Os que estiverem mal corrigem-se sozinhos: o
-- ecrã de entrega passou a deixar o próprio motorista escolher a língua, e essa
-- escolha grava na ficha.

alter table motorista alter column idioma_preferido set default 'en';

comment on column motorista.idioma_preferido is
  'Língua do motorista (pt|en). Default en: a maioria da frota é estrangeira. O próprio motorista pode mudá-la no ecrã de entrega.';
