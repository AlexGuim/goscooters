import Link from "next/link";
import { formatarPreco } from "@/lib/precos";
import { Bloco, BlocoFalhou, Barra } from "./Bloco";
import { lerCobranca } from "./dados";

/** Altura de uma linha: py-4 (32) + uma linha de texto text-sm (20). */
const ALTURA_LINHA = "h-[52px]";

const LINHA = `flex items-center px-5 text-sm transition hover:bg-slate-50 ${ALTURA_LINHA}`;
const CAIXA = "divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm";

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
          <span className="truncate">
            <span className="font-semibold text-slate-950">Em atraso:</span>{" "}
            <span className={`font-semibold tabular-nums ${atraso.valor > 0 ? "text-red-600" : "text-slate-700"}`}>
              {formatarPreco(atraso.valor)}
            </span>
            <span className="text-slate-500">
              {" · "}
              {atraso.n} {atraso.n === 1 ? "cobrança" : "cobranças"}
            </span>
          </span>
        </Link>

        <Link href="/admin/cobrancas" className={LINHA}>
          <span className="truncate">
            <span className="font-semibold text-slate-950">Esta semana (dom–sáb):</span>{" "}
            <span className="text-slate-700">
              recebido{" "}
              <span className="font-semibold tabular-nums text-emerald-700">{formatarPreco(semana.recebido)}</span> de{" "}
              <span className="tabular-nums">{formatarPreco(semana.devido)}</span>
            </span>
            <span className="text-slate-500">
              {" · "}falta{" "}
              <span className={`tabular-nums ${semana.falta > 0 ? "font-semibold text-slate-700" : ""}`}>
                {formatarPreco(semana.falta)}
              </span>
            </span>
          </span>
        </Link>
      </div>
    </Bloco>
  );
}

export function EsqueletoCobranca() {
  return (
    <Bloco titulo="Cobrança">
      <div className={CAIXA}>
        {["w-2/3", "w-5/6"].map((largura) => (
          <div key={largura} className={`flex items-center px-5 ${ALTURA_LINHA}`}>
            <Barra className={`h-5 ${largura}`} />
          </div>
        ))}
      </div>
    </Bloco>
  );
}
