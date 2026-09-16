import Link from "next/link";
import { formatarPreco } from "@/lib/precos";
import { graficoDoResultado, ultimoFechado } from "@/lib/inicioResultado";
import { Bloco, BlocoFalhou, Barra } from "./Bloco";
import { lerResultado } from "./dados";

/** Altura da área desenhada. As colunas são % desta altura. */
const PLOT = "h-40";

/** No telemóvel só cabem quatro meses; os mais antigos escondem-se. */
const VISIVEIS_NO_TELEMOVEL = 4;

const CARTAO = "rounded-3xl bg-white p-5 shadow-sm";
const LEGENDA = "receita das semanas − custos da frota − custos da empresa · valores vivos";

/** "−223 €" / "+150 €" — com o sinal à frente, para se ler a direção antes do número. */
function comSinal(valor: number): string {
  return `${valor < 0 ? "−" : "+"}${formatarPreco(Math.abs(valor))}`;
}

/**
 * O Resultado dos últimos seis meses, em colunas.
 *
 * Uma só série: o Resultado do fecho de gestão (Margem da frota − Custos da
 * empresa), o mesmo número da tabela do Resultado. Desenhado em HTML e CSS, no
 * servidor: sem biblioteca de gráficos e sem JavaScript no browser.
 */
export default async function BlocoResultado() {
  let dados;
  try {
    dados = await lerResultado();
  } catch (erro) {
    console.error("Início · Resultado:", erro);
    return (
      <Bloco titulo="Resultado">
        <BlocoFalhou />
      </Bloco>
    );
  }

  const { colunas, zero } = graficoDoResultado(dados.meses, dados.mes_atual);
  const ultimo = ultimoFechado(dados.meses, dados.mes_atual);
  const primeiraVisivelNoTelemovel = Math.max(0, colunas.length - VISIVEIS_NO_TELEMOVEL);

  return (
    <Bloco titulo="Resultado" href="/admin/financeiro" abrir="Ver o ano">
      <div className={CARTAO}>
        {ultimo && (
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-950">{ultimo.nome}:</span>{" "}
            <span className="font-semibold tabular-nums">{formatarPreco(ultimo.resultado)}</span>
            {ultimo.variacao !== null && (
              <span className={ultimo.variacao >= 0 ? "text-emerald-700" : "text-red-600"}>
                {" ("}
                <span className="tabular-nums">{comSinal(ultimo.variacao)}</span>
                {ultimo.percentagem !== null && (
                  <>
                    {", "}
                    <span className="tabular-nums">
                      {ultimo.percentagem < 0 ? "−" : "+"}
                      {Math.abs(ultimo.percentagem)}%
                    </span>
                  </>
                )}
                {` face a ${ultimo.nome_anterior})`}
              </span>
            )}
          </p>
        )}

        <div className="relative mt-4">
          {/* A linha do zero atravessa o gráfico todo — por isso vive aqui e não dentro de cada coluna. */}
          <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 ${PLOT}`}>
            <div className="absolute inset-x-0 border-t border-slate-200" style={{ bottom: `${zero}%` }} />
          </div>

          <div className="flex items-start gap-1">
            {colunas.map((c, i) => {
              const positivo = c.resultado >= 0;
              const cor = positivo
                ? c.em_curso
                  ? "bg-emerald-200"
                  : "bg-emerald-500"
                : c.em_curso
                  ? "bg-red-200"
                  : "bg-red-500";
              return (
                <Link
                  key={c.competencia}
                  href={`/admin/financeiro/${c.competencia}`}
                  title={`${c.nome}: ${formatarPreco(c.resultado)}`}
                  className={`${i < primeiraVisivelNoTelemovel ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col rounded-2xl transition hover:bg-slate-50`}
                >
                  <span className={`relative block w-full ${PLOT}`}>
                    <span
                      className={`absolute inset-x-1.5 ${positivo ? "rounded-t" : "rounded-b"} ${cor}`}
                      style={{ bottom: `${c.base}%`, height: `${c.altura}%` }}
                    />
                  </span>
                  <span className="mt-2 block truncate text-center text-[11px] leading-4 text-slate-500">{c.curto}</span>
                  <span className="block truncate text-center text-[11px] font-semibold leading-4 tabular-nums text-slate-900">
                    {formatarPreco(c.resultado)}
                  </span>
                  {/* A linha existe em todas as colunas, visível só no mês em curso: assim
                      todas têm a mesma altura e o gráfico não fica torto. */}
                  <span
                    className={`block text-center text-[10px] leading-4 ${c.em_curso ? "text-slate-400" : "invisible"}`}
                  >
                    em curso
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">{LEGENDA}</p>
      </div>
    </Bloco>
  );
}

export function EsqueletoResultado() {
  // As mesmas medidas do gráfico carregado: frase, área desenhada, rótulos, legenda.
  const alturas = ["h-1/3", "h-1/2", "h-2/3", "h-1/2", "h-3/4", "h-1/4"];
  return (
    <Bloco titulo="Resultado">
      <div className={CARTAO}>
        <Barra className="h-5 w-3/4" />
        <div className="mt-4 flex items-start gap-1">
          {alturas.map((h, i) => (
            <div
              key={h + i}
              className={`${i < alturas.length - VISIVEIS_NO_TELEMOVEL ? "hidden sm:flex" : "flex"} min-w-0 flex-1 flex-col`}
            >
              <span className={`relative block w-full ${PLOT}`}>
                <span className={`absolute inset-x-1.5 bottom-0 ${h} animate-pulse rounded-t bg-slate-200`} />
              </span>
              <Barra className="mx-auto mt-2 h-4 w-8" />
              <Barra className="mx-auto h-4 w-12" />
              {/* O lugar do «em curso», que o gráfico carregado reserva em todas as colunas. */}
              <span className="block h-4" />
            </div>
          ))}
        </div>
        <Barra className="mt-3 h-4 w-5/6" />
      </div>
    </Bloco>
  );
}
