"use client";

import { classesBotao } from "@/components/ui";
import { cx } from "@/components/ui/estilos";

/** Botão "Guardar/Imprimir PDF" — o browser trata da geração do PDF. */
export default function ImprimirComprovativo({ rotulo }: { rotulo: string }) {
  return (
    <button onClick={() => window.print()} className={cx(classesBotao("volt", "lg"), "print:hidden")}>
      {rotulo}
    </button>
  );
}
