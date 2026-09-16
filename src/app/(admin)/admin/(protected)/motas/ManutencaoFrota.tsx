"use client";

import { useState } from "react";
import Link from "next/link";
import type { LinhaOleoFrota } from "@/lib/manutencao/dados";
import { ROTULO_FILTRO_OLEO, passaFiltroOleo, type FiltroOleo } from "@/lib/manutencao/oleo";
import { Botao } from "@/components/ui";
import BadgeOleo from "./BadgeOleo";
import { OleoTrocadoCartao, type MotaParaOleoTrocado } from "./OleoTrocado";

/**
 * A rotina da manutenção: quem está vencido primeiro, e o «Óleo trocado» à mão.
 *
 * Abre em «Vencidas» de propósito — é a pergunta do dia. As contas vêm todas
 * feitas do servidor (o mesmo cálculo da página da mota), aqui só se filtra.
 */

const FILTROS: FiltroOleo[] = ["vencidas", "a_aproximar", "sem_registo", "todas"];

const VAZIO: Record<FiltroOleo, string> = {
  vencidas: "Nenhuma mota com o óleo vencido.",
  a_aproximar: "Nenhuma mota perto da troca de óleo.",
  sem_registo: "Todas as motas têm pelo menos uma troca de óleo registada.",
  todas: "Sem veículos.",
};

export default function ManutencaoFrota({ linhas }: { linhas: LinhaOleoFrota[] | null }) {
  const [filtro, setFiltro] = useState<FiltroOleo>("vencidas");
  const [oleo, setOleo] = useState<MotaParaOleoTrocado | null>(null);

  if (!linhas) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
        <p className="text-slate-600">Não foi possível carregar a manutenção — recarrega a página.</p>
      </div>
    );
  }

  const visiveis = linhas.filter((l) => passaFiltroOleo(l, filtro));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              filtro === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {ROTULO_FILTRO_OLEO[f]} ({linhas.filter((l) => passaFiltroOleo(l, f)).length})
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">{VAZIO[filtro]}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-slate-950">Matrícula</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-950">Estado</th>
                  <th className="px-6 py-4 text-left font-semibold text-slate-950">Próxima prevista</th>
                  <th className="px-6 py-4 text-right font-semibold text-slate-950">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visiveis.map((l) => (
                  <tr key={l.motoId} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/motas/${l.motoId}?de=manutencao`}
                        className="font-medium text-slate-950 underline-offset-2 hover:text-emerald-700 hover:underline"
                      >
                        {l.matricula ?? "ver mota"}
                      </Link>
                      <p className="text-xs text-slate-500">{l.modelo}</p>
                    </td>
                    <td className="px-6 py-4">
                      <BadgeOleo estado={l.estado} passou={l.passou}>
                        {l.texto}
                      </BadgeOleo>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{l.proxima ?? "—"}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end">
                        <Botao
                          variante="volt"
                          tamanho="sm"
                          onClick={() =>
                            setOleo({
                              id: l.motoId,
                              matricula: l.matricula,
                              modelo: l.modelo,
                              ultimaLeitura: l.ultimaLeitura,
                            })
                          }
                        >
                          Óleo trocado
                        </Botao>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {oleo && <OleoTrocadoCartao mota={oleo} onClose={() => setOleo(null)} />}
    </div>
  );
}
