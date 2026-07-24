"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseClient";

type State = { error?: string; success?: string };

async function handlePassword(_prev: State | undefined, formData: FormData): Promise<State> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;
  if (!email || !password) return { error: "Email e palavra-passe são obrigatórios." };

  const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "Email ou palavra-passe incorretos."
          : error.message,
    };
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
  if (error) {
    if (/rate limit/i.test(error.message)) {
      return { error: "Demasiados emails num curto espaço de tempo. Tenta daqui a pouco ou usa a palavra-passe." };
    }
    return { error: "Se este email tiver acesso, vais receber o link." };
  }
  return { success: `Enviámos um link de acesso para ${email}. Verifica o teu email.` };
}

export default function EntrarPortalPage() {
  const [state, formAction, isPending] = useActionState(handlePassword, undefined);
  const [linkState, linkAction, isLinkPending] = useActionState(handleMagicLink, undefined);
  const [mostrarLink, setMostrarLink] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-slate-950">Portal do parceiro</h1>
          <p className="mt-2 text-slate-600">Entra com o teu email e palavra-passe.</p>
        </div>

        <form action={formAction} className="mt-8 space-y-5">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
              type="email"
              name="email"
              required
              placeholder="teu@email.com"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Palavra-passe</span>
            <input
              className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
              type="password"
              name="password"
              required
              placeholder="••••••••"
            />
          </label>

          {state?.error && (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          <button
            className="w-full rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            type="submit"
            disabled={isPending}
          >
            {isPending ? "A entrar..." : "Entrar"}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-6">
          {!mostrarLink ? (
            <button
              onClick={() => setMostrarLink(true)}
              className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
            >
              Não tens palavra-passe? Entra por link no email
            </button>
          ) : (
            <form action={linkAction} className="space-y-3">
              <p className="text-sm text-slate-600">
                Enviamos-te um link de acesso. Depois de entrares, define uma palavra-passe.
              </p>
              <input
                className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                type="email"
                name="emailLink"
                required
                placeholder="teu@email.com"
              />
              {linkState?.error && <p className="text-sm text-amber-800">{linkState.error}</p>}
              {linkState?.success && <p className="text-sm text-emerald-700">{linkState.success}</p>}
              <button
                className="w-full rounded-3xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                type="submit"
                disabled={isLinkPending}
              >
                {isLinkPending ? "A enviar..." : "Enviar link de acesso"}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-sm text-slate-500">
          <Link className="font-medium text-emerald-600 hover:text-emerald-700" href="/">
            Voltar ao site
          </Link>
        </div>
      </div>
    </main>
  );
}
