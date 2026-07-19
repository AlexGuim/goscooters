# Configuração da plataforma GoScooters

Passos que exigem contas ou credenciais externas e que, por isso, têm de ser
feitos por uma pessoa. Depois de cada um, há uma forma de confirmar que ficou bem.

---

## 1. Coluna de consentimento (RGPD)

A aplicação já **exige** o consentimento antes de gravar um pedido, mas ainda não
guarda a prova de que foi dado. O RGPD (art. 7.º, n.º 1) exige que se consiga
demonstrar esse consentimento.

1. Abrir [supabase.com](https://supabase.com) e entrar no projeto
2. Menu lateral → **SQL Editor** → **New query**
3. Colar e carregar em **Run**:

```sql
alter table pedido_aluguer
  add column if not exists consentimento_em timestamptz;

comment on column pedido_aluguer.consentimento_em is
  'Momento em que o titular autorizou o tratamento dos dados no formulário de pedido.';
```

**Como confirmar:** Table Editor → `pedido_aluguer` → a coluna `consentimento_em`
aparece no fim. Registos antigos ficam a `null`, o que é esperado.

Feito isto, falta ligar o código (acrescentar o campo a `src/types/db.ts` e
preenchê-lo em `src/actions/createPedido.ts`).

---

## 2. Email de notificação (Resend)

1. Criar conta em [resend.com](https://resend.com) — o plano gratuito dá 3.000
   emails por mês, mais do que suficiente
2. Confirmar o email de registo
3. Menu lateral → **API Keys** → **Create API Key**
   - Nome: `goscooters`
   - Permission: **Sending access**
4. Copiar a chave (começa por `re_`). **Só é mostrada uma vez.**
5. Acrescentar ao `.env.local`:

```
RESEND_API_KEY=re_a_tua_chave_aqui
RESEND_FROM=onboarding@resend.dev
```

### ⚠️ Limitação importante do modo de teste

Com o remetente `onboarding@resend.dev`, o Resend **só entrega emails para o
endereço com que registaste a conta**. Qualquer outro destinatário é recusado.

Ou seja: o `ADMIN_EMAIL` no `.env.local` tem de ser **o mesmo email da conta
Resend**, senão a notificação falha com erro 403.

Para enviar de um endereço próprio (ex.: `pedidos@goscooters.pt`) e para
qualquer destinatário, é preciso verificar um domínio: Resend → **Domains** →
**Add Domain** → adicionar os registos DNS indicados no teu fornecedor de
domínio. Só depois se pode mudar o `RESEND_FROM`.

---

## 3. Telegram

1. Abrir o Telegram e procurar **@BotFather**
2. Enviar `/newbot`
3. Escolher um nome (ex.: `GoScooters Pedidos`) e um username, que **tem de
   terminar em `bot`** (ex.: `goscooters_pedidos_bot`)
4. O BotFather devolve um token do género `123456789:AAG...`. Copiar.
5. **Enviar uma mensagem qualquer ao bot criado** (por exemplo `/start`).
   Este passo é obrigatório: um bot do Telegram não pode iniciar conversa com
   ninguém, a pessoa é que tem de falar primeiro.
6. Abrir no browser, substituindo `<TOKEN>` pelo token:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
7. Procurar na resposta `"chat":{"id":123456789` — esse número é o chat id
8. Acrescentar ao `.env.local`:

```
TELEGRAM_BOT_TOKEN=123456789:AAG...
TELEGRAM_CHAT_ID=123456789
```

> Se o `getUpdates` devolver `{"ok":true,"result":[]}`, é porque o passo 5 não
> foi feito — o bot ainda não recebeu nenhuma mensagem.

---

## 4. Reiniciar e testar

Alterações ao `.env.local` **não são lidas a quente**. É preciso reiniciar:

```bash
# parar o servidor (Ctrl+C) e depois
npm run dev
```

Teste ponta a ponta:

1. Abrir <http://localhost:3000>
2. Escolher uma mota → **Pedir aluguer**
3. Preencher, marcar o consentimento, submeter
4. Confirmar que chega o aviso no Telegram e no email
5. Entrar em <http://localhost:3000/admin/pedidos> e ver o pedido na lista

Se algum aviso não chegar, o terminal onde corre o `npm run dev` mostra a razão
exacta, com uma linha começada por `[notificacao]`. Uma falha aqui **não perde o
pedido** — o lead fica sempre gravado.

---

## 5. Verificar a segurança (opcional, mas recomendado)

Com o servidor a correr, num terminal separado:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" \
  http://localhost:3000/admin/pedidos
```

Deve responder `307 -> http://localhost:3000/admin/login`. Se alguma vez
responder `200`, a área de administração está exposta e é preciso corrigir
antes de qualquer publicação.

---

## Variáveis de ambiente

A lista completa e comentada está em `.env.example`. O `.env.local` **nunca é
commitado** — ao publicar (ex.: Vercel), as mesmas variáveis têm de ser
configuradas no painel da plataforma.

`SUPABASE_SERVICE_ROLE_KEY` nunca pode ser prefixada com `NEXT_PUBLIC_`: essa
chave ignora as regras de segurança da base de dados e, exposta ao browser,
daria acesso total aos dados.
