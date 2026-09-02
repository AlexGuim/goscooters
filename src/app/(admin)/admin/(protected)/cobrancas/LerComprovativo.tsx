"use client";

import { useRef, useState } from "react";
import { enviarDocumento } from "@/lib/uploads";
import { lerComprovativoPagamento, type ComprovativoLido } from "@/actions/pagamentoActions";
import { Botao, Modal, campo, etiqueta } from "@/components/ui";
import { formatarPreco } from "@/lib/precos";

/**
 * Lê um comprovativo enviado pelo motorista (print do MB WAY, de homebanking,
 * de uma conversa de WhatsApp, foto de talão) e devolve o pagamento já
 * preenchido, para o gestor só ter de confirmar.
 *
 * Confirmar é mesmo o ponto: a IA lê, não decide. Por isso mostra-se sempre o
 * que foi lido antes de abrir o formulário, e o motorista tem de estar
 * identificado — se o nome bater em vários, escolhe-se aqui.
 */
export default function LerComprovativo({
  motoristasComDivida,
  onConfirmar,
  onClose,
}: {
  /** Só motoristas com dívida em aberto: são os únicos a quem se pode alocar. */
  motoristasComDivida: { id: string; nome: string }[];
  onConfirmar: (motoristaId: string, lido: ComprovativoLido) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<"inicio" | "a-ler" | "lido">("inicio");
  const [lido, setLido] = useState<ComprovativoLido | null>(null);
  const [motoristaId, setMotoristaId] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const aoEscolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErro(null);
    setFase("a-ler");
    try {
      const env = await enviarDocumento(f);
      if (!env.success || !env.path) {
        setErro(env.error ?? "Falha ao carregar o ficheiro.");
        setFase("inicio");
        return;
      }
      const r = await lerComprovativoPagamento(env.path);
      if (!r.success || !r.dados) {
        setErro(r.error ?? "Não consegui ler.");
        setFase("inicio");
        return;
      }
      setLido(r.dados);
      setMotoristaId(r.dados.motorista?.id ?? "");
      setFase("lido");
    } catch (err) {
      console.error(err);
      setErro(err instanceof Error ? err.message : "Falha ao carregar o ficheiro.");
      setFase("inicio");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Modal onClose={onClose} titulo="Ler comprovativo de pagamento">
      <div className="space-y-4">
        {fase !== "lido" && (
          <>
            <p className="text-sm text-slate-600">
              Carrega o print que o motorista enviou — MB WAY, transferência, conversa de
              WhatsApp ou foto do talão. A IA lê o valor, a data e quem pagou; tu confirmas.
            </p>
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={aoEscolher}
                disabled={fase === "a-ler"}
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-2xl file:border-0 file:bg-emerald-600 file:px-5 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
              />
              {fase === "a-ler" && <p className="mt-3 text-sm text-slate-500">A ler o comprovativo…</p>}
            </div>
          </>
        )}

        {fase === "lido" && lido && (
          <>
            <div className="space-y-1 rounded-2xl bg-slate-50 p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                O que li{lido.confianca ? ` · confiança ${lido.confianca}` : ""}
              </p>
              <Linha rotulo="Valor" valor={lido.valor ? formatarPreco(lido.valor) : "não li"} />
              <Linha rotulo="Data" valor={lido.data ?? "não li — fica hoje"} />
              <Linha rotulo="Quem pagou" valor={lido.pagador ?? "não li"} />
              {lido.metodo && <Linha rotulo="Método" valor={lido.metodo} />}
              {lido.referencia && <Linha rotulo="Referência" valor={lido.referencia} />}
              {lido.notas && <p className="pt-1 text-xs text-slate-500">{lido.notas}</p>}
            </div>

            {lido.aviso && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">{lido.aviso}</p>
              </div>
            )}

            <label className={etiqueta}>
              <span>Motorista</span>
              <select
                className={campo}
                value={motoristaId}
                onChange={(e) => setMotoristaId(e.target.value)}
              >
                <option value="">— escolhe o motorista —</option>
                {motoristasComDivida.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </label>

            {!lido.valor && (
              <p className="text-xs text-amber-700">
                Não consegui ler o valor — vais ter de o escrever no passo seguinte.
              </p>
            )}
          </>
        )}

        {erro && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Botao variante="secondary" onClick={onClose}>
            Cancelar
          </Botao>
          {fase === "lido" && lido && (
            <Botao
              variante="volt"
              disabled={!motoristaId}
              onClick={() => onConfirmar(motoristaId, lido)}
            >
              Continuar
            </Botao>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{rotulo}</span>
      <span className="text-right font-medium text-slate-900">{valor}</span>
    </div>
  );
}
