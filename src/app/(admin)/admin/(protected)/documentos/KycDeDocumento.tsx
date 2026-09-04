"use client";

import { useState } from "react";
import { atualizarMotorista } from "@/actions/motoristaActions";
import type { CamposDocumento } from "@/lib/gemini";
import { Botao, campo, etiqueta } from "@/components/ui";

/**
 * O ramo "isto é um documento de identidade" do ecrã de Documentos.
 *
 * Antes este ecrã dizia "o KYC regista-se no fluxo de entrega do contrato (não
 * aqui)" e ficava por ali — mas o gestor tinha o documento em mãos e nenhum
 * sítio onde o pôr sem obrigar o motorista a preencher um link. Agora escolhe-se
 * a quem pertence e a ficha é preenchida com o que a IA leu.
 *
 * Só grava os campos que a IA leu E que o gestor deixou ficar: o documento
 * manda, mas o último a decidir é quem está a olhar para ele.
 */
const ROTULOS: { chave: keyof CamposDocumento; rotulo: string }[] = [
  { chave: "nome", rotulo: "Nome" },
  { chave: "nif", rotulo: "NIF" },
  { chave: "doc_id_numero", rotulo: "Nº do documento" },
  { chave: "doc_id_validade", rotulo: "Validade do documento" },
  { chave: "data_nascimento", rotulo: "Data de nascimento" },
  { chave: "nacionalidade_iso2", rotulo: "Nacionalidade" },
  { chave: "carta_numero", rotulo: "Nº da carta" },
  { chave: "carta_categoria", rotulo: "Categoria da carta" },
  { chave: "carta_validade", rotulo: "Validade da carta" },
  { chave: "morada_linha1", rotulo: "Morada" },
  { chave: "codigo_postal", rotulo: "Código postal" },
  { chave: "localidade", rotulo: "Localidade" },
];

export default function KycDeDocumento({
  lido,
  motoristas,
  onFeito,
  onCancelar,
}: {
  lido: CamposDocumento;
  motoristas: { id: string; nome: string }[];
  onFeito: (msg: string) => void;
  onCancelar: () => void;
}) {
  // Sugere pelo nome lido no documento — mas nunca escolhe sozinho.
  const semAcento = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const sugerido = lido.nome
    ? motoristas.find((m) => semAcento(m.nome) === semAcento(lido.nome!))?.id ?? ""
    : "";

  const [motoristaId, setMotoristaId] = useState(sugerido);
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ROTULOS.map(({ chave }) => [chave, (lido[chave] as string | null) ?? ""]),
    ),
  );
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const preenchidos = ROTULOS.filter(({ chave }) => campos[chave]?.trim());

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    // Só os campos preenchidos: um campo vazio aqui não deve APAGAR o que já
    // está na ficha — o documento acrescenta, não substitui à força.
    const updates: Record<string, string> = {};
    for (const { chave } of ROTULOS) {
      const v = campos[chave]?.trim();
      if (v) updates[chave] = v;
    }
    const r = await atualizarMotorista(motoristaId, updates);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }
    onFeito(`Ficha atualizada · ${preenchidos.length} campo(s) do documento.`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Documento de identidade
        </p>
        <p className="mt-1 text-sm text-slate-700">
          A IA leu {preenchidos.length} campo(s). Escolhe de quem é e confirma — só se grava o
          que ficar preenchido aqui.
        </p>
      </div>

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
        {lido.nome && (
          <span className="text-xs text-slate-500">
            O documento diz <strong>{lido.nome}</strong>
            {sugerido ? " — encontrado na lista." : " — não encontrei ninguém com esse nome."}
          </span>
        )}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {ROTULOS.map(({ chave, rotulo }) => (
          <label key={chave} className={etiqueta}>
            <span>{rotulo}</span>
            <input
              className={campo}
              value={campos[chave] ?? ""}
              onChange={(e) => setCampos((c) => ({ ...c, [chave]: e.target.value }))}
            />
          </label>
        ))}
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
        <Botao variante="volt" onClick={gravar} disabled={aGravar || !motoristaId}>
          {aGravar ? "A gravar…" : "Aplicar à ficha"}
        </Botao>
      </div>
    </div>
  );
}
