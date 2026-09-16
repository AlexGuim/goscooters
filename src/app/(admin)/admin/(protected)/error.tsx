"use client";

import { Botao } from "@/components/ui";

/**
 * A rede de segurança da administração: o que se vê quando um ecrã rebenta e
 * não há nada mais perto a apanhá-lo.
 *
 * Existe porque as consultas passaram a lançar erro em vez de devolverem zeros
 * a fingir que estava tudo bem — e uma falha sem ninguém a apanhá-la sai como
 * uma página do Next em inglês, sem explicação e sem forma de repetir. Os ecrãs
 * com aviso próprio (o Resultado tem o seu) continuam a tratar do seu; isto só
 * vale para os que não têm.
 *
 * O texto NÃO afirma qual foi a avaria: daqui não se sabe. E a mensagem do erro
 * não vem para o ecrã de propósito (pode trazer dados da base) — fica no registo
 * do servidor. O que se mostra é a referência, para se encontrar lá a linha.
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
