"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Botao, Modal, campo } from "@/components/ui";
import { blocosPorOmissao, type BlocoDoInicio, type LarguraBloco } from "@/lib/inicioBlocos";
import { guardarInicio } from "@/actions/inicioActions";

/**
 * «Personalizar o Início»: um link discreto na faixa do topo que abre um painel
 * com uma linha por bloco — mostrar, largura e a ordem, com setas.
 *
 * Sem arrastar de propósito: arrastar não se faz no telemóvel, não se faz com o
 * teclado, e obriga a acertar. Duas setas fazem o mesmo sem pensar.
 *
 * Nada se grava enquanto não se carregar em Guardar; «Repor o original» só põe
 * as linhas como vieram de fábrica, para se ver o que fica antes de confirmar.
 *
 * O painel sai por um PORTAL (document.body), como o AcoesMenu. O botão vive na
 * faixa do topo, e essa faixa tem o canto cortado (`speed-cut`, um clip-path):
 * um clip-path recorta tudo o que está dentro — até o que é `position: fixed` —
 * e o painel aparecia cortado à altura da faixa, com os botões Guardar e
 * Cancelar fora do ecrã e fora do alcance. Pelo portal, o painel nasce fora da
 * faixa e ocupa a janela toda, como em todo o resto da aplicação.
 */
export default function PersonalizarInicio({ inicial }: { inicial: BlocoDoInicio[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState(inicial);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abrir = () => {
    setLista(inicial);
    setErro(null);
    setAberto(true);
  };

  const trocar = (i: number, mudanca: Partial<BlocoDoInicio>) =>
    setLista((atual) => atual.map((b, j) => (i === j ? { ...b, ...mudanca } : b)));

  const mover = (i: number, passo: -1 | 1) =>
    setLista((atual) => {
      const j = i + passo;
      if (j < 0 || j >= atual.length) return atual;
      const novo = [...atual];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
    });

  const guardar = async () => {
    setAGuardar(true);
    setErro(null);
    const r = await guardarInicio(
      lista.map(({ id, largura, visivel }) => ({ id, largura, visivel })),
    );
    setAGuardar(false);
    if (!r.success) {
      setErro(r.error ?? "Não foi possível guardar o Início.");
      return;
    }
    setAberto(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="text-xs font-semibold text-slate-400 underline underline-offset-4 transition hover:text-emerald-400"
      >
        Personalizar o Início
      </button>

      {/* O portal só se toca depois de o gestor abrir o painel — no servidor o
          painel está fechado e nunca se procura o document.body. */}
      {aberto &&
        createPortal(
          <Modal
            onClose={() => setAberto(false)}
            titulo="Personalizar o Início"
            subtitulo="O que aparece, com que largura e por que ordem."
            maxWidth="max-w-lg"
          >
            <div className="divide-y divide-slate-100">
              {lista.map((b, i) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={b.visivel}
                      onChange={(e) => trocar(i, { visivel: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {b.rotulo}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={b.largura}
                      onChange={(e) => trocar(i, { largura: e.target.value as LarguraBloco })}
                      aria-label={`Largura de ${b.rotulo}`}
                      className={`${campo} w-28 px-3 py-2`}
                    >
                      <option value="meia">Meia</option>
                      <option value="toda">Toda</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      aria-label={`Subir ${b.rotulo}`}
                      className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === lista.length - 1}
                      aria-label={`Descer ${b.rotulo}`}
                      className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {erro && <p className="mt-4 text-sm text-red-600">{erro}</p>}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Botao onClick={guardar} disabled={aGuardar}>
                {aGuardar ? "A guardar..." : "Guardar"}
              </Botao>
              <Botao variante="secondary" onClick={() => setLista(blocosPorOmissao())} disabled={aGuardar}>
                Repor o original
              </Botao>
              <Botao variante="ghost" onClick={() => setAberto(false)} disabled={aGuardar}>
                Cancelar
              </Botao>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
