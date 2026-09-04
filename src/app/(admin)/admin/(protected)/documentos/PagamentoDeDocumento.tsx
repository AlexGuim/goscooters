"use client";

import { useState } from "react";
import { registarPagamentoAuto } from "@/actions/pagamentoActions";
import type { ComprovativoLido } from "@/actions/pagamentoActions";
import type { PagamentoRecebidoPor } from "@/types/db";
import { Botao, campo, etiqueta } from "@/components/ui";
import { formatarPreco } from "@/lib/precos";

/**
 * O ramo "isto é dinheiro que entrou" do ecrã de Documentos.
 *
 * Fecha o ciclo no mesmo sítio: lê-se o comprovativo, confirma-se o motorista e
 * o pagamento é alocado às semanas mais antigas em dívida (FIFO), sem obrigar o
 * gestor a reabrir Cobranças e reescrever os mesmos dados.
 */
export default function PagamentoDeDocumento({
  lido,
  motoristas,
  onFeito,
  onCancelar,
}: {
  lido: ComprovativoLido;
  motoristas: { id: string; nome: string }[];
  onFeito: (msg: string) => void;
  onCancelar: () => void;
}) {
  const [motoristaId, setMotoristaId] = useState(lido.motorista?.id ?? "");
  const [valor, setValor] = useState(lido.valor ?? "");
  const [data, setData] = useState(lido.data ?? new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState(lido.referencia ?? "");
  // Pré-selecionado pelo beneficiário do comprovativo — mas sempre à vista e
  // editável: é o campo que decide de quem é o dinheiro.
  const [recebidoPor, setRecebidoPor] = useState<PagamentoRecebidoPor>(lido.recebido_por);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    const r = await registarPagamentoAuto({
      motorista_id: motoristaId,
      valor: Number(String(valor).replace(",", ".")),
      data_recebimento: data,
      metodo: lido.metodo,
      referencia: referencia.trim() || null,
      recebido_por: recebidoPor,
    });
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao registar.");
      return;
    }
    const sobra = r.sobra ?? 0;
    onFeito(
      `Pagamento registado · ${r.alocadas ?? 0} semana(s) liquidada(s)` +
        (sobra > 0.005 ? ` · sobram ${formatarPreco(sobra)} sem semana para alocar` : ""),
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-emerald-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
          Comprovativo de pagamento{lido.confianca ? ` · confiança ${lido.confianca}` : ""}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {lido.pagador ? `Enviado por ${lido.pagador}. ` : ""}
          {lido.destinatario ? `Recebido por ${lido.destinatario}. ` : ""}
          {lido.metodo ? `Método: ${lido.metodo}. ` : ""}
          O valor será aplicado às semanas mais antigas em dívida.
        </p>
      </div>

      {lido.aviso && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">{lido.aviso}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={etiqueta}>
          <span>Motorista</span>
          <select className={campo} value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
            <option value="">— escolhe o motorista —</option>
            {motoristas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>Valor (€)</span>
          <input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
        <label className={etiqueta}>
          <span>Data do pagamento</span>
          <input
            className={campo}
            type="date"
            // Um pagamento regista-se depois de o dinheiro entrar.
            max={new Date().toISOString().slice(0, 10)}
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className={etiqueta}>
          <span>Referência</span>
          <input className={campo} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <label className={etiqueta}>
          <span>Quem recebeu o dinheiro</span>
          <select
            className={campo}
            value={recebidoPor}
            onChange={(e) => setRecebidoPor(e.target.value as PagamentoRecebidoPor)}
          >
            <option value="goscooters">GoScooters</option>
            <option value="proprietario">O parceiro (conta dele)</option>
          </select>
          <span className="text-xs text-slate-500">
            {lido.beneficiario_parceiro
              ? `O comprovativo diz que o beneficiário foi ${lido.beneficiario_parceiro.nome} — um parceiro.`
              : "Decide o acerto do parceiro: se foi ele a receber, a renda não passou pela GoScooters."}
          </span>
        </label>
      </div>

      {erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{erro}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Botao variante="secondary" onClick={onCancelar} disabled={aGravar}>
          Cancelar
        </Botao>
        <Botao variante="volt" onClick={gravar} disabled={aGravar || !motoristaId || !valor}>
          {aGravar ? "A registar…" : "Registar pagamento"}
        </Botao>
      </div>
    </div>
  );
}
