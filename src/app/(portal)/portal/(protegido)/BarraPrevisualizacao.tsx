"use client";

import { useState } from "react";
import { sairDaPrevisualizacao } from "@/actions/proprietarioActions";

/**
 * Aviso de que isto NÃO é o portal de quem está a ver.
 *
 * Deliberadamente berrante e sempre no topo: um admin que se esqueça de que
 * está em pré-visualização pode ler os números do parceiro errado e agir sobre
 * eles. O aviso custa um centímetro de ecrã; a confusão custa mais.
 */
export default function BarraPrevisualizacao({ nome }: { nome: string }) {
  const [aSair, setASair] = useState(false);

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-400 px-4 py-2 sm:px-6">
        <p className="text-sm font-semibold text-amber-950">
          👁️ Pré-visualização de administrador — estás a ver o portal de{" "}
          <strong>{nome}</strong>. Só leitura.
        </p>
        <button
          onClick={async () => {
            setASair(true);
            await sairDaPrevisualizacao();
            window.location.assign("/admin/proprietarios");
          }}
          disabled={aSair}
          className="rounded-xl bg-amber-950 px-4 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-900 disabled:opacity-50"
        >
          {aSair ? "A sair…" : "Sair da pré-visualização"}
        </button>
      </div>
    </div>
  );
}
