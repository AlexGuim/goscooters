"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleLogout = async () => {
    setIsPending(true);
    await supabaseBrowser.auth.signOut();
    // refresh() para o servidor reavaliar a sessão já sem os cookies.
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <button
      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
      onClick={handleLogout}
      disabled={isPending}
    >
      {isPending ? "A sair..." : "Sair"}
    </button>
  );
}
