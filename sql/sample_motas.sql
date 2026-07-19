-- Sample data para o catálogo de motas
-- Insere 3 motas de exemplo na tabela "moto"

insert into moto (modelo, cilindrada, matricula, preco_mes, estado, disponivel_em, foto_urls, descricao, ativo)
values
  ('Honda PCX 125', 125, '12-AB-34', 220.00, 'disponivel', null, array['https://images.unsplash.com/photo-1517511620798-cec17d428bc0?auto=format&fit=crop&w=900&q=80'], 'Mota urbana confortável para entregas e corridas na cidade.', true),
  ('Yamaha NMAX 155', 155, '56-CD-78', 250.00, 'alugada', '2026-06-25', array['https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80'], 'Mota ágil com mais potência para trajetos mais longos.', true),
  ('Kymco Agility 125', 125, '90-EF-12', 200.00, 'disponivel', null, array['https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80'], 'Economia e facilidade de estacionamento para motoristas de plataformas.', true);
