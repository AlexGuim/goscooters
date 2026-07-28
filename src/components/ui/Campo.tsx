import type { ReactNode } from "react";
import { etiqueta, cx } from "./estilos";

/**
 * Envolvente de campo: rótulo + input (passado como children com a classe
 * `campo`). Um só espaçamento/tamanho de label para toda a app.
 */
export function Campo({
  label,
  required,
  className,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx(etiqueta, className)}>
      <span>
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
    </label>
  );
}
