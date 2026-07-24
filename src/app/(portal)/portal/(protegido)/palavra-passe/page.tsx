"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function DefinirPasswordPage() {
  const [pw, setPw] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [aGravar, setAGravar] = useState(false);

  const gravar = async () => {
    setErro(null);
    if (pw.length < 6) {
      setErro("A palavra-passe tem de ter pelo menos 6 caracteres.");
      return;
    }
    setAGravar(true);
    const { error } = await supabaseBrowser.auth.updateUser({ password: pw });
    setAGravar(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setOk(true);
    setPw("");
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <Link href="/portal" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
          ← Início
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">Palavra-passe</h1>
        <p className="mt-1 text-slate-600">
          Define uma palavra-passe para entrares sem precisares do email de cada vez.
        </p>
      </div>

      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">Nova palavra-passe</span>
          <input
            className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="mín. 6 caracteres"
          />
        </label>

        {erro && <p className="text-sm text-red-700">{erro}</p>}
        {ok && <p className="text-sm text-emerald-700">Palavra-passe atualizada. ✓</p>}

        <button
          onClick={gravar}
          disabled={aGravar}
          className="w-full rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {aGravar ? "A guardar..." : "Guardar palavra-passe"}
        </button>
      </div>
    </div>
  );
}
