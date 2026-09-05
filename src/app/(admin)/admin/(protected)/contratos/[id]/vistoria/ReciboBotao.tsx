"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { criarLinkRecibo } from "@/actions/reciboActions";
import { Botao, classesBotao } from "@/components/ui";

/**
 * Gera o link do contrato + recibo de entrega e mostra-o com o WhatsApp pronto.
 * `autoGerar` gera-o logo ao montar (cartão pós-entrega): o gestor acabou de
 * submeter a entrega e o passo seguinte é enviar — não há razão para mais um clique.
 */
export default function ReciboBotao({ contratoId, autoGerar = false }: { contratoId: string; autoGerar?: boolean }) {
  const [aGerar, setAGerar] = useState(false);
  const [res, setRes] = useState<{ link: string; whatsapp: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const gerar = useCallback(async () => {
    setErro(null);
    setAGerar(true);
    const r = await criarLinkRecibo(contratoId);
    setAGerar(false);
    if (r.success && r.link) setRes({ link: r.link, whatsapp: r.whatsapp ?? null });
    else setErro(r.error ?? "Erro ao gerar o recibo.");
  }, [contratoId]);

  // Só uma vez por montagem (o StrictMode em dev corre o efeito duas vezes).
  const autoJaCorreu = useRef(false);
  useEffect(() => {
    if (!autoGerar || autoJaCorreu.current) return;
    autoJaCorreu.current = true;
    gerar();
  }, [autoGerar, gerar]);

  if (res) {
    return (
      <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
        <p className="text-xs font-semibold text-emerald-800">Contrato pronto para enviar ao motorista:</p>
        <input
          readOnly
          value={res.link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {res.whatsapp && (
            <a href={res.whatsapp} target="_blank" rel="noreferrer" className={classesBotao("volt", "sm")}>
              Enviar por WhatsApp
            </a>
          )}
          <a href={res.link} target="_blank" rel="noreferrer" className={classesBotao("secondary", "sm")}>
            Abrir
          </a>
          <Botao variante="ghost" tamanho="sm" onClick={() => setRes(null)}>
            Fechar
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Botao variante={autoGerar ? "volt" : "secondary"} onClick={gerar} disabled={aGerar}>
        {aGerar ? "A gerar…" : "Enviar contrato ao motorista"}
      </Botao>
      {erro && <p className="text-xs text-red-700">{erro}</p>}
    </div>
  );
}
