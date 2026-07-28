import type { ReactNode } from "react";
import { cx } from "./estilos";

/**
 * Casca de modal — extrai o overlay + click-outside + stopPropagation + botão de
 * fechar que estava copiado em 5+ ficheiros. Cabeçalho (título/subtítulo)
 * opcional; o botão de fechar está sempre presente.
 */
export function Modal({
  onClose,
  titulo,
  subtitulo,
  maxWidth = "max-w-2xl",
  children,
}: {
  onClose: () => void;
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  maxWidth?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className={cx("my-8 w-full rounded-3xl bg-white p-6 shadow-lg sm:p-8", maxWidth)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {titulo && <h2 className="text-2xl font-semibold text-slate-950">{titulo}</h2>}
            {subtitulo && <p className="text-sm text-slate-600">{subtitulo}</p>}
          </div>
          <button
            onClick={onClose}
            type="button"
            aria-label="Fechar"
            className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
