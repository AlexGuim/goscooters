-- Vídeo de apresentação por mota
--
-- Um vídeo opcional por mota. Null significa que não tem vídeo — e nesse caso
-- nada aparece, nem o selo no catálogo nem o leitor na página de detalhe.
--
-- Correr no SQL Editor do Supabase. Pode ser corrido mais do que uma vez.

alter table moto
  add column if not exists video_url text;

comment on column moto.video_url is
  'URL do vídeo de apresentação no Storage. Null = sem vídeo.';
