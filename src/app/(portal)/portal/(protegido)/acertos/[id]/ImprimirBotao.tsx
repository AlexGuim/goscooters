"use client";

export default function ImprimirBotao() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 print:hidden"
    >
      Imprimir / Guardar PDF
    </button>
  );
}
