import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, negociarLocale } from "@/lib/i18n";

/** Caminhos que não pertencem ao site traduzido e não levam prefixo de idioma. */
const SEM_IDIOMA = ["/admin", "/portal", "/entrega", "/recibo", "/auth", "/api"];

/**
 * Ficheiros que os motores de busca e os browsers procuram em caminhos fixos.
 * Prefixá-los com o idioma tornaria-os inalcançáveis: um crawler que peça
 * /robots.txt não segue redirecionamentos para /pt/robots.txt.
 */
const FICHEIROS_RAIZ = [
  "/robots.txt",
  "/sitemap.xml",
  "/icon.svg",
  "/apple-icon.png",
  "/favicon.ico",
  "/manifest.webmanifest",
];

/**
 * Proxy (o antigo `middleware` — renomeado no Next 16).
 *
 * Faz duas coisas:
 *  1. Renova a sessão do Supabase, escrevendo os cookies actualizados na resposta.
 *     Sem isto a sessão expira e o utilizador é atirado para o login sem razão.
 *  2. Uma verificação *otimista* que trava pedidos não autenticados a /admin.
 *
 * Isto NÃO é a única linha de defesa — como a documentação do Next avisa, a
 * autorização a sério vive junto dos dados, em src/lib/dal.ts, e é lá que cada
 * página e cada Server Action verificam de facto quem está a chamar.
 */
export async function proxy(request: NextRequest) {
  const { pathname: caminho } = request.nextUrl;

  // Redirecciona para o idioma certo antes de qualquer trabalho de autenticação:
  // as páginas públicas não precisam de sessão e assim poupa-se a chamada.
  const fixo =
    SEM_IDIOMA.some((p) => caminho === p || caminho.startsWith(`${p}/`)) ||
    FICHEIROS_RAIZ.includes(caminho) ||
    // Qualquer imagem de metadados gerada pelo Next (opengraph-image, etc.).
    caminho.includes("opengraph-image") ||
    caminho.includes("twitter-image");

  if (!fixo) {
    const temIdioma = LOCALES.some(
      (l) => caminho === `/${l}` || caminho.startsWith(`/${l}/`),
    );

    if (!temIdioma) {
      const locale = negociarLocale(request.headers.get("accept-language"));
      const destino = new URL(
        `/${locale}${caminho === "/" ? "" : caminho}`,
        request.url,
      );
      destino.search = request.nextUrl.search;
      return NextResponse.redirect(destino);
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() valida o token junto do servidor de auth e, de caminho, renova a sessão.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allowlist de admin (mesma fonte do dal). Serve só para o reencaminhar otimista
  // abaixo — a autorização a sério continua a viver no dal, junto dos dados.
  const emailsAdmin = (process.env.ADMIN_EMAIL ?? "")
    .toLowerCase()
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const ehAdmin = !!user?.email && emailsAdmin.includes(user.email.toLowerCase());

  const isAdminArea = caminho.startsWith("/admin");
  const isLoginPage = caminho === "/admin/login";

  if (isAdminArea && !isLoginPage && !user) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Só reencaminha para /admin quem JÁ é admin. Reenviar QUALQUER sessão faria um
  // utilizador autenticado mas SEM permissão (conta comum / parceiro) entrar em
  // ciclo: o dal recusa /admin e devolve ao login, e o login reenviava outra vez
  // para /admin → ERR_TOO_MANY_REDIRECTS. Um não-admin fica no login e pode trocar
  // de conta. (Mesmo cuidado que já existe no bloco do portal, aqui em falta.)
  if (isLoginPage && ehAdmin) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  // Portal do parceiro: trava otimista (a autorização a sério é o requirePartner
  // no layout). NÃO redirecionamos para fora do /portal/entrar quando há sessão,
  // porque um admin autenticado (que não é parceiro) entraria em ciclo.
  const isPortalArea = caminho.startsWith("/portal");
  const isPortalLogin = caminho === "/portal/entrar";
  if (isPortalArea && !isPortalLogin && !user) {
    return NextResponse.redirect(new URL("/portal/entrar", request.url));
  }

  return response;
}

export const config = {
  // Corre em tudo excepto ficheiros estáticos e imagens — se apanhasse esses,
  // a lógica de auth podia bloquear CSS e JS.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
