# Publicar na Vercel

Passo a passo para pôr a GoScooters online. Cada bloco é uma ação tua; onde for
preciso um valor do projeto, está indicado onde o encontrar.

---

## 1. Enviar o código para o GitHub

Precisas de uma conta em [github.com](https://github.com) (gratuita).

1. Cria um repositório novo, **privado**: github.com → **New repository**
   - Nome: `goscooters` (ou outro à escolha)
   - **Não** marques "Add a README" — o projeto já tem ficheiros
   - Cria e **copia o endereço** que aparece, do tipo
     `https://github.com/o-teu-utilizador/goscooters.git`

2. No terminal, dentro da pasta do projeto, corre (substituindo o endereço):

   ```bash
   git remote add origin https://github.com/o-teu-utilizador/goscooters.git
   git branch -M main
   git push -u origin main
   ```

   O GitHub vai pedir-te para autenticar. Se pedir password, usa antes um
   **Personal Access Token** (github.com → Settings → Developer settings →
   Personal access tokens) — o GitHub já não aceita a password da conta aqui.

**Confirmar:** atualiza a página do repositório no GitHub e vê os ficheiros lá.
O `.env.local` **não** deve aparecer — se aparecer, para e avisa.

---

## 2. Ligar a Vercel ao repositório

Cria conta em [vercel.com](https://vercel.com) — usa "Continue with GitHub", é o
mais simples.

1. **Add New… → Project**
2. Escolhe o repositório `goscooters` e carrega em **Import**
3. A Vercel deteta o Next.js sozinho. **Não carregues em Deploy ainda** — falta
   configurar as variáveis (passo 3).

---

## 3. Variáveis de ambiente na Vercel

No ecrã de importação, abre **Environment Variables** e adiciona uma a uma.
Os valores são **os mesmos do teu `.env.local`** — abre esse ficheiro e copia.

| Nome | Onde vais buscar o valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | do `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | do `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | do `.env.local` |
| `WHATSAPP_NUMERO` | do `.env.local` |
| `ADMIN_EMAIL` | do `.env.local` |
| `RESEND_API_KEY` | do `.env.local` |
| `RESEND_FROM` | do `.env.local` |
| `NEXT_PUBLIC_SITE_URL` | **deixa para o passo 5** (ainda não sabes o endereço) |

> `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` só se ainda não os configuraste;
> sem eles, o canal Telegram é simplesmente saltado.

Depois carrega em **Deploy**. A primeira construção demora 1–2 minutos.

---

## 4. Primeira verificação

Quando terminar, a Vercel dá-te um endereço tipo `goscooters.vercel.app`.

- Abre-o: deve mostrar o catálogo
- Testa `/en` e a troca de idioma
- Faz um pedido de teste de ponta a ponta e confirma o email

---

## 5. Fechar o círculo do URL

Agora que sabes o endereço:

1. Vercel → o projeto → **Settings → Environment Variables**
2. Adiciona `NEXT_PUBLIC_SITE_URL` com o endereço **completo e sem barra final**,
   ex.: `https://goscooters.vercel.app`
3. **Redeploy**: Deployments → nos três pontos do último → **Redeploy**
   (isto é preciso para o sitemap, o canonical e a imagem de partilha usarem o
   endereço real em vez de localhost)

---

## 6. Recuperação de password em produção

O Supabase precisa de saber que o novo endereço é de confiança, senão os links
de recuperação de password não funcionam.

1. [supabase.com](https://supabase.com) → o projeto → **Authentication → URL Configuration**
2. **Site URL**: `https://goscooters.vercel.app`
3. **Redirect URLs** → Add URL: `https://goscooters.vercel.app/auth/callback`
4. Guarda

---

## Depois, quando quiseres

- **Domínio próprio**: Vercel → Settings → Domains → Add. A Vercel indica os
  registos DNS. Depois é só repetir os passos 5 e 6 com o novo endereço.
- **Emails de recuperação pelo Resend** (melhor entrega, menos spam): Supabase →
  Authentication → SMTP Settings, com as credenciais do Resend.
- **apple-icon.png**: guardar a imagem GS em `src/app/apple-icon.png`.
- **Foto do banner**: substituir `public/hero.jpg` por uma imagem panorâmica.

---

## Como funcionam os deploys a partir daqui

Cada `git push` para o `main` dispara um deploy automático na Vercel. O fluxo
passa a ser: alterar → `git commit` → `git push` → ao fim de ~1 min está online.
