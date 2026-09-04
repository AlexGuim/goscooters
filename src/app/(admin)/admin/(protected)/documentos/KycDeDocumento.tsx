"use client";

import { useMemo, useState } from "react";
import { atualizarMotorista, type MotoristaEditavel } from "@/actions/motoristaActions";
import type { CamposDocumento, DocTipo } from "@/lib/gemini";
import type { DocIdTipo } from "@/types/db";
import { nifValidoPT } from "@/lib/kyc";
import { Botao, campo, etiqueta } from "@/components/ui";

/**
 * O ramo "isto é um documento de identidade" do ecrã de Documentos.
 *
 * Três ideias sustentam este ecrã:
 *
 * 1. A ficha COMPLETA-SE, não se substitui. Um motorista chega em pedaços — hoje
 *    o título de residência, amanhã a carta, para o mês o comprovativo de morada.
 *    Por isso o que já está na ficha aparece à vista e um campo vazio nunca apaga
 *    o que lá está.
 * 2. O que FALTA é informação tão útil como o que veio. Saber que falta o NIF (e
 *    que papel o traz) evita a segunda viagem do motorista à loja.
 * 3. O último a decidir é quem está a olhar para o documento. A IA propõe; nada
 *    se grava sem passar por aqui.
 */

type Chave = keyof CamposDocumento;

/** Campo do formulário e a coluna da ficha que alimenta. */
type Campo = {
  chave: Chave;
  rotulo: string;
  /** A coluna tem outro nome em `motorista` (só a nacionalidade). */
  coluna?: keyof MotoristaEditavel;
};

type Grupo = {
  titulo: string;
  campos: Campo[];
  /** Que documento traz estes campos, para pedir ao motorista o que falta. */
  ondeEsta: string;
};

const GRUPOS: Grupo[] = [
  {
    titulo: "Identificação",
    ondeEsta: "título de residência, cartão de cidadão ou passaporte — a FRENTE",
    campos: [
      { chave: "nome", rotulo: "Nome" },
      { chave: "data_nascimento", rotulo: "Data de nascimento" },
      { chave: "nacionalidade_iso2", rotulo: "Nacionalidade", coluna: "pais_iso" },
      { chave: "doc_id_numero", rotulo: "Nº do documento" },
      { chave: "doc_id_validade", rotulo: "Validade do documento" },
    ],
  },
  {
    titulo: "Carta de condução",
    ondeEsta: "carta de condução — frente E verso (as categorias estão no verso)",
    campos: [
      { chave: "carta_numero", rotulo: "Nº da carta" },
      { chave: "carta_categoria", rotulo: "Categorias" },
      { chave: "carta_validade", rotulo: "Validade da carta" },
      { chave: "carta_pais", rotulo: "País emissor" },
    ],
  },
  {
    titulo: "Fiscal",
    ondeEsta:
      "o VERSO do título de residência ou do cartão de cidadão, sob \u201cNº IDENT. FISCAL\u201d — ou o cartão de contribuinte",
    campos: [{ chave: "nif", rotulo: "NIF" }],
  },
  {
    titulo: "Morada",
    ondeEsta:
      "o VERSO do título de residência (o cartão de cidadão não a mostra) ou um comprovativo — fatura de água/luz, atestado de residência",
    campos: [
      { chave: "morada_linha1", rotulo: "Morada" },
      { chave: "codigo_postal", rotulo: "Código postal" },
      { chave: "localidade", rotulo: "Localidade" },
    ],
  },
];

const TIPOS_DOC: { v: DocIdTipo; r: string }[] = [
  { v: "cc", r: "Cartão de cidadão" },
  { v: "titulo_residencia", r: "Título de residência" },
  { v: "aima", r: "AIMA" },
  { v: "passaporte", r: "Passaporte" },
];

/** Categorias que habilitam a conduzir uma scooter. */
const CATEGORIAS_MOTO = ["AM", "A1", "A2", "A"];

