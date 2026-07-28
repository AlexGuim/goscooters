"use client";

import { supabaseBrowser } from "@/lib/supabaseClient";
import { classesBotao } from "@/components/ui";

export default function SairPortal() {
  const sair = async () => {
    await supabaseBrowser.auth.signOut();
    window.location.href = "/portal/entrar";
  };
  return (
    <button onClick={sair} className={classesBotao("secondary", "sm")}>
      Sair
    </button>
  );
}
