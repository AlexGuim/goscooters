"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  criarMotorista,
  procurarMotoristaPorTelefone,
  atualizarMotorista,
  anexarDocumentosMotorista,
  prontidaoEntrega,
  type MotoristaEditavel,
} from "@/actions/motoristaActions";
import { enviarDocumentoPrivado } from "@/lib/uploads";
import { apagarDocumentosPrivados, lerDocumentoIA } from "@/actions/fotoActions";
import type { CamposDocumento } from "@/lib/gemini";
import { contratoAbertoDeMotorista, criarContrato, finalizarPreContrato } from "@/actions/contratoActions";
import { criarSessaoEntrega, criarSessaoRegisto } from "@/actions/entregaActions";
import { hrefJornada } from "@/lib/jornada";
import { NOME_PLACEHOLDER, ehNomePlaceholder } from "@/lib/nomeMotorista";
import type { ContratoAberto } from "@/lib/contratoAberto";
import type { DocIdTipo } from "@/types/db";
import { Botao, classesBotao, campo, etiqueta } from "@/components/ui";

type MotoristaOpt = { id: string; nome: string; telefone: string | null };
type MotoOpt = { id: string; matricula: string | null; modelo: string; proprietario_id: string | null; estado_operacional: string };

const PASSOS = ["Motorista", "Contrato", "Entrega"] as const;