export type MotoristaParaKyc = {
  id: string;
  nome: string;
  /** O que a ficha já tem, para o ecrã completar em vez de substituir. */
  ficha?: Partial<Record<string, string | null>>;
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export default function KycDeDocumento({
  lido,
  tipos,
  motoristas,
  onFeito,
  onCancelar,
}: {
  lido: CamposDocumento;
  /** Que documentos foram lidos neste lote — vai no resumo do topo. */
  tipos: DocTipo[];
  motoristas: MotoristaParaKyc[];
  onFeito: (msg: string) => void;
  onCancelar: () => void;
}) {
  // Sugere pelo nome lido no documento — mas nunca escolhe sozinho.
  const sugerido = lido.nome
    ? motoristas.find((m) => semAcento(m.nome) === semAcento(lido.nome!))?.id ?? ""
    : "";

  const [motoristaId, setMotoristaId] = useState(sugerido);
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      GRUPOS.flatMap((g) => g.campos).map(({ chave }) => [chave, (lido[chave] as string | null) ?? ""]),
    ),
  );
  const [docTipo, setDocTipo] = useState<string>(lido.doc_id_tipo ?? "");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ficha = useMemo(
    () => motoristas.find((m) => m.id === motoristaId)?.ficha ?? {},
    [motoristas, motoristaId],
  );

  /** O que a ficha já tem para este campo (para mostrar ao lado do que a IA leu). */
  const naFicha = (c: Campo) => {
    const v = ficha[(c.coluna as string) ?? c.chave];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const lidosAgora = GRUPOS.flatMap((g) => g.campos).filter(({ chave }) => campos[chave]?.trim());

  // O que fica em falta DEPOIS de aplicar isto: o que nem a leitura nem a ficha
  // têm. É esta a lista que diz que papel ainda falta pedir ao motorista.
  const emFalta = GRUPOS.map((g) => ({
    grupo: g,
    faltam: g.campos.filter((c) => !campos[c.chave]?.trim() && !naFicha(c)),
  })).filter((x) => x.faltam.length > 0);

  // Uma carta sem categoria de motociclo é o problema que só aparece tarde — a
  // moto já entregue. Vale a pena vê-lo agora, com o documento na mão.
  // O NIF tem dígito de controlo, por isso um erro de leitura apanha-se aqui sem
  // depender da IA. Vale a pena: no verso do título de residência o Nº DE UTENTE
  // DE SAÚDE também tem 9 dígitos e está encostado ao NIF — trocá-los é o erro
  // natural, e o checksum é precisamente o que os distingue.
  const nifEscrito = campos.nif?.trim() ?? "";
  const nifMau = nifEscrito.length > 0 && nifValidoPT(nifEscrito) === false;

  const cat = campos.carta_categoria?.trim();
  const semCategoriaMoto =
    !!cat &&
    !CATEGORIAS_MOTO.some((k) => new RegExp(`(^|[^A-Z0-9])${k}([^0-9]|$)`).test(cat.toUpperCase()));

  const gravar = async () => {
    setErro(null);
    setAGravar(true);
    // Só os campos preenchidos: um campo vazio aqui não deve APAGAR o que já
    // está na ficha — o documento acrescenta, não substitui à força.
    const updates: Record<string, string> = {};
    for (const c of GRUPOS.flatMap((g) => g.campos)) {
      const v = campos[c.chave]?.trim();
      if (v) updates[(c.coluna as string) ?? c.chave] = v;
    }
    if (docTipo) updates.doc_id_tipo = docTipo;
    const r = await atualizarMotorista(motoristaId, updates as MotoristaEditavel);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }
    const falta = emFalta.flatMap((x) => x.faltam).length;
    onFeito(
      `Ficha atualizada · ${Object.keys(updates).length} campo(s)` +
        (falta ? ` · ainda faltam ${falta}` : " · perfil completo"),
    );
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Documentos de identidade{tipos.length > 1 ? ` · ${tipos.length} ficheiros lidos em conjunto` : ""}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          A IA leu <strong>{lidosAgora.length} campo(s)</strong>. Escolhe de quem é e confirma — só se
          grava o que ficar preenchido aqui, e nada apaga o que a ficha já tem.
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

      {nifMau && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">
            <strong>{nifEscrito}</strong> não passa no dígito de controlo do NIF. No verso do
            título de residência há três números seguidos — confirma que copiaste o que está sob
            <em> Nº IDENT. FISCAL</em>, e não o de segurança social ou o de utente de saúde.
          </p>
        </div>
      )}

      {semCategoriaMoto && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            <strong>Categorias {cat}</strong> — a carta não tem A, A1, A2 nem AM. Confirma que
            habilita a conduzir a scooter antes de entregar a mota.
          </p>
        </div>
      )}

      {GRUPOS.map((g) => {
        const faltamAqui = g.campos.filter((c) => !campos[c.chave]?.trim() && !naFicha(c));
        return (
          <section key={g.titulo} className="rounded-2xl border border-slate-200 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{g.titulo}</h3>
              {faltamAqui.length === 0 ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  completo
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  falta {faltamAqui.map((c) => c.rotulo.toLowerCase()).join(", ")}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {g.titulo === "Identificação" && (
                <label className={etiqueta}>
                  <span>Tipo de documento</span>
                  <select className={campo} value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>
                    <option value="">— por indicar —</option>
                    {TIPOS_DOC.map((t) => (
                      <option key={t.v} value={t.v}>
                        {t.r}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {g.campos.map((c) => {
                const jaTem = naFicha(c);
                const agora = campos[c.chave]?.trim();
                const diverge = jaTem && agora && jaTem !== agora;
                return (
                  <label key={c.chave} className={etiqueta}>
                    <span>{c.rotulo}</span>
                    <input
                      className={campo}
                      value={campos[c.chave] ?? ""}
                      placeholder={jaTem ? jaTem : "—"}
                      onChange={(e) => setCampos((s) => ({ ...s, [c.chave]: e.target.value }))}
                    />
                    {diverge ? (
                      <span className="text-xs text-amber-700">
                        A ficha diz <strong>{jaTem}</strong> — gravar substitui.
                      </span>
                    ) : jaTem && !agora ? (
                      <span className="text-xs text-slate-500">Já na ficha: {jaTem}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>

            {faltamAqui.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Onde encontrar: {g.ondeEsta}.
              </p>
            )}
          </section>
        );
      })}

      {erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{erro}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {emFalta.length === 0
            ? "Perfil completo depois de gravar."
            : `Depois de gravar ficam ${emFalta.flatMap((x) => x.faltam).length} campo(s) por preencher — podes carregar mais documentos a qualquer momento.`}
        </p>
        <div className="flex gap-2">
          <Botao variante="secondary" onClick={onCancelar} disabled={aGravar}>
            Cancelar
          </Botao>
          <Botao variante="volt" onClick={gravar} disabled={aGravar || !motoristaId}>
            {aGravar ? "A gravar…" : "Aplicar à ficha"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
