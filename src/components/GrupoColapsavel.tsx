"use client";

import { useState, type ReactNode } from "react";

/**
 * Secção agrupável e colapsável, reutilizável em qualquer lista agrupada
 * (contratos, cobranças, despesas…). Cabeçalho com título + resumo à direita e
 * um toggle (chevron) que mostra/esconde o conteúdo.
 */
export default function GrupoColapsavel({
  titulo,
  resumo,
  defaultAberto = true,
  children,
}: {
  titulo: ReactNode;
  resumo?: ReactNode;
  defaultAberto?: boolean;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(defaultAberto);
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={`flex w-full items-center justify-between gap-3 bg-slate-50 px-5 py-3 text-left transition hover:bg-slate-100 ${
          aberto ? "border-b border-slate-100" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block text-slate-400 transition-transform ${aberto ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
          <span className="truncate text-sm font-semibold text-slate-700">{titulo}</span>
        </span>
        {resumo != null && (
          <span className="shrink-0 text-xs font-medium text-slate-500">{resumo}</span>
        )}
      </button>
      {aberto && <div>{children}</div>}
    </div>
  );
}
