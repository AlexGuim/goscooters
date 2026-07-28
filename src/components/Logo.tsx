import { cx } from "@/components/ui/estilos";

/**
 * Logótipo GoScooters: marca "GS" (asfalto com speed-cut, G lima / S papel) +
 * wordmark em Archivo com o "Go" a lima. Dá identidade — deixa de ser white-label.
 * `onDark` adapta as cores a fundos escuros (header público/portal).
 * `wordmark={false}` mostra só a marca.
 */
export function Logo({
  wordmark = true,
  tamanho = "md",
  onDark = false,
  className,
}: {
  wordmark?: boolean;
  tamanho?: "sm" | "md";
  onDark?: boolean;
  className?: string;
}) {
  const marca = tamanho === "sm" ? "h-8 w-8 text-sm rounded-lg" : "h-9 w-9 text-base rounded-xl";
  const palavra = tamanho === "sm" ? "text-lg" : "text-xl";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cx(
          "speed-cut grid place-items-center bg-slate-950 font-display font-extrabold leading-none",
          marca,
          onDark && "ring-1 ring-white/15",
        )}
      >
        <span>
          <span className="text-emerald-500">G</span>
          <span className="text-slate-50">S</span>
        </span>
      </span>
      {wordmark && (
        <span className={cx("font-display font-extrabold tracking-tight", palavra, onDark ? "text-white" : "text-slate-950")}>
          <span className={onDark ? "text-emerald-500" : "text-emerald-700"}>Go</span>Scooters
        </span>
      )}
    </span>
  );
}
