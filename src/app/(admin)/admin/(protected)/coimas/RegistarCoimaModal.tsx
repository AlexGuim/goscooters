"use client";

import { useRef, useState } from "react";
import type { Moto } from "@/types/db";
import { Botao, Modal, campo, etiqueta } from "@/components/ui";
import { registarCoima, resolverCondutor } from "@/actions/coimaActions";
import { hojeEmLisboa } from "@/lib/diasUteis";

/**
 * Registar uma coima à mão, sem documento. É o procedimento de sempre
 * (registarCoima): imputa ao motorista, descobre o condutor pelo contrato na
 * data, pode gerar a dívida e avisar — e abre o processo do F306 com o n.º do
 * auto e a data da notificação. Quem chama abre a seguir a identificação.
 */
export default function RegistarCoimaModal({
  motos,
  onClose,
  onRegistada,
}: {
  motos: Pick<Moto, "id" | "matricula" | "modelo">[];
  onClose: () => void;
  onRegistada: (despesaId: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [condutor, setCondutor] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aProcurar, setAProcurar] = useState(false);
  const hoje = hojeEmLisboa();

  const valorDe = (nome: string) =>
    (formRef.current?.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";

  const sugerirCondutor = async () => {
    const veiculo = valorDe("veiculo_id");
    const data = valorDe("data_infracao") || valorDe("data_despesa");
    if (!veiculo) return setCondutor({ ok: false, texto: "Escolhe primeiro a mota." });
    if (!data) return setCondutor({ ok: false, texto: "Indica a data da infração." });
    setAProcurar(true);
    try {
      const r = await resolverCondutor(veiculo, data);
      setCondutor(
        r.ok
          ? { ok: true, texto: `${r.motorista_nome}${r.contrato_numero ? ` · ${r.contrato_numero}` : ""}` }
          : { ok: false, texto: r.error ?? "Sem contrato nessa data." },
      );
    } catch (err) {
      console.error(err);
      setCondutor({ ok: false, texto: "Não consegui procurar o condutor." });
    } finally {
      setAProcurar(false);
    }
  };

  const gravar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    const texto = (k: string) => String(dados.get(k) ?? "").trim();
    setErro(null);
    if (!texto("veiculo_id")) return setErro("Escolhe a mota.");
    setAGravar(true);
    try {
      const r = await registarCoima({
        veiculo_id: texto("veiculo_id"),
        valor: texto("valor").replace(",", "."),
        descricao: texto("descricao") || null,
        data_despesa: texto("data_despesa"),
        data_infracao: texto("data_infracao") || null,
        data_notificacao: texto("data_notificacao") || null,
        pontos: texto("pontos") ? Number(texto("pontos")) : null,
        fornecedor: texto("fornecedor") || null,
        referencia_externa: texto("referencia_externa") || null,
        gerar_divida: dados.get("gerar_divida") === "on",
        notificar: dados.get("notificar") === "on",
      });
      if (!r.success || !r.id) {
        setErro(r.error ?? "Erro ao registar a coima.");
        return;
      }
      if (r.aviso) alert(r.aviso);
      onRegistada(r.id);
    } catch (err) {
      console.error(err);
      setErro("Erro inesperado. Tenta novamente.");
    } finally {
      setAGravar(false);
    }
  };

  return (
    <Modal onClose={onClose} titulo="Registar coima" subtitulo="Sem documento — os dados do auto à mão." maxWidth="max-w-xl">
      <form ref={formRef} onSubmit={gravar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={etiqueta}>
            <span>
              Mota <span className="text-red-600">*</span>
            </span>
            <select className={campo} name="veiculo_id" defaultValue="" required>
              <option value="">— escolher —</option>
              {motos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.matricula ?? "?"} · {m.modelo}
                </option>
              ))}
            </select>
          </label>
          <label className={etiqueta}>
            <span>
              Valor (€) <span className="text-red-600">*</span>
            </span>
            <input className={campo} name="valor" type="number" step="0.01" min="0.01" required />
          </label>
          <label className={etiqueta}>
            <span>N.º do auto</span>
            <input className={campo} name="referencia_externa" inputMode="numeric" placeholder="9 dígitos" />
          </label>
          <label className={etiqueta}>
            <span>Entidade</span>
            <input className={campo} name="fornecedor" placeholder="ANSR, PSP, GNR, câmara…" />
          </label>
          <label className={etiqueta}>
            <span>
              Data do auto <span className="text-red-600">*</span>
            </span>
            <input className={campo} name="data_despesa" type="date" max={hoje} required />
          </label>
          <label className={etiqueta}>
            <span>
              Data da infração <span className="text-red-600">*</span>
            </span>
            <input className={campo} name="data_infracao" type="date" max={hoje} required />
          </label>
          <label className={etiqueta}>
            <span>Data da notificação</span>
            <input className={campo} name="data_notificacao" type="date" max={hoje} />
          </label>
          <label className={etiqueta}>
            <span>Pontos (se aplicável)</span>
            <input className={campo} name="pontos" type="number" min="0" step="1" />
          </label>
        </div>

        <label className={etiqueta}>
          <span>Descrição</span>
          <input className={campo} name="descricao" placeholder="Ex.: excesso de velocidade na A5" />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Botao type="button" variante="secondary" tamanho="sm" onClick={sugerirCondutor} disabled={aProcurar}>
            {aProcurar ? "A procurar…" : "Sugerir condutor"}
          </Botao>
          {condutor && (
            <span className={`text-sm ${condutor.ok ? "text-emerald-700" : "text-amber-700"}`}>
              {condutor.ok ? (
                <>
                  Condutor: <strong>{condutor.texto}</strong>
                </>
              ) : (
                `${condutor.texto} Podes escolhê-lo a seguir, na identificação.`
              )}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="gerar_divida" defaultChecked />
            <span className="text-sm text-slate-700">Gerar dívida ao motorista</span>
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="notificar" />
            <span className="text-sm text-slate-700">Notificar o motorista</span>
          </label>
        </div>

        <p className="text-xs text-slate-500">
          Com o n.º do auto e a data da notificação, o prazo para identificar o condutor começa logo a contar. A
          seguir abre-se a identificação do condutor.
        </p>

        {erro && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Botao type="button" variante="secondary" tamanho="lg" className="flex-1" onClick={onClose}>
            Cancelar
          </Botao>
          <Botao type="submit" tamanho="lg" className="flex-1" disabled={aGravar}>
            {aGravar ? "A registar…" : "Registar coima"}
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
