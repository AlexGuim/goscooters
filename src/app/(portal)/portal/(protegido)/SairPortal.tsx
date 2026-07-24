"use client";

import { supabaseBrowser } from "@/lib/supabaseClient";

export default function SairPortal() {
  const sair = async () => {
    await supabaseBrowser.auth.signOut();
    window.location.href = "/portal/entrar";
  };
  return (
    <button
      onClick={sair}
      className="rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
    >
      Sair
    </button>
  );
}
