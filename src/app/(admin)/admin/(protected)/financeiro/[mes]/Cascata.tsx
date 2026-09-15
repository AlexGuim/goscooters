import { formatarPreco } from "@/lib/precos";
import { juntarParcelas, type FechoGestao, type ParcelaComparada } from "@/lib/fechoGestao";

/**
 * O fecho de gestão do mês em cascata, com o mês anterior ao lado:
 * Receita − Custos da frota = Margem da frota − Custos da empresa = Resultado.
 *
 * Substitui a fila de números do topo do mês. Os dois custos abrem-se para
 * mostrar de que são — a frota por categoria, a empresa por rubrica — com
 * <details>, sem JavaScript no browser.
 *
 * Vive à parte para as páginas do Resultado poderem mudar os seus rótulos sem
 * mexer na cascata.
 */

/**
 * Rótulo à esquerda, este mês e o mês anterior à direita. As colunas dos valores
 * têm largura fixa, para os números ficarem alinhados de linha para linha. No
 * telemóvel são mais estreitas e a letra é menor: um resultado de cinco dígitos
 * («−12 345,67 €») transbordava por cima do rótulo.
 */
const GRELHA =
  "grid grid-cols-[minmax(0,1fr)_6.75rem_6.75rem] items-baseline gap-x-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:gap-x-3";

/** Um valor: à direita, alinhado pelos dígitos e sempre numa só linha. */
const VALOR = "whitespace-nowrap text-right text-sm tabular-nums sm:text-base";

/** Um rótulo: pode partir em duas linhas num ecrã estreito, sem empurrar os valores. */
const ROTULO = "text-sm sm:text-base";

export default function Cascata({ este, anterior }: { este: FechoGestao; anterior: FechoGestao }) {
  return (
    <section className="print-junto rounded-3xl bg-white p-4 shadow-sm sm:p-5">
      <div className={`${GRELHA} pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
        <span />
        <span className="text-right">Este mês</span>
        <span className="text-right text-slate-400">Mês anterior</span>
      </div>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        <li>
          <Linha rotulo="Receita" este={este.receita} anterior={anterior.receita} cor="text-emerald-700" />
        </li>
        <li>
          <Custo
            rotulo="− Custos da frota"
            este={este.custos_frota}
            anterior={anterior.custos_frota}
            parcelas={juntarParcelas(este.custos_frota_por_categoria, anterior.custos_frota_por_categoria)}
          />
        </li>
        <li>
          <Linha
            rotulo="= Margem da frota"
            este={este.margem_frota}
            anterior={anterior.margem_frota}
            cor={este.margem_frota >= 0 ? "text-slate-950" : "text-red-600"}
          />
        </li>
        <li>
          <Custo
            rotulo="− Custos da empresa"
            este={este.custos_empresa}
            anterior={anterior.custos_empresa}
            parcelas={juntarParcelas(este.custos_empresa_por_rubrica, anterior.custos_empresa_por_rubrica)}
          />
        </li>
        <li>
          <Linha
            rotulo="= Resultado"
            este={este.resultado}
            anterior={anterior.resultado}
            cor={este.resultado >= 0 ? "text-emerald-700" : "text-red-600"}
            forte
          />
        </li>
      </ul>
    </section>
  );
}

function Linha({
  rotulo,
  este,
  anterior,
  cor,
  forte = false,
}: {
  rotulo: string;
  este: number;
  anterior: number;
  cor: string;
  forte?: boolean;
}) {
  return (
    <div className={`${GRELHA} py-3`}>
      <span className={`${ROTULO} ${forte ? "font-semibold text-slate-950" : "text-slate-700"}`}>{rotulo}</span>
      <span className={`${VALOR} ${forte ? "font-bold sm:text-xl" : "font-semibold"} ${cor}`}>
        {formatarPreco(este)}
      </span>
      <span className={`${VALOR} text-slate-400`}>{formatarPreco(anterior)}</span>
    </div>
  );
}

/** Uma linha de custo que se abre nas suas parcelas (se houver alguma, num dos dois meses). */
function Custo({
  rotulo,
  este,
  anterior,
  parcelas,
}: {
  rotulo: string;
  este: number;
  anterior: number;
  parcelas: ParcelaComparada[];
}) {
  const valores = (
    <>
      <span className={`${VALOR} font-semibold text-red-600`}>{formatarPreco(este)}</span>
      <span className={`${VALOR} text-slate-400`}>{formatarPreco(anterior)}</span>
    </>
  );

  if (parcelas.length === 0) {
    return (
      <div className={`${GRELHA} py-3`}>
        <span className={`${ROTULO} text-slate-700`}>{rotulo}</span>
        {valores}
      </div>
    );
  }

  return (
    <details className="group">
      <summary className="block cursor-pointer list-none py-3 [&::-webkit-details-marker]:hidden">
        <span className={GRELHA}>
          <span className={`${ROTULO} text-slate-700`}>
            {rotulo}
            <span aria-hidden className="ml-1.5 inline-block text-xs text-slate-400 transition group-open:rotate-90">
              ▸
            </span>
          </span>
          {valores}
        </span>
      </summary>
      <ul className="pb-3">
        {parcelas.map((p) => (
          <li key={p.chave} className={`${GRELHA} py-1 pl-4 text-sm`}>
            <span className="truncate text-slate-500">{p.rotulo}</span>
            <span className="whitespace-nowrap text-right tabular-nums text-slate-700">
              {p.este ? formatarPreco(p.este) : "—"}
            </span>
            <span className="whitespace-nowrap text-right tabular-nums text-slate-400">
              {p.anterior ? formatarPreco(p.anterior) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
