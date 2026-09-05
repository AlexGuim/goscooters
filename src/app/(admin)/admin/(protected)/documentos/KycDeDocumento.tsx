"use client";

import { useMemo, useState } from "react";
import {
  atualizarMotorista,
  anexarDocumentosMotorista,
  criarMotorista,
  type MotoristaEditavel,
} from "@/actions/motoristaActions";
import type { CamposDocumento, DocTipo } from "@/lib/gemini";
import type { DocIdTipo } from "@/types/db";
import { nifValidoPT, prontoParaEntrega } from "@/lib/kyc";
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
  /** Ficheiros de identidade já na ficha — contam para "pronto para entregar". */
  docUrls?: string[] | null;
};

/**
 * O que sai daqui quando se grava. Não é só uma frase: quem chamou precisa do
 * id para oferecer o passo seguinte (criar o contrato) sem obrigar a procurar
 * o motorista outra vez numa lista.
 */
export type KycFeito = {
  msg: string;
  motoristaId: string;
  nome: string;
  criado: boolean;
  /** Pela definição canónica de lib/kyc.ts — o que a ENTREGA vai exigir. */
  pronto: boolean;
  faltam: string[];
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export default function KycDeDocumento({
  lido,
  tipos,
  motoristas,
  docPaths,
  onFeito,
  onCancelar,
}: {
  lido: CamposDocumento;
  /** Que documentos foram lidos neste lote — vai no resumo do topo. */
  tipos: DocTipo[];
  motoristas: MotoristaParaKyc[];
  /** Os ficheiros lidos, já no bucket privado — ficam na ficha (`doc_urls`). */
  docPaths?: string[];
  onFeito: (r: KycFeito) => void;
  onCancelar: () => void;
}) {
  // Sugere pelo nome lido no documento — mas nunca escolhe sozinho.
  const sugerido = lido.nome
    ? motoristas.find((m) => semAcento(m.nome) === semAcento(lido.nome!))?.id ?? ""
    : "";

  // "__novo" = criar do zero a partir deste documento. Existe porque a via
  // normal de um documento é justamente alguém que AINDA não está na lista:
  // obrigar a sair, criar a ficha e voltar era perder o que a IA acabou de ler.
  const [motoristaId, setMotoristaId] = useState(sugerido);
  const [telefoneNovo, setTelefoneNovo] = useState("");
  const criando = motoristaId === "__novo";
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

  const nomeEscrito = campos.nome?.trim() ?? "";

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
    try {
      await gravarInterno();
    } catch (e) {
      // Uma server action que rebenta (rede, timeout) não pode deixar o painel
      // bloqueado: o gestor tenta outra vez (anexar é idempotente) ou cancela.
      setErro(e instanceof Error ? e.message : "Falha ao gravar. Tenta outra vez.");
    } finally {
      setAGravar(false);
    }
  };

  const gravarInterno = async () => {

    // Criar primeiro, aplicar depois: `criarMotorista` só aceita parte do
    // perfil, e o resto (carta, validades) entra pelo mesmo caminho que uma
    // atualização normal — um caminho só para gravar, não dois.
    let alvo = motoristaId;
    let criouAgora = false;
    if (criando) {
      const novo = await criarMotorista({ nome: nomeEscrito, telefone: telefoneNovo.trim() });
      if (novo.success && novo.id) {
        alvo = novo.id;
        criouAgora = true;
      } else if (novo.jaExistiaId && motoristas.some((m) => m.id === novo.jaExistiaId)) {
        // Já existe uma ficha com este telefone. Aponta-se para ela, mas NÃO se
        // grava por cima sem o gestor ver de quem é: um dígito trocado no
        // telefone reescrevia o nome e o NIF de outra pessoa.
        const dono = motoristas.find((m) => m.id === novo.jaExistiaId);
        setMotoristaId(novo.jaExistiaId);
        setAGravar(false);
        setErro(
          `Já existe um motorista com este telefone: ${dono?.nome ?? "—"}. Se for a mesma pessoa, carrega outra vez em "Aplicar à ficha" para a completar.`,
        );
        return;
      } else {
        setAGravar(false);
        setErro(
          novo.jaExistiaId
            ? "Já existe um motorista com este telefone, mas não está nesta lista (pode estar bloqueado ou ter sido criado agora) — abre-o em Motoristas."
            : novo.error ?? "Erro ao criar o motorista.",
        );
        return;
      }
    }

    // Só os campos preenchidos: um campo vazio aqui não deve APAGAR o que já
    // está na ficha — o documento acrescenta, não substitui à força.
    const texto: Record<string, string> = {};
    for (const c of GRUPOS.flatMap((g) => g.campos)) {
      const v = campos[c.chave]?.trim();
      if (v) texto[(c.coluna as string) ?? c.chave] = v;
    }
    const alvoFicha = motoristas.find((m) => m.id === alvo);
    const updates: MotoristaEditavel = {
      ...(texto as MotoristaEditavel),
      ...(docTipo ? { doc_id_tipo: docTipo as DocIdTipo } : {}),
    };
    const r = await atualizarMotorista(alvo, updates);
    if (!r.success) {
      setAGravar(false);
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }
    // Os ficheiros JUNTAM-SE aos que já lá estão — no servidor, a partir do que
    // a ficha tem AGORA (a lista deste ecrã pode estar velha).
    let docUrls = alvoFicha?.docUrls ?? [];
    if (docPaths?.length) {
      const a = await anexarDocumentosMotorista(alvo, docPaths);
      if (!a.success) {
        setAGravar(false);
        setErro(`${a.error ?? "Não consegui guardar os ficheiros na ficha."} Os campos ficaram gravados.`);
        return;
      }
      docUrls = a.doc_urls ?? [...docUrls, ...docPaths];
    }
    setAGravar(false);

    // O que a ENTREGA vai exigir, pela definição canónica — ficha + o que
    // acabou de entrar. É isto que o passo seguinte precisa de saber.
    const antes = alvoFicha?.ficha ?? {};
    const nifFinal = texto.nif ?? antes.nif ?? null;
    const prontidao = prontoParaEntrega({
      nif: nifFinal,
      nif_valido: nifValidoPT(nifFinal),
      doc_id_numero: texto.doc_id_numero ?? antes.doc_id_numero ?? null,
      carta_numero: texto.carta_numero ?? antes.carta_numero ?? null,
      morada_linha1: texto.morada_linha1 ?? antes.morada_linha1 ?? null,
      doc_urls: docUrls,
    });
    onFeito({
      msg: `${criouAgora ? "Motorista criado" : "Ficha atualizada"} · ${Object.keys(texto).length} campo(s) gravado(s)`,
      motoristaId: alvo,
      // O nome que ficou na ficha: o que se acabou de gravar, ou o que lá estava.
      nome: texto.nome ?? alvoFicha?.nome ?? nomeEscrito ?? "motorista",
      criado: criouAgora,
      pronto: prontidao.pronto,
      faltam: prontidao.faltam,
    });
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
          <option value="__novo">+ Criar motorista novo com estes dados</option>
          {motoristas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
        {lido.nome && (
          <span className="text-xs text-slate-500">
            O documento diz <strong>{lido.nome}</strong>
            {sugerido
              ? " — encontrado na lista."
              : " — não está na lista. Escolhe “Criar motorista novo”."}
          </span>
        )}
      </label>

      {criando && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm text-slate-700">
            Vai ser criada uma ficha nova para <strong>{nomeEscrito || "—"}</strong> com tudo o que
            está aqui em baixo.
          </p>
          <label className={`${etiqueta} mt-3`}>
            <span>Telefone</span>
            <input
              className={campo}
              inputMode="tel"
              placeholder="+351 9xx xxx xxx"
              value={telefoneNovo}
              onChange={(e) => setTelefoneNovo(e.target.value)}
            />
            {/* O documento não traz telefone e o negócio inteiro assenta nele —
                lembretes, contrato, WhatsApp. É o único campo que tem mesmo de
                ser escrito à mão. */}
            <span className="text-xs text-slate-500">
              Não vem no documento e é por aqui que seguem os lembretes e o contrato.
            </span>
          </label>
        </div>
      )}

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
          {!motoristaId
            ? "Escolhe o motorista — ou cria um novo — para poder gravar."
            : criando && !telefoneNovo.trim()
              ? "Falta o telefone para criar a ficha."
              : emFalta.length === 0
                ? "Perfil completo depois de gravar."
                : `Depois de gravar ficam ${emFalta.flatMap((x) => x.faltam).length} campo(s) por preencher — podes carregar mais documentos a qualquer momento.`}
        </p>
        <div className="flex gap-2">
          <Botao variante="secondary" onClick={onCancelar} disabled={aGravar}>
            Cancelar
          </Botao>
          <Botao
            variante="volt"
            onClick={gravar}
            disabled={
              aGravar || !motoristaId || (criando && (!nomeEscrito || !telefoneNovo.trim()))
            }
          >
            {aGravar
              ? criando
                ? "A criar…"
                : "A gravar…"
              : criando
                ? "Criar motorista"
                : "Aplicar à ficha"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
