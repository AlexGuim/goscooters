import Link from "next/link";
import { hrefJornada } from "@/lib/jornada";
import { Bloco, BlocoFalhou, Barra, CartaoVazio } from "./Bloco";
import { lerNumeros } from "./dados";

/** Os cinco cartões: no telemóvel dois por linha, no computador os cinco de seguida. */
const GRELHA = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5";

/**
 * Altura de um cartão: p-5 (40) + rótulo text-sm (20) + mt-1 (4) + número
 * text-3xl (36). É esta a altura do esqueleto, para a página não saltar.
 *
 * No cartão a sério é um MÍNIMO: com dois por linha num telemóvel estreito (ou
 * enquanto a letra de recurso, mais larga, está à frente), «Contratos ativos»
 * passa a duas linhas e o número saía para fora do cartão branco. Mais vale um
 * cartão 20 px mais alto do que um número derramado por cima do fundo.
 */
const ALTURA_CARTAO = "h-[100px]";
const ALTURA_MINIMA_CARTAO = "min-h-[100px]";

export default async function BlocoNumeros() {
  let n;
  try {
    n = await lerNumeros();
  } catch (erro) {
    console.error("Início · Números:", erro);
    return (
      <Bloco titulo="Números">
        <BlocoFalhou />
      </Bloco>
    );
  }

  const cartoes = [
    { rotulo: "Por resolver", n: n.por_resolver, href: "/admin/notificacoes", cor: "text-emerald-600" },
    // Aponta para a lista onde pré-contratos E rascunhos aparecem — e conta os dois.
    { rotulo: "Por preencher", n: n.por_preencher, href: hrefJornada.preenchimento, cor: "text-indigo-600" },
    { rotulo: "Em atraso", n: n.em_atraso, href: "/admin/cobrancas", cor: "text-red-600" },
    { rotulo: "Por recolher", n: n.por_recolher, href: "/admin/contratos", cor: "text-amber-600" },
    { rotulo: "Contratos ativos", n: n.ativos, href: "/admin/contratos", cor: "text-slate-950" },
  ];

  return (
    <Bloco titulo="Números">
      <div className={GRELHA}>
        {cartoes.map((c) => (
          <Link
            key={c.rotulo}
            href={c.href}
            className={`rounded-3xl bg-white p-5 shadow-sm transition hover:shadow-md ${ALTURA_MINIMA_CARTAO}`}
          >
            <p className="text-sm text-slate-500">{c.rotulo}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${c.cor}`}>{c.n}</p>
          </Link>
        ))}
      </div>
    </Bloco>
  );
}

export function EsqueletoNumeros() {
  return (
    <Bloco titulo="Números">
      <div className={GRELHA}>
        {[0, 1, 2, 3, 4].map((i) => (
          <CartaoVazio key={i} altura={ALTURA_CARTAO}>
            <Barra className="h-5 w-24" />
            <Barra className="mt-1 h-9 w-12" />
          </CartaoVazio>
        ))}
      </div>
    </Bloco>
  );
}
