"use client";

import { Botao } from "@/components/ui";

/**
 * O que o gestor vê quando um ecrã da administração não consegue carregar.
 *
 * Existe por causa do Resultado: desde que uma falha a ler a base passou a dar
 * erro (em vez de mostrar zeros a fingir que estava tudo bem), faltava dizer
 * isso a quem está do outro lado. Sem este ficheiro, a falha subia ao Next e
 * saía uma página em inglês, sem explicação e sem forma de repetir.
 *
 * A mensagem do erro não vem para aqui de propósito (pode trazer dados da
 * base); fica no registo do servidor. O que se mostra é a referência, que serve
 * para encontrar lá a linha certa.
 */
export default function ErroDaAdministracao({
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
        Falhou a leitura dos dados — não é uma conta errada, é informação que não chegou. Até isto
        passar, os números deste ecrã não são de fiar. Tenta outra vez; se voltar a acontecer, guarda
        a referência abaixo.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Botao onClick={() => unstable_retry()}>Tentar outra vez</Botao>
        {error.digest && <span className="font-mono text-[10px] text-slate-400">ref. {error.digest}</span>}
      </div>
    </section>
  );
}
