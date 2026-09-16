import Link from "next/link";
import { formatarPreco } from "@/lib/precos";
import { Bloco, BlocoFalhou, Barra } from "./Bloco";
import { lerCobranca } from "./dados";

/**
 * Altura de uma linha: py-3 (24) + uma linha de texto text-sm (20) dá 44, e o
 * mínimo de 52 mantém-na folgada. É MÍNIMO e não fixo de propósito: no
 * telemóvel a linha da semana não cabe de uma vez, e cortá-la comia justamente
 * o «falta Z €» — a única parte que obriga a fazer alguma coisa. Agora a frase
 * passa para a linha de baixo e lê-se até ao fim.
 */
const ALTURA_LINHA = "min-h-[52px]";

const LINHA = `flex items-center px-5 py-3 text-sm transition hover:bg-slate-50 ${ALTURA_LINHA}`;
const CAIXA = "divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm";

/** O texto de uma linha, em pedaços que só quebram entre si — nunca a meio de um valor. */
const TEXTO = "flex flex-wrap items-baseline gap-x-1";

/**
 * O que estas duas linhas contam e o que deixam de fora.
 *
 * Fica escrito porque a página da Cobrança mostra a mesma semana com TUDO
 * (cauções e extras incluídos) e pelo valor cheio. Sem isto ficavam dois
 * números com o mesmo nome e valores diferentes, e ninguém sabia qual era o bom.
 */
const LEGENDA = "sem cauções · o valor da semana já vem sem os descontos dados";

/**
 * A cobrança em duas linhas: o que está em atraso e como vai a semana. Ambas
 * levam à Cobrança, que é onde se trata do assunto.
 */
export default async function BlocoCobranca() {
  let dados;
  try {
    dados = await lerCobranca();
  } catch (erro) {
    console.error("Início · Cobrança:", erro);
    return (
      <Bloco titulo="Cobrança">
        <BlocoFalhou />
      </Bloco>
    );
  }

  const { atraso, semana } = dados;

  return (
    <Bloco titulo="Cobrança" href="/admin/cobrancas">
      <div className={CAIXA}>
        <Link href="/admin/cobrancas" className={LINHA}>
          <span className={TEXTO}>
            <span className="font-semibold text-slate-950">Em atraso:</span>
            <span className={`font-semibold tabular-nums ${atraso.valor > 0 ? "text-red-600" : "text-slate-700"}`}>
              {formatarPreco(atraso.valor)}
            </span>
            <span className="text-slate-500">
              · {atraso.n} {atraso.n === 1 ? "cobrança" : "cobranças"}
            </span>
          </span>
        </Link>

        <Link href="/admin/cobrancas" className={LINHA}>
          <span className={TEXTO}>
            {/* «rendas» está dito aqui, e não só na legenda, porque é o número
                que diverge da página se alguém o ler como «a semana toda». */}
            <span className="font-semibold text-slate-950">Esta semana (dom–sáb) · rendas:</span>
            <span className="text-slate-700">
              recebido{" "}
              <span className="font-semibold tabular-nums text-emerald-700">{formatarPreco(semana.recebido)}</span> de{" "}
              <span className="tabular-nums">{formatarPreco(semana.devido)}</span>
            </span>
            <span className="text-slate-500">
              · falta{" "}
              <span className={`tabular-nums ${semana.falta > 0 ? "font-semibold text-slate-700" : ""}`}>
                {formatarPreco(semana.falta)}
              </span>
            </span>
          </span>
        </Link>
      </div>
      <p className="mt-3 text-xs text-slate-500">{LEGENDA}</p>
    </Bloco>
  );
}

export function EsqueletoCobranca() {
  return (
    <Bloco titulo="Cobrança">
      <div className={CAIXA}>
        <div className={`flex items-center px-5 py-3 ${ALTURA_LINHA}`}>
          <Barra className="h-5 w-2/3" />
        </div>
        {/* A linha da semana passa para baixo no telemóvel: o esqueleto reserva
            as duas linhas onde elas vão mesmo aparecer, para não haver salto. */}
        <div className={`flex flex-col justify-center gap-1 px-5 py-3 ${ALTURA_LINHA}`}>
          <Barra className="h-5 w-5/6" />
          <Barra className="h-5 w-1/2 sm:hidden" />
        </div>
      </div>
      <Barra className="mt-3 h-4 w-2/3" />
    </Bloco>
  );
}
