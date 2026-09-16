"use client";

import { Botao } from "@/components/ui";

/**
 * O que o gestor vê quando o Resultado não consegue carregar.
 *
 * Existe por causa do Resultado: desde que uma falha a ler a base passou a dar
 * erro (em vez de mostrar zeros a fingir que estava tudo bem), faltava dizer
 * isso a quem está do outro lado. Sem este ficheiro, a falha subia ao Next e
 * saía uma página em inglês, sem explicação e sem forma de repetir.
 *
 * Fica SÓ sobre o Resultado (o ano e o mês), que é quem passou a lançar erros.
 * No segmento de cima cobria a administração inteira — despesas, documentos,
 * motoristas, parceiros — e contava a todos os ecrãs a avaria deste. Pela mesma
 * razão, o texto não afirma qual foi a avaria: daqui não se sabe.
 *
 * A mensagem do erro não vem para aqui de propósito (pode trazer dados da
 * base); fica no registo do servidor. O que se mostra é a referência, que serve
 * para encontrar lá a linha certa.
 */
export default function ErroDoResultado({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-slate-950">Não foi possível carregar este ecrã</h1>
      <p className="mt-2 max-w-prose text-sm text-slate-600">
        Tenta outra vez. Se voltar a acontecer, guarda a referência abaixo e avisa quem trata do
        sistema.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Botao onClick={() => unstable_retry()}>Tentar outra vez</Botao>
        {error.digest && <span className="font-mono text-[10px] text-slate-500">ref. {error.digest}</span>}
      </div>
    </section>
  );
}
