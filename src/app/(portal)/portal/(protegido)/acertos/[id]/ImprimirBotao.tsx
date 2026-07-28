"use client";

import { classesBotao } from "@/components/ui";
import { cx } from "@/components/ui/estilos";

export default function ImprimirBotao() {
  return (
    <button
      onClick={() => window.print()}
      className={cx(classesBotao("secondary", "sm"), "print:hidden")}
    >
      Imprimir / Guardar PDF
    </button>
  );
}
