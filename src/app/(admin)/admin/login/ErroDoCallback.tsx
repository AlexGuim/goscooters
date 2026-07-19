"use client";

import { useSearchParams } from "next/navigation";

/**
 * Mostra o erro devolvido pelo /auth/callback (link expirado ou já usado).
 *
 * Vive num componente próprio porque useSearchParams() obriga a uma fronteira
 * Suspense; isolado assim, o resto da página de entrada continua estático.
 */
export default function ErroDoCallback() {
  const erro = useSearchParams().get("erro");

  if (!erro) return null;

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-800">{erro}</p>
    </div>
  );
}
