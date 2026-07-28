"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { Logo } from "@/components/Logo";
import { Botao, campo } from "@/components/ui";

type State = { error?: string; success?: string };

async function handlePassword(_prev: State | undefined, formData: FormData): Promise<State> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;
  if (!email || !password) return { error: "Email e palavra-passe são obrigatórios." };

  const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message === "Invalid login credentials") {
      return { error: "Email ou palavra-passe incorretos." };
    }
    // Não expor detalhe do backend ao cliente.
    console.error("portal login error:", error.message);
    return { error: "Não foi possível entrar. Tenta novamente." };
  }
  window.location.href = "/portal";
  return {};
}

async function handleMagicLink(_prev: State | undefined, formData: FormData): Promise<State> {
  const email = (formData.get("emailLink") as string)?.trim();
  if (!email) return { error: "Indica o teu email." };

  const { error } = await supabaseBrowser.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal`,
    },
  });
  // O rate limit é benigno de revelar; tudo o resto usa a MESMA mensagem neutra
  // no sucesso e no erro — não revela se o email é (ou não) um parceiro.
  if (error && /rate limit/i.test(error.message)) {
    return { error: "Demasiados emails num curto espaço. Tenta mais tarde ou usa a palavra-passe." };
  }
  return {
    success: "Se este email tiver acesso, enviámos um link. Verifica a tua caixa de correio.",
  };
}

export default function EntrarPortalPage() {
  const [state, formAction, isPending] = useActionState(handlePassword, undefined);
  const [linkState, linkAction, isLinkPending] = useActionState(handleMagicLink, undefined);
  const [mostrarLink, setMostrarLink] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="flex justify-center">
            <Logo />
          </div>
          <p className="mt-3 text-sm text-slate-500">Portal do parceiro · acesso restrito</p>
        </div>

        <form action={formAction} className="mt-8 space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input className={campo} type="email" name="email" required placeholder="teu@email.com" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Palavra-passe</span>
            <input className={campo} type="password" name="password" required placeholder="••••••••" />
          </label>

          {state?.error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          <Botao variante="volt" className="w-full" type="submit" disabled={isPending}>
            {isPending ? "A entrar..." : "Entrar"}
          </Botao>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-6">
          {!mostrarLink ? (
            <button
              onClick={() => setMostrarLink(true)}
              className="text-sm font-medium text-emerald-700 hover:text-emerald-600"
            >
              Não tens palavra-passe? Entra por link no email
            </button>
          ) : (
            <form action={linkAction} className="space-y-3">
              <p className="text-sm text-slate-600">
                Enviamos-te um link de acesso. Depois de entrares, define uma palavra-passe.
              </p>
              <input className={campo} type="email" name="emailLink" required placeholder="teu@email.com" />
              {linkState?.error && <p className="text-sm text-amber-800">{linkState.error}</p>}
              {linkState?.success && <p className="text-sm text-emerald-700">{linkState.success}</p>}
              <Botao variante="primary" className="w-full" type="submit" disabled={isLinkPending}>
                {isLinkPending ? "A enviar..." : "Enviar link de acesso"}
              </Botao>
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-slate-500">
          <Link className="font-medium text-emerald-700 hover:text-emerald-600" href="/">
            Voltar ao site
          </Link>
        </div>
      </div>
    </main>
  );
}
