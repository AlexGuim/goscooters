import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const { pathname } = request.nextUrl;
  const isAdminArea = pathname.startsWith("/admin");
  const isLoginPage = pathname === "/admin/login";

  if (isAdminArea && !isLoginPage && !user) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Já autenticado não tem nada que fazer no ecrã de login.
  if (isLoginPage && user) {
    return NextResponse.redirect(new URL("/admin/motas", request.url));
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
