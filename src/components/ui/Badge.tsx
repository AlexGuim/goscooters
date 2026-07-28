import type { ReactNode } from "react";
import { cx } from "./estilos";

/**
 * Badge/pill de estado com TOM semântico central — garante que "em atraso" é
 * sempre o mesmo vermelho em toda a app (substitui os mapas cor→classe repetidos
 * por ficheiro). Um só tamanho.
 */
export type BadgeTom = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TOM: Record<BadgeTom, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700",
  accent: "bg-emerald-100 text-emerald-700",
};

export function Badge({
  tom = "neutral",
  className,
  children,
}: {
  tom?: BadgeTom;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TOM[tom], className)}>
      {children}
    </span>
  );
}
