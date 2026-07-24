"use client";

import { useActionState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseClient";

type State = { error?: string; success?: string };

async function handleEntrar(
  _prev: State | undefined,
  formData: FormData,
): Promise<State> {
  const email = (formData.get("email") as string)?.trim();
  if (!email) return { error: "Indica o teu email." };

  // Magic link: só para quem já foi convidado (shouldCreateUser: false).
  const { error } = await supabaseBrowser.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal`,
    },
  });

  if (error) {
    // Não revelar se o email existe — mensagem neutra.
    if (/not allowed|signups|not found|disabled/i.test(error.message)) {
      return {
        error:
          "Se este email tiver acesso, vais receber o link. Se não, pede à GoScooters para te convidar.",
      };
    }
    return { error: error.message };
  }

  return { success: `Enviámos um link de acesso para ${email}. Verifica o teu email.` };
}

export default function EntrarPortalPage() {
  const [state, formAction, isPending] = useActionState(handleEntrar, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-slate-950">Portal do parceiro</h1>
          <p className="mt-2 text-slate-600">
            Entra com o teu email — enviamos-te um link de acesso.
          </p>
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

          {state?.error && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800">{state.error}</p>
            </div>
          )}
          {state?.success && (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-700">{state.success}</p>
            </div>
          )}

          <button
            className="w-full rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            type="submit"
            disabled={isPending}
          >
            {isPending ? "A enviar..." : "Enviar link de acesso"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          <Link className="font-medium text-emerald-600 hover:text-emerald-700" href="/">
            Voltar ao site
          </Link>
        </div>
      </div>
    </main>
  );
}
