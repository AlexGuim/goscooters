import type { ReactNode } from "react";
import Link from "next/link";

/**
 * A moldura de um bloco do Início: o título e, à direita, o atalho para o ecrã
 * completo. Igual em todos os blocos para a pilha ler-se de uma vez, e para o
 * esqueleto (que usa a mesma moldura) ter exactamente a mesma altura de cabeça.
 */
export function Bloco({
  titulo,
  href,
  abrir = "Abrir",
  children,
}: {
  titulo: string;
  href?: string;
  abrir?: string;
  children: ReactNode;
}) {
  return (
    <section className="h-full">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{titulo}</h2>
        {href && (
          <Link href={href} className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800">
            {abrir}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * O que se vê quando as consultas de um bloco falham.
 *
 * As consultas do Início lançam erro quando a base não responde — nunca trocam
 * a falha por um zero, que se lê como «não há nada» e é mentira. O bloco apanha
 * o erro aqui: os outros blocos continuam a mostrar o que conseguiram ler.
 */
export function BlocoFalhou() {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
      Não foi possível carregar. Recarrega a página.
    </div>
  );
}

/** Uma barra cinzenta a pulsar, do tamanho pedido. */
export function Barra({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded bg-slate-200 ${className}`} />;
}

/**
 * Um cartão vazio do tamanho de um cartão cheio, enquanto o bloco carrega.
 * As alturas dos esqueletos são as dos blocos já carregados (ver o comentário de
 * cada um), para a página não dar um salto quando os dados chegam.
 */
export function CartaoVazio({ altura, children }: { altura: string; children?: ReactNode }) {
  return <div className={`rounded-3xl bg-white p-5 shadow-sm ${altura}`}>{children}</div>;
}
