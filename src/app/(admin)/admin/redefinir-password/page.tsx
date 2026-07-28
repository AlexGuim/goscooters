"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { Botao, classesBotao, campo } from "@/components/ui";

const MINIMO = 8;

export default function RedefinirPasswordPage() {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [aGravar, setAGravar] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);

    const dados = new FormData(e.currentTarget);
    const password = String(dados.get("password") ?? "");
    const confirmacao = String(dados.get("confirmacao") ?? "");

    if (password.length < MINIMO) {
      setErro(`A password tem de ter pelo menos ${MINIMO} caracteres.`);
      return;
    }

    if (password !== confirmacao) {
      setErro("As passwords não coincidem.");
      return;
    }

    setAGravar(true);
    const { error } = await supabaseBrowser.auth.updateUser({ password });
    setAGravar(false);

    if (error) {
      // Acontece quando a sessão de recuperação já expirou.
      setErro(
        error.message === "Auth session missing!"
          ? "A sessão de recuperação expirou. Pede um novo link na página de entrada."
          : error.message,
      );
      return;
    }

    setSucesso(true);
    // refresh() para o servidor reavaliar a sessão com a password nova.
    router.refresh();
  };

  if (sucesso) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <span className="text-2xl">✓</span>
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-slate-950">
            Password alterada
          </h1>
          <p className="mt-3 text-slate-600">
            Já podes entrar na administração com a nova password.
          </p>
          <Link className={`mt-6 w-full ${classesBotao("volt", "lg")}`} href="/admin/motas">
            Ir para a administração
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-slate-950">Nova password</h1>
          <p className="mt-2 text-slate-600">
            Escolhe uma password nova para a tua conta.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Nova password</span>
            <input
              className={campo}
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={MINIMO}
              required
              placeholder="••••••••"
            />
            <span className="block text-xs text-slate-500">
              Pelo menos {MINIMO} caracteres.
            </span>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              Confirmar password
            </span>
            <input
              className={campo}
              type="password"
              name="confirmacao"
              autoComplete="new-password"
              required
              placeholder="••••••••"
            />
          </label>

          {erro && (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <Botao variante="volt" tamanho="lg" className="w-full" type="submit" disabled={aGravar}>
            {aGravar ? "A guardar..." : "Guardar nova password"}
          </Botao>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link className="font-medium text-emerald-700 hover:text-emerald-600" href="/admin/login">
            Voltar à entrada
          </Link>
        </div>
      </div>
    </main>
  );
}
