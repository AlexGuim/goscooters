import type { ReactNode } from "react";
import { cx } from "./estilos";

/** Superfície de página: raio grande, fundo branco, sombra suave. */
export function Cartao({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-3xl bg-white p-6 shadow-sm", className)}>{children}</div>;
}

/** Painel encaixado dentro de um cartão: raio menor, borda, fundo neutro. */
export function Painel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-slate-200 bg-slate-50 p-4", className)}>{children}</div>;
}
