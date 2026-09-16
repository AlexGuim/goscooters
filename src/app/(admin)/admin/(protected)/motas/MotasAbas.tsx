"use client";

import { useEffect, useState } from "react";
import type { Moto, Proprietario } from "@/types/db";
import type { LinhaOleoFrota } from "@/lib/manutencao/dados";
import MotosList from "./MotosList";
import ManutencaoFrota from "./ManutencaoFrota";

/**
 * As sub-abas da Frota, como as da Cobrança: a lista das motas de sempre e a
 * manutenção. O URL acompanha a sub-aba (?aba=manutencao), para se poder mandar
 * o link e para o «voltar» do browser trazer de volta a lista certa.
 *
 * Com `pushState` cada troca deixa uma entrada no histórico (o `replaceState`
 * não deixava nenhuma, e o «voltar» saía da página); ao voltar, lê-se o URL
 * outra vez.
 */

type Aba = "motas" | "manutencao";

const ABAS: [Aba, string][] = [
  ["motas", "Motas"],
  ["manutencao", "Manutenção"],
];

export default function MotasAbas({
  abaInicial,
  motas,
  proprietarios,
  oleo,
}: {
  abaInicial: Aba;
  motas: Moto[];
  proprietarios: Proprietario[];
  /** Null: a manutenção não pôde ser lida (a lista das motas continua a servir). */
  oleo: LinhaOleoFrota[] | null;
}) {
  const [aba, setAba] = useState<Aba>(abaInicial);

  useEffect(() => {
    const aoVoltar = () => {
      const url = new URLSearchParams(window.location.search).get("aba");
      setAba(url === "manutencao" ? "manutencao" : "motas");
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  const mudar = (nova: Aba) => {
    if (nova === aba) return;
    setAba(nova);
    window.history.pushState(
      null,
      "",
      nova === "manutencao" ? "?aba=manutencao" : window.location.pathname,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {ABAS.map(([v, rotulo]) => (
          <button
            key={v}
            onClick={() => mudar(v)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              aba === v ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === "motas" ? (
        <MotosList initialMotas={motas} proprietarios={proprietarios} />
      ) : (
        <ManutencaoFrota linhas={oleo} />
      )}
    </div>
  );
}