export default function AluguelWizard({
  motoristas,
  motos,
  motoristaInicial = null,
  contratoAberto = null,
}: {
  motoristas: MotoristaOpt[];
  motos: MotoOpt[];
  /**
   * Quem chega de Documentos ou da ficha já escolheu o motorista — o wizard
   * arranca no contrato, em vez de pedir para o procurar outra vez num select.
   */
  motoristaInicial?: { id: string; nome: string } | null;
  contratoAberto?: ContratoAberto | null;
}) {
  const [passo, setPasso] = useState<1 | 2 | 3>(motoristaInicial ? 2 : 1);
  const [motoristaId, setMotoristaId] = useState<string | null>(motoristaInicial?.id ?? null);
  const [motoristaNome, setMotoristaNome] = useState(motoristaInicial?.nome ?? "");
  const [contratoId, setContratoId] = useState<string | null>(null);
  const [contratoNumero, setContratoNumero] = useState("");
  // O contrato aberto do motorista ESCOLHIDO — o da página quando se entra com
  // "?motorista=", ou o que o passo 1 vai buscar quando escolhe outro. Sem isto
  // o passo 1 criava um rascunho por cima de um pré-contrato já existente.
  const [aberto, setAberto] = useState<ContratoAberto | null>(contratoAberto);
  // "Criar outro contrato mesmo assim" — para o contrato aberto não ser uma parede.
  const [ignorarAberto, setIgnorarAberto] = useState(false);
  // O passo 3 diz "criado" ou "finalizado" conforme o que aconteceu.
  const [finalizou, setFinalizou] = useState(false);

  const abertoDeste = ignorarAberto ? null : aberto;
  const preContrato = abertoDeste?.estado === "pre_contrato" ? abertoDeste : null;
  const jaTemContrato = abertoDeste && abertoDeste.estado !== "pre_contrato" ? abertoDeste : null;

  return (
    <div className="space-y-6">
      {/* Barra de passos */}
      <ol className="flex items-center gap-2">
        {PASSOS.map((nome, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const feito = n < passo;
          const atual = n === passo;
          return (
            <li key={nome} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  atual ? "bg-emerald-600 text-white" : feito ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                }`}
              >
                {feito ? "✓" : n}
              </span>
              <span className={`text-sm font-semibold ${atual ? "text-slate-950" : "text-slate-500"}`}>
                {nome}
                {n === 1 && feito && motoristaNome && (
                  <span className="hidden font-normal sm:inline"> · {motoristaNome}</span>
                )}
              </span>
              {i < PASSOS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
            </li>
          );
        })}
      </ol>

      {passo === 1 && (
        <PassoMotorista
          motoristas={motoristas}
          onPronto={async (id, nome) => {
            // Motorista acabado de criar não tem contrato; um já existente pode
            // ter — e é isso que decide se o passo 2 cria ou finaliza.
            const r =
              id === motoristaInicial?.id
                ? { success: true, contrato: contratoAberto }
                : await contratoAbertoDeMotorista(id);
            // Sem resposta não se avança "como se não houvesse": era assim que
            // nascia um rascunho por cima de um pré-contrato.
            if (!r.success) return { error: r.error ?? "Não consegui verificar se já tem contrato. Tenta outra vez." };
            setMotoristaId(id);
            setMotoristaNome(nome);
            setAberto(r.contrato ?? null);
            setIgnorarAberto(false);
            setPasso(2);
          }}
        />
      )}

      {passo === 2 && motoristaId && jaTemContrato && (
        <ContratoJaExiste
          contrato={jaTemContrato}
          motoristaNome={motoristaNome}
          onVoltar={() => setPasso(1)}
          onCriarOutro={() => setIgnorarAberto(true)}
        />
      )}

      {passo === 2 && motoristaId && !jaTemContrato && (
        <PassoContrato
          motoristaId={motoristaId}
          motoristaNome={motoristaNome}
          motos={motos}
          preContrato={preContrato}
          onVoltar={() => setPasso(1)}
          onPronto={(id, numero, finalizado) => {
            setContratoId(id);
            setContratoNumero(numero);
            setFinalizou(finalizado);
            setPasso(3);
          }}
        />
      )}

      {passo === 3 && contratoId && motoristaId && (
        <PassoEntrega
          contratoId={contratoId}
          contratoNumero={contratoNumero}
          finalizado={finalizou}
          motoristaId={motoristaId}
          motoristaNome={motoristaNome}
        />
      )}
    </div>
  );
}

// ── Passo 1 — Motorista ──────────────────────────────────────────────────────
function PassoMotorista({
  motoristas,
  onPronto,
}: {
  motoristas: MotoristaOpt[];
  /** Devolve `{ error }` quando não pôde avançar — o passo 1 mostra-o. */
  onPronto: (id: string, nome: string) => Promise<{ error?: string } | void>;
}) {
  const [modo, setModo] = useState<"existente" | "preencher" | "link">("existente");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  // existente
  const [selId, setSelId] = useState("");
  // preencher / link
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [idioma, setIdioma] = useState("pt");
  // KYC lido dos documentos, para ser gravado LOGO A SEGUIR à criação da ficha.
  // Guarda-se em vez de se gravar já porque o motorista ainda não existe: só o
  // `criarMotorista` lhe dá um id.
  const [kyc, setKyc] = useState<CamposDocumento | null>(null);
  // Os ficheiros lidos ficam na ficha: a entrega exige-os, e seria pedir ao
  // motorista o mesmo cartão que o gestor acabou de fotografar.
  const [docPaths, setDocPaths] = useState<string[]>([]);
  const [aLerDocs, setALerDocs] = useState(false);
  const [statusDocs, setStatusDocs] = useState<string | null>(null);
  // link result
  const [link, setLink] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [motoristaDoLink, setMotoristaDoLink] = useState<string | null>(null);
  // "Preencher já" com um telefone que já existe: mostra-se de quem é a ficha
  // e espera-se por um segundo clique — um dígito trocado no telefone não pode
  // reescrever o NIF e os documentos de outra pessoa.
  const [existente, setExistente] = useState<{ id: string; nome: string; email: string | null } | null>(null);

  // Ficheiros lidos que ainda não entraram em nenhuma ficha: se o gestor sair
  // do passo sem os aplicar, saem do bucket — não ficam órfãos no privado.
  const docPathsRef = useRef<string[]>([]);
  const anexadosRef = useRef(false);
  useEffect(() => {
    docPathsRef.current = docPaths;
  }, [docPaths]);
  useEffect(
    () => () => {
      if (!anexadosRef.current && docPathsRef.current.length) void apagarDocumentosPrivados(docPathsRef.current);
    },
    [],
  );

  const avancar = async (id: string, nomeFinal: string) => {
    const r = await onPronto(id, nomeFinal);
    if (r?.error) setErro(r.error);
  };

  const escolherExistente = async () => {
    const m = motoristas.find((x) => x.id === selId);
    if (!m) return setErro("Escolhe um motorista.");
    setErro(null);
    // Documentos lidos antes de trocar para "Já existe" seguem com o escolhido.
    if (docPaths.length || kyc) {
      setAGravar(true);
      const u = await aplicarLido(m.id);
      setAGravar(false);
      if (!u.success) return setErro(`${u.error} Corrige na ficha depois de avançar.`);
    }
    await avancar(m.id, m.nome);
  };

  /**
   * Lê os documentos que o gestor tem em mãos e preenche o que puder.
   *
   * Antes, quem já tinha os documentos era mandado para o passo 3 ou para o
   * ecrã de Motoristas — dois sítios diferentes para a mesma folha de papel.
   */
  const lerDocs = async (files: FileList | null) => {
    const lista = Array.from(files ?? []).slice(0, 4);
    if (!lista.length) return;
    setErro(null);
    setALerDocs(true);
    setStatusDocs("A carregar…");
    try {
      const paths: string[] = [];
      for (const f of lista) {
        const env = await enviarDocumentoPrivado(f);
        if (!env.success || !env.path) throw new Error(env.error ?? "Falha ao carregar.");
        paths.push(env.path);
        // Cada ficheiro fica para a ficha assim que sobe — ANTES de saber se
        // a IA o lê ou se o seguinte falha: são os documentos do motorista de
        // qualquer maneira, e um que ficasse de fora era um órfão no bucket.
        setDocPaths((p) => [...p, env.path!]);
      }
      setStatusDocs("A ler com a IA…");
      const r = await lerDocumentoIA(paths);
      if (!r.ok || !r.dados) {
        setStatusDocs("Ficheiros guardados para a ficha; a leitura automática falhou.");
        setErro(r.semIA ? "A leitura por IA não está configurada." : r.error ?? "Não consegui ler.");
        return;
      }
      const dados = r.dados;
      // Frente e verso podem vir em rondas diferentes: a segunda leitura
      // COMPLETA a primeira, não a substitui.
      setKyc((antes) => {
        const junto = { ...(antes ?? {}) } as CamposDocumento;
        for (const [k, v] of Object.entries(dados)) {
          if (v) (junto as unknown as Record<string, unknown>)[k] = v;
        }
        return junto;
      });
      // Só preenche o que estiver vazio: nunca apaga o que já foi escrito à mão
      // — incluindo o que foi escrito ENQUANTO a IA lia.
      if (dados.nome) setNome((atual) => (atual.trim() ? atual : dados.nome!));
      const lidos = Object.values(dados).filter(Boolean).length;
      setStatusDocs(`✓ ${lidos} campo(s) lidos — o resto entra na ficha ao criar.`);
    } catch (e) {
      setStatusDocs(null);
      setErro(e instanceof Error ? e.message : "Falha ao ler os documentos.");
    } finally {
      setALerDocs(false);
    }
  };

  /** O que a IA leu, nas colunas da ficha (a nacionalidade chama-se `pais_iso`). */
  const kycParaFicha = (k: CamposDocumento): MotoristaEditavel => {
    const u: MotoristaEditavel = {};
    if (k.nif) u.nif = k.nif;
    if (k.doc_id_tipo) u.doc_id_tipo = k.doc_id_tipo as DocIdTipo;
    if (k.doc_id_numero) u.doc_id_numero = k.doc_id_numero;
    if (k.doc_id_validade) u.doc_id_validade = k.doc_id_validade;
    if (k.data_nascimento) u.data_nascimento = k.data_nascimento;
    if (k.nacionalidade_iso2) u.pais_iso = k.nacionalidade_iso2;
    if (k.carta_numero) u.carta_numero = k.carta_numero;
    if (k.carta_categoria) u.carta_categoria = k.carta_categoria;
    if (k.carta_pais) u.carta_pais = k.carta_pais;
    if (k.carta_validade) u.carta_validade = k.carta_validade;
    if (k.morada_linha1) u.morada_linha1 = k.morada_linha1;
    if (k.codigo_postal) u.codigo_postal = k.codigo_postal;
    if (k.localidade) u.localidade = k.localidade;
    return u;
  };

  /**
   * Leva à ficha `id` o que a IA leu e os ficheiros carregados. Os ficheiros
   * JUNTAM-SE aos que a ficha já tem (no servidor) — nunca se manda a lista
   * inteira a partir de uma cópia que pode estar velha.
   */
  const aplicarLido = async (
    id: string,
    extra: MotoristaEditavel = {},
  ): Promise<{ success: true } | { success: false; error: string }> => {
    const updates: MotoristaEditavel = { ...(kyc ? kycParaFicha(kyc) : {}), ...extra };
    const erros: string[] = [];
    if (Object.keys(updates).length) {
      const u = await atualizarMotorista(id, updates);
      if (!u.success) erros.push(u.error ?? "Não consegui gravar os dados lidos.");
    }
    // Os ficheiros entram MESMO que um campo lido seja rejeitado (uma data mal
    // lida não é motivo para a ficha ficar sem o cartão que a entrega exige).
    if (docPaths.length) {
      const a = await anexarDocumentosMotorista(id, docPaths);
      if (a.success) anexadosRef.current = true;
      else erros.push(a.error ?? "Não consegui guardar os ficheiros na ficha.");
    }
    return erros.length ? { success: false, error: erros.join(" ") } : { success: true };
  };

  const preencher = async () => {
    setErro(null);
    if (!nome.trim() || !telefone.trim()) return setErro("Nome e telefone são obrigatórios.");
    setAGravar(true);
    setExistente(null);
    const r = await criarMotorista({ nome, telefone, email: email || undefined });
    if (r.success && r.id) {
      // A ficha nasce; agora leva o KYC que a IA leu dos documentos.
      const u = await aplicarLido(r.id);
      setAGravar(false);
      if (!u.success) {
        // A ficha existe; o que falhou foi o KYC. Diz-se em vez de se
        // avançar como se estivesse tudo gravado.
        return setErro(`${u.error} O motorista ficou criado — completa a ficha em Motoristas.`);
      }
      return avancar(r.id, nome.trim());
    }
    if (r.jaExistiaId) {
      // Já existe pelo telefone. Mostra-se DE QUEM é a ficha e espera-se pela
      // confirmação: só então o que se leu entra nela.
      const p = await procurarMotoristaPorTelefone(telefone);
      setAGravar(false);
      if (p.motorista) {
        setExistente({ id: p.motorista.id, nome: p.motorista.nome, email: p.motorista.email ?? null });
        return;
      }
      return setErro(p.error ?? "Já existe um motorista com este telefone, mas não o consegui abrir — procura-o em Motoristas.");
    }
    setAGravar(false);
    setErro(r.error ?? "Erro ao criar o motorista.");
  };

  /** Segundo clique: é mesmo a mesma pessoa — a ficha dela recebe o que se leu. */
  const usarExistente = async () => {
    if (!existente) return;
    setErro(null);
    setAGravar(true);
    // A ficha pode ser um lead sem nome real: o nome escrito aqui corrige-o,
    // senão a jornada inteira ficava a dizer "Motorista (por confirmar)".
    const extra: MotoristaEditavel = {};
    if (ehNomePlaceholder(existente.nome) && nome.trim()) extra.nome = nome.trim();
    if (!existente.email && email.trim()) extra.email = email.trim();
    const u = await aplicarLido(existente.id, extra);
    setAGravar(false);
    if (!u.success) return setErro(`${u.error} O motorista já existia — completa a ficha em Motoristas.`);
    await avancar(existente.id, extra.nome ?? existente.nome);
  };

  const enviarLink = async () => {
    setErro(null);
    if (!telefone.trim()) return setErro("Telefone é obrigatório para enviar o link.");
    setAGravar(true);
    const r = await criarSessaoRegisto({ nome: nome || null, telefone, idioma });
    if (r.success) {
      setLink(r.link ?? null);
      setWhatsapp(r.whatsapp ?? null);
      setMotoristaDoLink(r.motorista_id ?? null);
      // Documentos lidos antes de mudar para "Enviar link" são deste motorista.
      if (r.motorista_id && (docPaths.length || kyc)) {
        const u = await aplicarLido(r.motorista_id);
        if (!u.success) setErro(`${u.error} O link ficou criado na mesma.`);
      }
    } else setErro(r.error ?? "Erro ao criar o link.");
    setAGravar(false);
  };

  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
        {(
          [
            ["existente", "Já existe"],
            ["preencher", "Preencher já"],
            ["link", "Enviar link"],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            onClick={() => { setModo(v); setErro(null); setExistente(null); }}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              modo === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {modo === "existente" && (
        <div className="space-y-3">
          <label className={etiqueta}>
            <span>Motorista</span>
            <select className={campo} value={selId} onChange={(e) => setSelId(e.target.value)}>
              <option value="">Escolhe…</option>
              {motoristas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}{m.telefone ? ` · ${m.telefone}` : ""}
                </option>
              ))}
            </select>
          </label>
          {docPaths.length > 0 && (
            <p className="text-xs text-slate-500">
              {docPaths.length} ficheiro(s) lidos há pouco ficam na ficha do motorista que escolheres.
            </p>
          )}
          <Botao tamanho="lg" onClick={escolherExistente} disabled={aGravar || aLerDocs}>
            {aGravar ? "A gravar…" : "Avançar →"}
          </Botao>
        </div>
      )}

      {modo === "preencher" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={etiqueta}><span>Nome</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <label className={etiqueta}><span>Telefone</span><input className={campo} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+351…" /></label>
            <label className={etiqueta}><span>Email (opcional)</span><input className={campo} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          {/* Quem já tem os documentos não devia ser mandado para outro ecrã. */}
          <div className="rounded-2xl border border-dashed border-slate-300 p-4">
            <p className="text-sm font-medium text-slate-700">
              Já tens os documentos? Carrega-os e a IA preenche a ficha.
            </p>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              disabled={aLerDocs}
              onChange={(e) => lerDocs(e.target.files)}
              className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:rounded-2xl file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
            />
            <p className="mt-2 text-xs text-slate-500">
              {statusDocs ??
                "Identificação (frente e verso) e carta de condução. Podes escolher vários de uma vez."}
            </p>
            {kyc && (
              <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
                {kyc.nif && <li>NIF {kyc.nif}</li>}
                {kyc.doc_id_numero && <li>Documento {kyc.doc_id_numero}</li>}
                {kyc.carta_numero && <li>Carta {kyc.carta_numero}</li>}
                {kyc.data_nascimento && <li>Nascimento {kyc.data_nascimento}</li>}
                {kyc.nacionalidade_iso2 && <li>Nacionalidade {kyc.nacionalidade_iso2}</li>}
                {kyc.morada_linha1 && <li>{kyc.morada_linha1}</li>}
              </ul>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Sem documentos agora, o KYC recolhe-se no passo 3 (entrega) — o motorista preenche-o
            no telemóvel.
          </p>
          {existente ? (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                Já existe um motorista com este telefone: <strong>{existente.nome}</strong>. É a mesma pessoa?
              </p>
              <div className="flex flex-wrap gap-2">
                <Botao onClick={usarExistente} disabled={aGravar}>
                  {aGravar ? "A gravar…" : `Sim — usar a ficha de ${existente.nome} e avançar →`}
                </Botao>
                <Botao variante="secondary" onClick={() => setExistente(null)} disabled={aGravar}>
                  Não — corrigir o telefone
                </Botao>
              </div>
            </div>
          ) : (
            <Botao tamanho="lg" onClick={preencher} disabled={aGravar || aLerDocs}>
              {aLerDocs ? "A ler os documentos…" : aGravar ? "A criar…" : "Criar e avançar →"}
            </Botao>
          )}
        </div>
      )}

      {modo === "link" && (
        <div className="space-y-3">
          {!link ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={etiqueta}><span>Nome (opcional)</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
                <label className={etiqueta}><span>Telefone</span><input className={campo} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+351…" /></label>
                <label className={etiqueta}>
                  <span>Língua do formulário</span>
                  <select className={campo} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                    <option value="pt">Português</option>
                    <option value="en">Inglês</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-slate-500">
                Cria o motorista e abre um pré-contrato. O motorista preenche os dados por link; a mota e o preço
                podes atribuí-los já a seguir, ou quando ele acabar.
              </p>
              <Botao tamanho="lg" onClick={enviarLink} disabled={aGravar || aLerDocs}>
                {aGravar ? "A criar…" : "Criar link"}
              </Botao>
            </>
          ) : (
            <div className="space-y-3 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Link criado — envia ao motorista:</p>
              <input readOnly value={link} className={`${campo} bg-white`} onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noreferrer" className={classesBotao("volt", "md")}>
                    Enviar por WhatsApp
                  </a>
                )}
                {/* O pré-contrato já existe: quem já sabe a mota e o preço não
                    precisa de esperar pelo motorista para o finalizar. */}
                {motoristaDoLink && (
                  <Botao
                    onClick={() => avancar(motoristaDoLink, nome.trim() || NOME_PLACEHOLDER)}
                    disabled={aGravar}
                  >
                    Continuar para o contrato →
                  </Botao>
                )}
              </div>
              <p className="text-xs text-emerald-800">
                O pré-contrato ficou em{" "}
                <Link href={hrefJornada.preenchimento} className="font-semibold underline">
                  Contratos → Em preenchimento
                </Link>
                . Podes atribuir a mota e o preço já, ou quando o motorista acabar de preencher.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Passo 2 — Contrato já existe ─────────────────────────────────────────────
/**
 * O motorista com que se entrou já tem um contrato em curso. Criar outro por
 * cima seria o erro mais provável de quem chega da ficha ou de Documentos, por
 * isso o passo 2 mostra o que existe e o passo que lhe falta.
 */
function ContratoJaExiste({
  contrato,
  motoristaNome,
  onVoltar,
  onCriarOutro,
}: {
  contrato: ContratoAberto;
  motoristaNome: string;
  onVoltar: () => void;
  onCriarOutro: () => void;
}) {
  const rascunho = contrato.estado === "rascunho";
  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <div className="rounded-2xl bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">
          {motoristaNome} já tem o contrato {contrato.numero}
          {rascunho ? " — falta a entrega da mota." : ` (${contrato.estado.replace("_", " ")})`}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {rascunho
            ? "Não é preciso criar outro: segue para a entrega."
            : "Se for uma renovação ou uma segunda mota, podes criar outro contrato."}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {rascunho ? (
          <Link href={hrefJornada.entregar(contrato.id)} className={classesBotao("primary", "lg")}>
            Ir para a entrega →
          </Link>
        ) : (
          <Link href={hrefJornada.vistoria(contrato.id)} className={classesBotao("primary", "lg")}>
            Abrir o contrato {contrato.numero} →
          </Link>
        )}
        {/* A lista onde ESTE contrato aparece — "em preenchimento" esconde os ativos. */}
        <Link
          href={rascunho ? hrefJornada.preenchimento : `/admin/contratos?f=${contrato.estado}`}
          className={classesBotao("secondary", "lg")}
        >
          Ver contratos
        </Link>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <button onClick={onCriarOutro} className="font-medium text-slate-600 underline">
          Criar outro contrato mesmo assim
        </button>
        <button onClick={onVoltar} className="font-medium text-slate-600 underline">
          Trocar de motorista
        </button>
      </div>
    </div>
  );
}

// ── Passo 2 — Contrato ───────────────────────────────────────────────────────
function PassoContrato({
  motoristaId,
  motoristaNome,
  motos,
  preContrato,
  onVoltar,
  onPronto,
}: {
  motoristaId: string;
  motoristaNome: string;
  motos: MotoOpt[];
  /** Pré-contrato aberto por "Enviar link" ou por um pedido: finaliza-se, não se duplica. */
  preContrato: ContratoAberto | null;
  onVoltar: () => void;
  onPronto: (id: string, numero: string, finalizado: boolean) => void;
}) {
  const [veiculoId, setVeiculoId] = useState("");
  const [preco, setPreco] = useState("");
  const [caucao, setCaucao] = useState("");
  const [dataInicio, setDataInicio] = useState(new Date().toISOString().slice(0, 10));
  const [periodicidade, setPeriodicidade] = useState("semanal");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  const disponiveis = motos.filter((m) => m.estado_operacional === "disponivel");

  const criar = async () => {
    setErro(null);
    if (!veiculoId) return setErro("Escolhe a mota.");
    if (!preco || Number(preco) <= 0) return setErro("Indica um preço válido.");
    if (!dataInicio) return setErro("Indica a data de início.");
    const mota = motos.find((m) => m.id === veiculoId);
    setAGravar(true);
    const dados = {
      veiculo_id: veiculoId,
      proprietario_id: mota?.proprietario_id ?? null,
      periodicidade: periodicidade as "semanal" | "quinzenal" | "mensal" | "diaria",
      preco_periodo: preco,
      caucao: caucao || null,
      data_inicio: dataInicio,
    };
    if (preContrato) {
      const r = await finalizarPreContrato(preContrato.id, dados);
      setAGravar(false);
      if (r.success) onPronto(preContrato.id, preContrato.numero, true);
      else setErro(r.error ?? "Erro ao finalizar o pré-contrato.");
      return;
    }
    const r = await criarContrato({ ...dados, motorista_id: motoristaId, estado: "rascunho" });
    setAGravar(false);
    if (r.success && r.id) onPronto(r.id, r.numero ?? "", false);
    else setErro(r.error ?? "Erro ao criar o contrato.");
  };

  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-600">
        Contrato para <strong className="text-slate-950">{motoristaNome}</strong>
        {preContrato && <> — finaliza o pré-contrato <strong>{preContrato.numero}</strong></>}.{" "}
        {disponiveis.length === 0 && <span className="text-amber-700">Sem motas disponíveis — verifica a frota.</span>}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={etiqueta}>
          <span>Mota <span className="text-red-600">*</span></span>
          <select className={campo} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
            <option value="">Escolhe a mota…</option>
            {disponiveis.map((m) => (
              <option key={m.id} value={m.id}>{m.matricula ?? "sem matrícula"} · {m.modelo}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>Periodicidade</span>
          <select className={campo} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="mensal">Mensal</option>
            <option value="diaria">Diária</option>
          </select>
        </label>
        <label className={etiqueta}><span>Preço por período (€) <span className="text-red-600">*</span></span><input className={campo} value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="60" /></label>
        <label className={etiqueta}><span>Caução (€)</span><input className={campo} value={caucao} onChange={(e) => setCaucao(e.target.value)} inputMode="decimal" placeholder="0" /></label>
        <label className={etiqueta}>
          <span>Início <span className="text-red-600">*</span></span>
          <input type="date" className={campo} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        O 1.º pagamento é fixado no dia da entrega da mota (passo 3). A caução também é cobrada na entrega.
      </p>
      {erro && (
        <p className="text-sm text-red-700">
          {erro}
          {preContrato && (
            <>
              {" "}
              <Link href={hrefJornada.preenchimento} className="font-semibold underline">
                Ver o contrato {preContrato.numero} na lista
              </Link>
              {" "}— pode já ter sido finalizado noutro ecrã.
            </>
          )}
        </p>
      )}
      <div className="flex gap-3">
        <Botao variante="secondary" tamanho="lg" onClick={onVoltar}>← Voltar</Botao>
        <Botao tamanho="lg" onClick={criar} disabled={aGravar}>
          {aGravar ? (preContrato ? "A finalizar…" : "A criar…") : preContrato ? "Finalizar contrato e avançar →" : "Criar contrato e avançar →"}
        </Botao>
      </div>
    </div>
  );
}

// ── Passo 3 — Entrega ────────────────────────────────────────────────────────
/**
 * O contrato existe; falta a entrega. Há duas vias e a ficha decide qual vem
 * primeiro: se já tem tudo o que a entrega exige, entrega-se já; se falta
 * alguma coisa, o motorista completa-a no telemóvel pelo link — e a entrega
 * presencial fica para quando ele chegar.
 */
function PassoEntrega({
  contratoId,
  contratoNumero,
  finalizado,
  motoristaId,
  motoristaNome,
}: {
  contratoId: string;
  contratoNumero: string;
  /** Veio de um pré-contrato (finalizado agora) ou foi criado de raiz. */
  finalizado: boolean;
  motoristaId: string;
  motoristaNome: string;
}) {
  const [prontidao, setProntidao] = useState<{ pronto: boolean; faltam: string[]; erro?: string } | null>(null);
  const [link, setLink] = useState<{ link: string; whatsapp: string | null } | null>(null);
  const [aCriarLink, setACriarLink] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    prontidaoEntrega(motoristaId).then((r) => {
      if (vivo) setProntidao({ pronto: r.pronto, faltam: r.faltam, erro: r.erro });
    });
    return () => {
      vivo = false;
    };
  }, [motoristaId]);

  const enviarLink = async () => {
    setErro(null);
    setACriarLink(true);
    const r = await criarSessaoEntrega(contratoId);
    setACriarLink(false);
    if (r.success && r.link) setLink({ link: r.link, whatsapp: r.whatsapp ?? null });
    else setErro(r.error ?? "Erro ao criar o link.");
  };

  const pronto = !!prontidao && !prontidao.erro && prontidao.pronto;
  const REQUISITOS = ["NIF", "nº do documento", "ficheiro do documento", "nº da carta", "morada"];

  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <div className="rounded-2xl bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">
          Contrato {contratoNumero} {finalizado ? "finalizado" : "criado"} para {motoristaNome}. Falta a entrega da mota.
        </p>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-950">Para finalizar a entrega, são obrigatórios:</p>
        {prontidao?.erro ? (
          <p className="mt-2 text-sm text-amber-800">
            Não consegui verificar a ficha ({prontidao.erro}). Confirma-a antes da entrega.
          </p>
        ) : prontidao ? (
          <ul className="mt-2 space-y-1 text-sm">
            {REQUISITOS.map((r) => {
              const falta = prontidao.faltam.some((f) => f.startsWith(r));
              return (
                <li key={r} className={falta ? "text-amber-800" : "text-slate-600"}>
                  {falta ? "○" : "✓"} {r}
                  {falta && <span className="text-xs"> — falta</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">A verificar a ficha…</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Ao concluir a entrega, o contrato fica ativo, a mota ocupada e a 1.ª cobrança gerada.
        </p>
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {link ? (
        <div className="space-y-3 rounded-2xl bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">Link criado — envia ao motorista:</p>
          <input readOnly value={link.link} className={`${campo} bg-white`} onFocus={(e) => e.currentTarget.select()} />
          {link.whatsapp && (
            <a href={link.whatsapp} target="_blank" rel="noreferrer" className={classesBotao("volt", "md")}>
              Enviar por WhatsApp
            </a>
          )}
          <p className="text-xs text-emerald-800">
            Quando ele acabar, recebes a notificação “Motorista preparou a entrega” e fazes a entrega
            presencial com tudo já preenchido.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Link
            href={hrefJornada.entregar(contratoId)}
            className={classesBotao(pronto || !prontidao ? "primary" : "secondary", "lg")}
          >
            Ir para a entrega →
          </Link>
          <Botao
            variante={pronto || !prontidao ? "secondary" : "primary"}
            tamanho="lg"
            onClick={enviarLink}
            disabled={aCriarLink}
          >
            {aCriarLink ? "A criar link…" : "Enviar link ao motorista"}
          </Botao>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs">
        {prontidao && !pronto && (
          <Link href={hrefJornada.ficha(motoristaId)} className="font-medium text-slate-600 underline">
            Completar dados na ficha
          </Link>
        )}
        <Link href={hrefJornada.preenchimento} className="font-medium text-slate-600 underline">
          Ver contratos
        </Link>
      </div>
    </div>
  );
}
