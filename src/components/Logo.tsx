import { cx } from "@/components/ui/estilos";

/**
 * Logótipo GoScooters: marca "GS" (asfalto com speed-cut, G lima / S papel) +
 * wordmark em Archivo com o "Go" a lima profundo. Dá identidade — deixa de ser
 * white-label. `wordmark={false}` mostra só a marca (espaços apertados).
 */
export function Logo({
  wordmark = true,
  tamanho = "md",
  className,
}: {
  wordmark?: boolean;
  tamanho?: "sm" | "md";
  className?: string;
}) {
  const marca = tamanho === "sm" ? "h-8 w-8 text-sm rounded-lg" : "h-9 w-9 text-base rounded-xl";
  const palavra = tamanho === "sm" ? "text-lg" : "text-xl";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cx("speed-cut grid place-items-center bg-slate-950 font-display font-extrabold leading-none", marca)}
      >
        <span>
          <span className="text-emerald-500">G</span>
          <span className="text-slate-50">S</span>
        </span>
      </span>
      {wordmark && (
        <span className={cx("font-display font-extrabold tracking-tight text-slate-950", palavra)}>
          <span className="text-emerald-700">Go</span>Scooters
        </span>
      )}
    </span>
  );
}
