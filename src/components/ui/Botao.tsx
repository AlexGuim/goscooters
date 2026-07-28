import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./estilos";

/**
 * Botão com variantes semânticas (a cor é propriedade da VARIANTE, não escolhida
 * à mão em cada uso). Direção "Asfalto & Volt": primária ink-first (asfalto),
 * lima só como acento/volt (com texto ink — nunca branco sobre lima).
 */
export type BotaoVariante = "primary" | "secondary" | "ghost" | "danger" | "volt";
export type BotaoTamanho = "sm" | "md" | "lg";

const VARIANTE: Record<BotaoVariante, string> = {
  primary: "bg-slate-950 text-slate-50 hover:bg-slate-900",
  secondary: "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  ghost: "text-slate-600 hover:text-slate-900",
  danger: "text-red-600 hover:text-red-700",
  volt: "bg-emerald-500 text-slate-950 hover:bg-emerald-600",
};

const TAMANHO: Record<BotaoTamanho, string> = {
  sm: "px-4 py-2 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export function classesBotao(variante: BotaoVariante = "primary", tamanho: BotaoTamanho = "md", cut = false) {
  return cx(BASE, VARIANTE[variante], TAMANHO[tamanho], cut && "speed-cut");
}

export function Botao({
  variante = "primary",
  tamanho = "md",
  cut = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: BotaoVariante;
  tamanho?: BotaoTamanho;
  cut?: boolean;
  children?: ReactNode;
}) {
  return (
    <button className={cx(classesBotao(variante, tamanho, cut), className)} {...props}>
      {children}
    </button>
  );
}
