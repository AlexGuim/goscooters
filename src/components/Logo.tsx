import { cx } from "@/components/ui/estilos";

const TAM = {
  sm: { marca: "h-8 w-8 text-sm rounded-lg", palavra: "text-lg" },
  md: { marca: "h-9 w-9 text-base rounded-xl", palavra: "text-xl" },
  lg: { marca: "h-14 w-14 text-2xl rounded-2xl", palavra: "text-3xl" },
} as const;

/**
 * Logótipo GoScooters: marca "GS" (speed-cut, G lima / S papel) + wordmark em
 * Archivo com o "Go" a lima. Dá identidade — deixa de ser white-label.
 * - `onDark`: adapta o wordmark a fundos escuros (header público/portal).
 * - `chip`: inverte a marca (quadrado lima com conteúdo asfalto) para acento
 *   forte sobre fundo escuro (ex.: hero da dashboard).
 * - `wordmark={false}`: só a marca.
 */
export function Logo({
  wordmark = true,
  tamanho = "md",
  onDark = false,
  chip = false,
  className,
}: {
  wordmark?: boolean;
  tamanho?: "sm" | "md" | "lg";
  onDark?: boolean;
  chip?: boolean;
  className?: string;
}) {
  const t = TAM[tamanho];
  const markBg = chip ? "bg-emerald-500" : "bg-slate-950";
  const gCor = chip ? "text-slate-950" : "text-emerald-500";
  const sCor = chip ? "text-slate-950/75" : "text-slate-50";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cx(
          "speed-cut grid place-items-center font-display font-extrabold leading-none",
          t.marca,
          markBg,
          onDark && !chip && "ring-1 ring-white/15",
        )}
      >
        <span>
          <span className={gCor}>G</span>
          <span className={sCor}>S</span>
        </span>
      </span>
      {wordmark && (
        <span
          className={cx(
            "font-display font-extrabold tracking-tight",
            t.palavra,
            onDark ? "text-white" : "text-slate-950",
          )}
        >
          <span className={onDark ? "text-emerald-500" : "text-emerald-700"}>Go</span>Scooters
        </span>
      )}
    </span>
  );
}
