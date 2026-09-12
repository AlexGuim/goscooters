# Publicar a F0a, a U21 e a correção dos acertos

Ramo `fix/privacidade-portagem-telegram`. Quatro commits sobre o main 080c6bf:
a correção dos acertos, a U21 (colunas públicas de moto), a F0a (coimas e
portagens fora do público; Telegram e Gemini sem dados pessoais) e os SQL das
fases 14 e 15, por aplicar. Tudo foi testado: tsc, eslint, 94 testes node, next
build, o teste de integração contra a demo e o ensaio das fases 14 e 15 na demo.

Cada passo que escreve na produção só avança quando o anterior está confirmado.

## 0. Antes

- Na Vercel, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY` e
  `ADMIN_EMAIL` só em **Production**.
- Ninguém a usar o intake nesse momento: o passo 2 mexe no aviso de portagem.

## 1. Publicar

No `~/Plataforma-f0a`:

```sh
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "avança sem merge" || echo "PARAR: o main mudou"
git push origin HEAD:main
```

Se o main tiver mudado, não se força: faz-se rebase, voltam a correr as
verificações e só depois se publica. Na Vercel, esperar pelo deploy **Ready**
e confirmar no admin que a versão no ar é a do último commit do ramo.

## 2. Tirar do público o aviso de portagem

No `~/Plataforma-f0a` (as credenciais vêm do `.env.local`, que é o da produção):

```sh
node scripts/mover-infracoes-para-privado.mjs
node scripts/mover-infracoes-para-privado.mjs --aplicar --projeto=yovltmvjclgtxlfprzjl
```

Esperar 3 minutos e correr outra vez a seco. Tem de dizer **Nada por fazer**. O CDN
do Supabase ainda serve um PDF apagado durante até ~2 minutos (medido na demo a
12/09/2026). Se o `--aplicar` disser que o URL «continua legível sem login», é
isso: repete-se a seco depois de 3 minutos.

## 3. Auditoria do bucket público

```sh
node scripts/auditar-documentos-publicos.mjs
```

Sai com 0 só se não houver órfãos nem «possível cópia pública de ficheiro já em
privado». Se aparecerem órfãos, lê-se a lista antes de decidir: o `--mover` põe-nos
em quarentena privada e o `--repor` devolve-os.

## 4. Fase 14: colunas públicas de moto

No `~/Plataforma-instancias` (a ligação vem de `~/.config/plataforma/instancias/goscooters.env`):

```sh
npm run sql -- --instancia goscooters ~/Plataforma-f0a/sql/fase14_colunas_publicas_moto.sql
npm run sql -- --instancia goscooters --aplicar ~/Plataforma-f0a/sql/fase14_colunas_publicas_moto.sql
```

Antes, correr com `--consulta` as duas consultas de ANTES DE CORRER do ficheiro.
Depois, as de VERIFICAR, mais estas verificações:

- no site, o catálogo (`/pt`), a página de uma mota e o formulário de pedido abrem;
- pela API com a chave pública, `moto?select=matricula` dá 401, code 42501.

Se o catálogo ficar vazio, o deploy do passo 1 não está no ar: corre-se já a
REVERSÃO do ficheiro.

## 5. Fase 15: endurecer a chave pública (só com o ok do Alex)

```sh
npm run sql -- --instancia goscooters ~/Plataforma-f0a/sql/fase15_endurecer_chave_publica.sql
npm run sql -- --instancia goscooters --aplicar ~/Plataforma-f0a/sql/fase15_endurecer_chave_publica.sql
```

O ensaio não lista os blocos DO; é normal. Antes, a consulta de ANTES DE CORRER
tem de dar anon 13 e nenhuma linha para authenticated. Depois, VERIFICAR 1 a 7.
Na prova do pedido pela API usa-se o corpo com nulos, para não gravar nada.

## 6. O acerto fechado sem linhas (só com o ok do Alex)

A produção tem 1 acerto em 5 fechado sem linhas, de antes da correção. Identifica-se
só com leituras:

```sh
npm run sql -- --instancia goscooters --consulta "select a.id, a.competencia_mes, a.estado, (select count(*) from acerto_linha l where l.acerto_id = a.id) as linhas from acerto a order by a.competencia_mes"
```

Refazê-lo implica apagar esse acerto e voltar a fechá-lo no admin. O procedimento
decide-se nessa altura, com o Alex, e nada se apaga antes disso.

## 7. Depois

- No `feat/instancias`: rebase sobre o main e voltar a extrair a base selada. A
  impressão digital da produção muda com as fases 14 e 15.
- Alinhar a `0004_permissoes_minimas_anon` e a lista branca de `scripts/db/lib.mjs`
  com as 13 colunas só para a anon (hoje são 17).
- Passar para `src/lib/acertoCalculo.ts` as duas alterações da F0a ao `computar`.

## Voltar atrás

- **Antes da fase 14:** volta-se ao deploy anterior na Vercel.
- **Com a fase 14 aplicada:** primeiro a REVERSÃO da fase 14, depois o deploy
  anterior. Ao contrário, o catálogo fica vazio.
- **Com a fase 15 aplicada:** REVERSÃO da fase 15 e a seguir a da fase 14.
- **Depois do passo 2:** o código antigo mostra partidos (mas seguros) os links das
  coimas e portagens, que se abrem pelo painel do Supabase. É melhor corrigir para
  a frente do que voltar atrás.

## Notas

- O Telegram e o Twilio não estão configurados na produção. Quando se ligar o
  Telegram, as mensagens já não levam dados pessoais.
- Se `NEXT_PUBLIC_SITE_URL` estiver definido na Vercel, é esse o endereço dos
  links nas mensagens ao gestor.
- O `.env.local` do Desktop (no iCloud) ainda tem `SUPABASE_DB_URL`. Os comandos
  acima não precisam dele; convém retirá-lo.
