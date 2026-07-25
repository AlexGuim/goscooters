import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServerClient";

/**
 * Recebe os links de autenticação enviados por email (recuperação de password,
 * convites, confirmações).
 *
 * O @supabase/ssr usa o fluxo PKCE, por isso o link traz um `code` que só se
 * torna sessão depois de trocado aqui — e essa troca tem de acontecer no
 * servidor, para os cookies da sessão ficarem escritos na resposta.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  // Em caso de erro, volta ao login CERTO (portal ou admin) conforme o destino.
  const login = next.startsWith("/portal") ? "/portal/entrar" : "/admin/login";

  // O Supabase devolve o erro no próprio link quando este expirou ou já foi usado.
  const erroSupabase = searchParams.get("error_description") ?? searchParams.get("error");

  if (erroSupabase) {
    return NextResponse.redirect(
      `${origin}${login}?erro=${encodeURIComponent(erroSupabase)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}${login}?erro=${encodeURIComponent("Link inválido ou incompleto.")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Falha ao trocar o código por sessão:", error);
    return NextResponse.redirect(
      `${origin}${login}?erro=${encodeURIComponent(
        "O link expirou ou já foi utilizado. Pede um novo.",
      )}`,
    );
  }

  // `next` vem do nosso próprio link, mas só se aceitam caminhos internos —
  // caso contrário isto seria um redirect aberto para qualquer site.
  const destino = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  return NextResponse.redirect(`${origin}${destino}`);
}
