"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { registarServico } from "@/actions/manutencaoActions";
import type { ManutencaoTipo } from "@/types/db";
import {
  ROTULO_TIPO,
  TIPOS_DE_SERVICO,
  avisoDoKmConfirmado,
  formatarKm,
  lerKmEscrito,
  validarKmManual,
} from "@/lib/manutencao/oleo";
import { dataBR, dataDeHojeEmLisboa } from "@/lib/datas";
import { Botao, Modal, campo, etiqueta } from "@/components/ui";

/**
 * «Registar serviço»: pneus, travões, revisão, inspeção — o que se faz e ainda
 * não tem fatura, ou não vai ter. O óleo tem o seu botão, porque é o que manda
 * nos alertas; aqui o óleo nem sequer aparece na lista.
 *
 * Mesmas regras do «Óleo trocado» para o km: um valor fora do razoável não é
 * recusado, pede um «Confirmo este km», porque passa a ser o km da mota.
 */

export type MotaParaServico = {
  id: string;
  matricula: string | null;
  modelo: string;
  ultimaLeitura: { km: number; data: string } | null;
};

function CartaoServico({ mota, onClose }: { mota: MotaParaServico; onClose: () => void }) {
  const router = useRouter();
  const [hoje] = useState(() => dataDeHojeEmLisboa());
  const [tipo, setTipo] = useState<ManutencaoTipo>("revisao");
  const [data, setData] = useState(hoje);
  const [kmEscrito, setKmEscrito] = useState("");
  const [notas, setNotas] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [motivoDoServidor, setMotivoDoServidor] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<{ aviso?: string } | null>(null);

  const km = lerKmEscrito(kmEscrito);
  const validacao = km == null ? null : validarKmManual(km, data, mota.ultimaLeitura);
  const invalido = validacao?.resultado === "invalido" ? validacao.motivo : null;
  const motivoConfirmar =
    validacao?.resultado === "precisa_confirmacao" ? validacao.motivo : motivoDoServidor;
  const podeGravar = !aGravar && !!data && !invalido && (!motivoConfirmar || confirmo);

  const aoMudar = (mudanca: () => void) => {
    mudanca();
    setConfirmo(false);
    setMotivoDoServidor(null);
    setErro(null);
  };

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    try {
      const r = await registarServico({ motoId: mota.id, tipo, data, km, notas, confirmoKm: confirmo });
      if (r.success) {
        setFeito({ aviso: r.aviso });
        router.refresh();
      } else if (r.confirmar) {
        setMotivoDoServidor(r.error);
        setConfirmo(false);
      } else {
        setErro(r.error);
      }
    } catch (e) {
      console.error(e);
      setErro("Erro inesperado. Tenta novamente.");
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      titulo="Registar serviço"
      subtitulo={`${mota.matricula ?? "Sem matrícula"} · ${mota.modelo}`}
      maxWidth="max-w-md"
    >
      {feito ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            <p className="text-sm font-semibold text-slate-950">Serviço registado</p>
            <p className="text-sm text-slate-700">
              {ROTULO_TIPO[tipo]} a {dataBR(data)}. Fica no histórico desta mota.
            </p>
          </div>
          {feito.aviso && <p className="text-sm text-amber-700">{feito.aviso}</p>}
          <div className="flex justify-end">
            <Botao variante="secondary" onClick={onClose}>
              Fechar
            </Botao>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <label className={etiqueta}>
            <span>Serviço</span>
            <select
              className={campo}
              value={tipo}
              onChange={(e) => aoMudar(() => setTipo(e.target.value as ManutencaoTipo))}
            >
              {TIPOS_DE_SERVICO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-slate-500">
              A troca de óleo regista-se no botão «Óleo trocado».
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Data</span>
              <input
                className={campo}
                type="date"
                max={hoje}
                value={data}
                onChange={(e) => aoMudar(() => setData(e.target.value))}
              />
            </label>
            <label className={etiqueta}>
              <span>Km (opcional)</span>
              <input
                className={campo}
                inputMode="numeric"
                placeholder={mota.ultimaLeitura ? formatarKm(mota.ultimaLeitura.km) : "ex.: 41.230"}
                value={kmEscrito}
                onChange={(e) => aoMudar(() => setKmEscrito(e.target.value))}
              />
              <span className="text-xs font-normal text-slate-500">
                {mota.ultimaLeitura
                  ? `Última leitura: ${formatarKm(mota.ultimaLeitura.km)} km a ${dataBR(mota.ultimaLeitura.data)}`
                  : "Sem leituras de km."}
              </span>
            </label>
          </div>

          <label className={etiqueta}>
            <span>Nota (opcional)</span>
            <input
              className={campo}
              maxLength={200}
              placeholder="ex.: pneu traseiro, oficina do bairro"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </label>

          {invalido && <p className="text-sm text-red-700">{invalido}</p>}

          {motivoConfirmar && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-emerald-500"
                checked={confirmo}
                onChange={(e) => setConfirmo(e.target.checked)}
              />
              <span className="text-sm text-slate-700">
                <strong className="text-slate-950">Confirmo este km.</strong> {motivoConfirmar}{" "}
                {avisoDoKmConfirmado(data, mota.ultimaLeitura)}
              </span>
            </label>
          )}

          {erro && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Botao type="button" variante="secondary" tamanho="lg" className="flex-1" onClick={onClose}>
              Cancelar
            </Botao>
            <Botao
              type="button"
              variante="volt"
              tamanho="lg"
              className="flex-1"
              onClick={gravar}
              disabled={!podeGravar}
            >
              {aGravar ? "A gravar…" : "Gravar"}
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** O botão e o cartão juntos, para a página da mota. */
export default function RegistarServico({ mota }: { mota: MotaParaServico }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Botao variante="secondary" tamanho="sm" onClick={() => setAberto(true)}>
        Registar serviço
      </Botao>
      {aberto && <CartaoServico mota={mota} onClose={() => setAberto(false)} />}
    </>
  );
}
