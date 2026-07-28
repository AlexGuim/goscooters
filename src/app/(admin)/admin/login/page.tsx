"use client";

import { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { Logo } from "@/components/Logo";
import ErroDoCallback from "./ErroDoCallback";

type State = {
  error?: string;
  success?: string;
};

async function handleLogin(
  _prevState: State | undefined,
  formData: FormData,
): Promise<State> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email e password são obrigatórios." };
  }

  const { error } = await supabaseBrowser.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("Auth error:", error);
    return {
      error:
        error.message === "Invalid login credentials"
          ? "Email ou password incorretos."
          : error.message,
    };
  }

  window.location.href = "/admin";
  return {};
}

async function handlePasswordRecovery(
  _prevState: State | undefined,
  formData: FormData,
): Promise<State> {
  const email = (formData.get("recoveryEmail") as string)?.trim();

  if (!email) {
    return { error: "Email é obrigatório para recuperar senha." };
  }

  // O link tem de passar pelo /auth/callback: é lá que o código PKCE é trocado
  // por sessão, sem o que a página de redefinição não teria autorização.
  const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?next=/admin/redefinir-password`,
  });

  if (error) {
    console.error("Recovery error:", error);
    return { error: error.message };
  }

  return {
    success: `Email de recuperação enviado para ${email}. Verifique sua caixa de entrada.`,
  };
}

export default function AdminLoginPage() {
  const [state, formAction, isPending] = useActionState(handleLogin, undefined);
  const [recoveryState, recoveryAction, isRecoveryPending] = useActionState(
    handlePasswordRecovery,
    undefined,
  );
  const [mostrarRecuperar, setMostrarRecuperar] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-sm">
        <div className="space-y-8">
          <div className="text-center">
            <div className="flex justify-center">
              <Logo />
            </div>
            <p className="mt-3 text-sm text-slate-500">Administração · acesso restrito</p>
          </div>

          <Suspense fallback={null}>
            <ErroDoCallback />
          </Suspense>

          <form action={formAction} className="space-y-6">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                type="email"
                name="email"
                required
                placeholder="admin@example.com"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500"
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
              className="w-full rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-600 disabled:opacity-50"
              type="submit"
              disabled={isPending}
            >
              {isPending ? "A entrar..." : "Entrar"}
            </button>
          </form>

          <div className="border-t border-slate-100 pt-6">
            {!mostrarRecuperar ? (
              <button
                type="button"
                onClick={() => setMostrarRecuperar(true)}
                className="text-sm font-medium text-emerald-700 transition hover:text-emerald-600"
              >
                Esqueci a senha
              </button>
            ) : (
              <form action={recoveryAction} className="space-y-3">
                <p className="text-sm text-slate-600">
                  Recebe um link de redefinição no teu email.
                </p>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                  type="email"
                  name="recoveryEmail"
                  required
                  placeholder="seu@email.com"
                  autoFocus
                />
                {recoveryState?.error && (
                  <p className="text-sm text-red-700">{recoveryState.error}</p>
                )}
                {recoveryState?.success && (
                  <p className="text-sm text-emerald-700">{recoveryState.success}</p>
                )}
                <button
                  className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-slate-50 transition hover:bg-slate-900 disabled:opacity-50"
                  type="submit"
                  disabled={isRecoveryPending}
                >
                  {isRecoveryPending ? "Enviando..." : "Enviar link"}
                </button>
              </form>
            )}
          </div>

          <div className="text-center text-sm text-slate-500">
            <Link className="font-medium text-emerald-600 hover:text-emerald-700" href="/">
              Voltar ao site
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
