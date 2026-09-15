"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apagarManutencao } from "@/actions/frotaSaudeActions";

/**
 * Apagar uma manutenção da lista — o mesmo «×» que existia no modal antes de a
 * manutenção passar para aqui. É o caminho de volta quando um «Óleo trocado» sai
 * com a data ou o km errados.
 */
export default function ApagarManutencao({ id }: { id: string }) {
  const router = useRouter();
  const [aApagar, setAApagar] = useState(false);

  const apagar = async () => {
    if (!window.confirm("Apagar esta manutenção?")) return;
    setAApagar(true);
    const r = await apagarManutencao(id);
    setAApagar(false);
    if (!r.success) {
      window.alert(r.error ?? "Erro ao apagar.");
      return;
    }
    router.refresh();
  };

  return (
    <button
      onClick={apagar}
      disabled={aApagar}
      className="px-2 text-slate-400 transition hover:text-red-600 disabled:opacity-40"
      aria-label="Apagar manutenção"
    >
      ×
    </button>
  );
}
