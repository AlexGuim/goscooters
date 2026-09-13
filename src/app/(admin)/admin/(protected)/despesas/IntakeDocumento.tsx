"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  DespesaCategoria,
  ImputarA,
  Moto,
  SeguroTipo,
  ManutencaoTipo,
} from "@/types/db";
import type { DocTipo } from "@/lib/gemini";
import { lerComprovativoPagamento, type ComprovativoLido } from "@/actions/pagamentoActions";
import PagamentoDeDocumento from "@/app/(admin)/admin/(protected)/documentos/PagamentoDeDocumento";
import KycDeDocumento, {
  type KycFeito,
  type MotoristaParaKyc,
} from "@/app/(admin)/admin/(protected)/documentos/KycDeDocumento";
import {
  lerDocumentoIA,
  apagarDocumentoPublico,
  apagarDocumentosPrivados,
  moverDocumentoParaPrivado,
} from "@/actions/fotoActions";
import { hrefJornada } from "@/lib/jornada";
import type { CamposDocumento } from "@/lib/gemini";
import { enviarDocumento } from "@/lib/uploads";
import { documentoDoDetalhe, lerRefDocumento, textoFalhaAoCarregar } from "@/lib/documentoDespesa";
import {
  aDescartar,
  aguardarGravacao,
  caminhosDe,
  type Carregado,
  type EstadoDoCarregamento,
  type SaidaDoEcra,
} from "@/lib/limpezaCarregamentos";
import { analisarDocumento, type IntakeResultado } from "@/actions/intakeActions";
import { gravarDespesaDeFatura } from "@/actions/faturaActions";
import { criarSeguro, criarManutencao, garantirManutencaoDeDespesa } from "@/actions/frotaSaudeActions";
import { prepararComunicacao, type ComunicacaoPreparada } from "@/actions/comunicacaoActions";
import { executarProcedimentos } from "@/actions/procedimentoActions";
import type { ProcedimentoGatilho } from "@/types/db";
import { dataBR } from "@/lib/datas";
import { IDIOMAS } from "@/lib/lembretes";

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const TIPO_ROTULO: Record<DocTipo, string> = {
  fatura: "Fatura / despesa",
  apolice_seguro: "Apólice de seguro",
  manutencao: "Manutenção",
  portagem: "Portagem",
  coima: "Coima",
  documento_id: "Documento de identidade (KYC)",
  comprovativo_morada: "Comprovativo de morada (KYC)",
  comprovativo_pagamento: "Comprovativo de pagamento",
  outro: "Outro",
};
const CATEGORIAS: { v: DespesaCategoria; r: string }[] = [
  { v: "manutencao", r: "Manutenção" },
  { v: "portagem", r: "Portagem" },
  { v: "coima", r: "Coima" },
  { v: "seguro", r: "Seguro" },
  { v: "gps", r: "GPS" },
  { v: "outro", r: "Outro" },
];
const IMPUTAR: { v: ImputarA; r: string }[] = [
  { v: "goscooters", r: "GoScooters" },
  { v: "proprietario", r: "Proprietário (ressarce no acerto)" },
  { v: "motorista", r: "Motorista" },
];
const TIPO_SEGURO: { v: SeguroTipo; r: string }[] = [
  { v: "responsabilidade_civil", r: "Responsabilidade civil" },
  { v: "danos_proprios", r: "Danos próprios" },
  { v: "outro", r: "Outro" },
];
const TIPO_MANUT: { v: ManutencaoTipo; r: string }[] = [
  { v: "revisao", r: "Revisão" },
  { v: "oleo", r: "Óleo" },
  { v: "pneu_frente", r: "Pneu (frente)" },
  { v: "pneu_tras", r: "Pneu (trás)" },
  { v: "pneus", r: "Pneus (ambos)" },
  { v: "travoes", r: "Travões" },
  { v: "corrente", r: "Corrente" },
  { v: "inspecao", r: "Inspeção" },
  { v: "outro", r: "Outro" },
];

// Que "destino" (tabela) cada tipo alimenta.
type Destino = "despesa" | "seguro" | "manutencao" | "kyc";
function destinoDe(t: DocTipo): Destino {
  if (t === "apolice_seguro") return "seguro";
  if (t === "manutencao") return "manutencao";
  if (t === "documento_id" || t === "comprovativo_morada") return "kyc";
  return "despesa"; // fatura, portagem, coima, outro
}
const CATEGORIA_DE: Partial<Record<DocTipo, DespesaCategoria>> = {
  portagem: "portagem",
  coima: "coima",
  fatura: "outro",
  outro: "outro",
};

type Fase = "inicio" | "a-processar" | "rever" | "a-gravar" | "comunicar";

/** Um ficheiro já carregado e classificado — o que circula na fila do lote. */
type Analisado = { nome: string; path: string; url: string; res: IntakeResultado };

/**
 * Dos documentos guardados, os que já estão no bucket PRIVADO: as coimas e as
 * portagens, que a leitura tira do público antes da revisão (`infracoes/…`).
 */
const soPrivados = (guardados: (string | null | undefined)[]): string[] =>
  guardados.filter((v): v is string => lerRefDocumento(v)?.onde === "privado");

/** O que a limpeza precisa de um documento do lote: o carregamento e o que a leitura devolveu. */
const carregado = (d: Analisado): Carregado => ({ path: d.path, documento: d.res.documento_url });

/** O estado do ecrã como a limpeza o vê (aDescartar decide o que sai em cada saída). */
const estadoDoEcra = (
  fase: Fase,
  docPath: string | null,
  docUrl: string | null,
  docGravado: boolean,
  fila: Analisado[],
): EstadoDoCarregamento => ({
  fase,
  emRevisao: docPath ? { path: docPath, documento: docUrl } : null,
  emRevisaoGravado: docGravado,
  fila: fila.map(carregado),
  emLeitura: [],
});

/**
 * Tira do storage documentos que não chegaram a ser gravados — do público e, os
 * que a leitura já passou para privado (coimas/portagens), do privado.
 */
const apagarCaminhos = ({ publicos, privados }: { publicos: string[]; privados: string[] }) =>
  Promise.all([
    ...publicos.map((p) => apagarDocumentoPublico(p)),
    ...(privados.length ? [apagarDocumentosPrivados(privados)] : []),
  ]);

/** Documentos de um lote que ficou por rever: saem todos. */
const descartar = (docs: Analisado[]) => apagarCaminhos(caminhosDe(docs.map(carregado)));

export default function IntakeDocumento({
  motos,
  motoristas,
  sempreAberto = false,
}: {
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  /**
   * Presente só no ecrã de Documentos: liga os ramos de KYC e de comprovativos
   * de pagamento. Traz a ficha de cada um para o painel de KYC poder mostrar o
   * que já é conhecido e o que ainda falta.
   */
  motoristas?: MotoristaParaKyc[];
  /** No ecrã de Documentos o painel é a página inteira — não se colapsa. */
  sempreAberto?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(sempreAberto);
  // Fila do lote. Estado normal (e não ref): a fila só muda entre confirmações,
  // e o handler é recriado a cada render — por isso lê sempre o valor certo.
  const [fila, setFila] = useState<Analisado[]>([]);
  const [lote, setLote] = useState<{ total: number; feitos: number }>({ total: 0, feitos: 0 });
  const [fase, setFase] = useState<Fase>("inicio");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  /**
   * O que ficou por fazer DEPOIS de gravar — o original de uma coima/portagem que
   * não saiu do bucket público. Sobrevive ao `reset()`, como o `ok`: é para ler.
   */
  const [avisoGravado, setAvisoGravado] = useState<string | null>(null);
  /** "A ler documento 2 de 4…" — um lote demora, e o silêncio parece bloqueio. */
  const [progresso, setProgresso] = useState<string | null>(null);

  const [res, setRes] = useState<IntakeResultado | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  /** Caminho no bucket do documento em revisão — para o poder apagar. */
  const [docPath, setDocPath] = useState<string | null>(null);
  // Ramo "isto é dinheiro que entrou" — só existe quando a página fornece a
  // lista de motoristas (o ecrã de Documentos); em Despesas fica inativo.
  const [pagamentoLido, setPagamentoLido] = useState<ComprovativoLido | null>(null);
  // Ramo "isto é um documento de identidade" — também só com a lista de motoristas.
  const [kycLido, setKycLido] = useState<CamposDocumento | null>(null);
  /** Que documentos deram origem à leitura — decide que campos são de esperar. */
  const [kycTipos, setKycTipos] = useState<DocTipo[]>([]);
  /** Os mesmos ficheiros, já no bucket privado — vão para a ficha. */
  const [kycPaths, setKycPaths] = useState<string[]>([]);
  /**
   * "N ficheiro(s) não ficaram guardados": mostra-se POR CIMA do painel de
   * KYC, não no `erro` do intake — esse fica escondido atrás do painel e o
   * `reset()` apagava-o antes de alguém o ler.
   */
  const [avisoKyc, setAvisoKyc] = useState<string | null>(null);
  // Quem ficou criado/atualizado neste lote. Sobrevive ao `reset()` de
  // propósito: é o cartão "próximo passo: criar contrato" — o motivo de o
  // gestor ter carregado os documentos. Só um lote novo o substitui.
  const [feitos, setFeitos] = useState<KycFeito[]>([]);
  const [comunicacao, setComunicacao] = useState<ComunicacaoPreparada | null>(null);
  const [textoMsg, setTextoMsg] = useState("");
  const [idiomaMsg, setIdiomaMsg] = useState("en");
  const [aRedigir, setARedigir] = useState(false);

  // Campos editáveis (pré-preenchidos pela IA).
  const [tipo, setTipo] = useState<DocTipo>("fatura");
  const [veiculoId, setVeiculoId] = useState("");
  const [categoria, setCategoria] = useState<DespesaCategoria>("outro");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [imputarA, setImputarA] = useState<ImputarA>("goscooters");
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [motoristaNome, setMotoristaNome] = useState<string | null>(null);
  const [km, setKm] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [referencia, setReferencia] = useState("");
  /** Coima/portagem: onde foi — vai na mensagem ao motorista, por isso é editável. */
  const [local, setLocal] = useState("");
  // Seguro
  const [seguradora, setSeguradora] = useState("");
  const [apolice, setApolice] = useState("");
  const [seguroTipo, setSeguroTipo] = useState<SeguroTipo>("responsabilidade_civil");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [quemPaga, setQuemPaga] = useState<ImputarA>("proprietario");
  // Manutenção
  const [manutTipo, setManutTipo] = useState<ManutencaoTipo>("revisao");
  const [oficina, setOficina] = useState("");
  const [proximaKm, setProximaKm] = useState("");
  const [proximaData, setProximaData] = useState("");

  /**
   * O documento em revisão já é — ou, na dúvida, pode já ser — o documento de uma
   * linha: uma gravação que ficou a meio (a despesa gravou, o seguro falhou) volta
   * à revisão com ele referido. Daí em diante nenhuma saída do ecrã o apaga.
   */
  const [docGravado, setDocGravado] = useState(false);

  // Ficheiros que ainda não são de ninguém: os que esperam na fila, o que está em
  // revisão e os de um lote a meio da leitura. Se o gestor navegar para outro
  // ecrã, saem do storage (aDescartar decide quais) — em vez de ficarem legíveis
  // por URL até alguém correr a auditoria. Ficam o que está "a gravar" (passa a
  // ser referenciado pela linha que está a ser criada) e o que já foi gravado.
  // As coimas/portagens já não estão no público: a leitura passou-as para
  // `privado/infracoes/` — é essa cópia que sai (o servidor recusa apagar um
  // caminho que alguma linha já use). Fechar o separador não desmonta o ecrã: aí
  // não há limpeza garantida.
  const estadoRef = useRef<EstadoDoCarregamento>(estadoDoEcra("inicio", null, null, false, []));
  /**
   * Os do lote que já subiram mas ainda não chegaram à fila nem à revisão. Só
   * existiam numa variável local do `aoEscolher`: um lote de 4 demora minutos, e
   * quem mudasse de ecrã a meio deixava-os no bucket público.
   */
  const emLeituraRef = useRef<Analisado[]>([]);
  /** Falso depois de o ecrã desmontar: um lote a meio pára e deita fora o que ainda subir. */
  const montadoRef = useRef(false);
  useEffect(() => {
    estadoRef.current = estadoDoEcra(fase, docPath, docUrl, docGravado, fila);
  }, [docPath, docUrl, docGravado, fase, fila]);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      const estado = { ...estadoRef.current, emLeitura: emLeituraRef.current.map(carregado) };
      void apagarCaminhos(aDescartar(estado, "sair"));
    };
  }, []);

  /** Tira do storage o que esta saída do ecrã deixa sem dono (aDescartar decide o quê). */
  const descartarAoSair = (saida: SaidaDoEcra) =>
    apagarCaminhos(aDescartar(estadoDoEcra(fase, docPath, docUrl, docGravado, fila), saida));

  const reset = () => {
    setFase("inicio");
    setRes(null);
    setDocUrl(null);
    setDocPath(null);
    setDocGravado(false);
    setErro(null);
    setMotoristaId(null);
    setMotoristaNome(null);
    setComunicacao(null);
    setTextoMsg("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const preencher = (r: IntakeResultado) => {
    const d = r.doc;
    setRes(r);
    setDocUrl(r.documento_url);
    setTipo(d.tipo);
    setVeiculoId(r.veiculo?.id ?? "");
    setCategoria(CATEGORIA_DE[d.tipo] ?? "outro");
    setDescricao(d.descricao ?? "");
    setValor(d.valor ?? "");
    setData(d.data ?? "");
    setDataVencimento(d.data_vencimento ?? "");
    setImputarA(r.imputar_a_sugerido);
    setMotoristaId(r.motorista?.id ?? null);
    setMotoristaNome(r.motorista?.nome ?? null);
    setKm(d.km != null ? String(d.km) : "");
    setFornecedor(d.fornecedor ?? "");
    setReferencia(d.referencia ?? "");
    setLocal(d.local ?? "");
    setSeguradora(d.fornecedor ?? "");
    setApolice(d.seguro_apolice ?? "");
    setDataFim(d.data_fim ?? "");
    setQuemPaga(r.imputar_a_sugerido === "goscooters" ? "goscooters" : "proprietario");
    setManutTipo((d.manutencao_tipo as ManutencaoTipo) ?? "revisao");
    setProximaKm(d.proxima_km != null ? String(d.proxima_km) : "");
    setProximaData(d.proxima_data ?? "");
    setDataInicio("");
    setOficina("");
    setFase("rever");
  };

  /**
   * Carrega e classifica UM ficheiro. Não decide nada — quem chama é que junta
   * o lote e escolhe o que fazer com ele.
   */
  const carregarEClassificar = async (
    ficheiro: File,
  ): Promise<{ ok: true; doc: Analisado } | { ok: false; erro: string }> => {
    const env = await enviarDocumento(ficheiro);
    if (!env.success || !env.path || !env.url) {
      return { ok: false, erro: env.error ?? "Erro ao carregar o ficheiro." };
    }
    // A partir daqui o ficheiro JÁ ESTÁ no bucket público (é de lá que a
    // classificação o lê, e é onde as faturas têm de ficar). Só sabemos o que
    // ele é depois de classificado — até lá pode ser um cartão de cidadão. Por
    // isso qualquer saída que não seja "classificado com sucesso" tem de o
    // apagar, INCLUINDO a excepção: um 504 da Vercel a meio da leitura deixava
    // o documento legível por URL, sem nada na base de dados a apontar para ele.
    // Se nem esta tentativa o tirar, a mensagem diz que ficou — e só nesse caso:
    // uma coima/portagem que o servidor não conseguiu tirar e o ecrã sim não é alarme.
    try {
      const r = await analisarDocumento(env.path, env.url);
      if (!r.success || !r.resultado) {
        const apagado = await apagarDocumentoPublico(env.path);
        return { ok: false, erro: textoFalhaAoCarregar(r.error ?? "Não consegui ler o documento.", apagado.ok) };
      }
      return { ok: true, doc: { nome: ficheiro.name, path: env.path, url: env.url, res: r.resultado } };
    } catch (e) {
      const apagado = await apagarDocumentoPublico(env.path);
      return {
        ok: false,
        erro: textoFalhaAoCarregar(
          e instanceof Error ? e.message : "O servidor não respondeu a tempo a ler o documento.",
          apagado.ok,
        ),
      };
    }
  };

  /**
   * Encaminha UM documento já classificado para o painel certo.
   *
   * Nunca volta a carregar nem a classificar: o lote faz esse trabalho uma só
   * vez, no início. Repeti-lo era pagar duas vezes a mesma leitura e deixar
   * cópias órfãs no bucket.
   */
  const encaminhar = async (a: Analisado, seguintes: Analisado[] = fila) => {
    setDocPath(a.path);
    setDocGravado(false);
    if (a.res.doc.tipo === "comprovativo_pagamento" && motoristas) {
      setFase("a-processar");
      // A análise já o passou para `privado/comprovativos/`: é esse o caminho que
      // se lê e que o pagamento guarda.
      const pg = await lerComprovativoPagamento(a.res.documento_url);
      if (!pg.success || !pg.dados) {
        // Um comprovativo ilegível não pode parar o lote: diz-se qual falhou e
        // segue-se para o próximo. O ficheiro já não está no bucket público — a
        // análise tirou-o de lá antes de tudo; o pagamento regista-se à mão.
        setErro(`${a.nome}: ${pg.error ?? "não consegui ler o comprovativo."}`);
        await seguirLote(seguintes);
        return;
      }
      setPagamentoLido(pg.dados);
      setFase("rever");
      return;
    }
    preencher(a.res);
  };

  /**
   * Avança para o próximo do lote a partir de uma lista EXPLÍCITA — de dentro
   * de um handler async o `fila` do closure pode estar velho (acabou de ser
   * definido no mesmo handler). Sem próximo, volta ao início.
   */
  const seguirLote = async (seguintes: Analisado[]) => {
    setLote((l) => ({ ...l, feitos: l.feitos + 1 }));
    const [proximo, ...resto] = seguintes;
    setFila(resto);
    setRes(null);
    setDocUrl(null);
    setDocPath(null);
    if (proximo) {
      await encaminhar(proximo, resto);
      return;
    }
    setFase("inicio");
    if (inputRef.current) inputRef.current.value = "";
  };

  /**
   * Lê os documentos de identidade do lote NUMA SÓ leitura.
   *
   * É a diferença que interessa: o título de residência dá o nº e a validade, a
   * carta dá a categoria e o nº da carta, o comprovativo dá a morada. Lidos um a
   * um, cada leitura só vê um terço da pessoa e os campos dos outros ficam a
   * null. Lidos juntos, saem de uma vez — que é como o gestor os tem na mão.
   */
  const lerKycEmConjunto = async (docs: Analisado[], seguintes: Analisado[] = fila) => {
    setFase("a-processar");
    setAvisoKyc(null);
    const kyc = await lerDocumentoIA(docs.map((d) => d.path), "motas");
    if (!kyc.ok || !kyc.dados) {
      // Sem leitura não há ficha para os receber: saem do bucket público e
      // não ficam órfãos no privado. O gestor volta a carregá-los — e o resto
      // do lote (as faturas que vieram com eles) segue, em vez de ficar preso.
      const apagados = await Promise.all(docs.map((d) => apagarDocumentoPublico(d.path)));
      const ficaram = apagados.filter((a) => !a.ok).length;
      setErro(
        (kyc.error ??
          (kyc.semIA ? "A leitura por IA não está configurada." : "Não consegui ler os documentos de identidade.")) +
          (ficaram ? ` ATENÇÃO: ${ficaram} ficheiro(s) de identidade ficaram no bucket público — apaga-os no Supabase.` : "") +
          (seguintes.length ? " Sigo para o próximo documento do lote." : " Carrega-os outra vez."),
      );
      await seguirLote(seguintes);
      return;
    }
    // Entraram pelo bucket público (é onde as faturas TÊM de ficar, para o
    // extrato as abrir). Um documento de identidade não pode lá ficar — mas
    // também não se deita fora: a entrega exige o ficheiro na ficha, e seria
    // pedir ao motorista o mesmo cartão duas vezes. Passa para o privado.
    const movidos = await Promise.all(docs.map((d) => moverDocumentoParaPrivado(d.path)));
    const guardados = movidos.flatMap((m) => (m.ok && m.path ? [m.path] : []));
    const publicosQueFicaram = movidos.filter((m) => m.publicoFicou).length;
    setKycPaths(guardados);
    const avisos: string[] = [];
    if (guardados.length < docs.length) {
      avisos.push(
        `${docs.length - guardados.length} ficheiro(s) não ficaram guardados na ficha — os campos lidos aplicam-se na mesma; carrega esses ficheiros outra vez depois.`,
      );
    }
    if (publicosQueFicaram) {
      avisos.push(
        `ATENÇÃO: ${publicosQueFicaram} ficheiro(s) de identidade não saíram do bucket público "motas" — apaga-os no Supabase.`,
      );
    }
    setAvisoKyc(avisos.length ? avisos.join(" ") : null);
    setKycTipos(docs.map((d) => d.res.doc.tipo));
    setKycLido(kyc.dados);
    setFase("rever");
  };

  /**
   * Vários documentos de uma vez.
   *
   * Carrega e classifica TODOS antes de decidir o que fazer com eles, porque a
   * decisão depende do conjunto: um lote de documentos de identidade é UMA
   * pessoa em vários papéis (uma leitura só), enquanto um lote de faturas são N
   * despesas distintas (uma fila, revista uma a uma). Sem classificar primeiro
   * não há como distinguir os dois casos.
   *
   * Cada despesa continua a ser REVISTA e confirmada — é uma fila, não uma
   * importação cega. Um documento mal lido gravado em silêncio seria pior do
   * que carregá-los um a um.
   */
  const aoEscolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const escolhidos = Array.from(e.target.files ?? []);
    if (!escolhidos.length) return;
    // A fila do lote ANTERIOR é substituída já a seguir; se ficasse por
    // limpar, os ficheiros dela ficavam no bucket público sem dono — foi o que
    // aconteceu a quem carregou 4 documentos, teve um erro, e carregou logo 2.
    if (fila.length) void descartar(fila);
    setErro(null);
    setOk(null);
    setAvisoGravado(null);
    setFeitos([]);
    setFase("a-processar");
    setProgresso(escolhidos.length > 1 ? `A ler ${escolhidos.length} documentos…` : null);

    // Até chegarem à fila, à revisão ou ao painel de identidade, os lidos só
    // existem aqui — ficam também no ref, para a limpeza ao sair os ver.
    const lidos: Analisado[] = [];
    emLeituraRef.current = lidos;
    try {
      for (const [i, f] of escolhidos.entries()) {
        if (escolhidos.length > 1) setProgresso(`A ler documento ${i + 1} de ${escolhidos.length}…`);
        const r = await carregarEClassificar(f);
        if (!montadoRef.current) {
          // O gestor saiu do ecrã a meio do lote: os já lidos saíram com a limpeza
          // ao sair, mas este ainda não estava no ref. Sai agora — e não sobe mais nenhum.
          if (r.ok) await descartar([r.doc]);
          return;
        }
        if (!r.ok) {
          // Um ficheiro ilegível não deita fora o lote: se já houver leituras
          // boas, seguimos com elas e dizemos qual falhou.
          if (!lidos.length) {
            setErro(r.erro);
            setProgresso(null);
            setFase("inicio");
            return;
          }
          setErro(`${f.name}: ${r.erro} — segui com os restantes.`);
          continue;
        }
        lidos.push(r.doc);
      }
    } catch (e) {
      // Uma server action que rebenta (rede, timeout) não pode deixar o que
      // já subiu no bucket público — pode ser um documento de identidade.
      await descartar(lidos);
      emLeituraRef.current = [];
      setErro(e instanceof Error ? e.message : "Falha ao carregar os documentos. Tenta outra vez.");
      setProgresso(null);
      setFase("inicio");
      return;
    }
    setProgresso(null);

    // Rede de segurança para os VERSOS. O verso da carta é uma tabela de
    // categorias sem título, sem nome e sem valor — é fácil de classificar como
    // "outro" e seguir para a fila das despesas, levando com ele as categorias,
    // que é justamente o que se foi lá buscar. Um documento sem valor E sem
    // fornecedor não é despesa nenhuma; se veio num lote onde há documentos de
    // identidade, pertence a esse lote.
    const temIdNoLote = lidos.some((d) => destinoDe(d.res.doc.tipo) === "kyc");
    const ehKyc = (d: Analisado) =>
      destinoDe(d.res.doc.tipo) === "kyc" ||
      (temIdNoLote && d.res.doc.tipo === "outro" && !d.res.doc.valor && !d.res.doc.fornecedor);
    const kycs = lidos.filter(ehKyc);
    const resto = lidos.filter((d) => !ehKyc(d));

    try {
      if (kycs.length && motoristas) {
        // Os KYC contam como UM caso no contador do lote; o resto fica em fila.
        setFila(resto);
        setLote({ total: resto.length + 1, feitos: 0 });
        await lerKycEmConjunto(kycs, resto);
        return;
      }

      const [primeiro, ...seguintes] = lidos;
      if (!primeiro) {
        setFase("inicio");
        return;
      }
      setFila(seguintes);
      setLote({ total: lidos.length, feitos: 0 });
      await encaminhar(primeiro, seguintes);
    } catch (e) {
      // Idem: nada de identidade fica no público, e o ecrã não fica preso em
      // "a processar".
      await Promise.all(kycs.map((d) => apagarDocumentoPublico(d.path)));
      setErro(e instanceof Error ? e.message : "Falha ao ler os documentos. Tenta outra vez.");
      setFase("inicio");
    } finally {
      // Daqui em diante estão na fila, na revisão ou no painel de identidade — ou já
      // saíram. Ficarem no ref era apagá-los ao sair do ecrã mesmo depois de gravados.
      emLeituraRef.current = [];
    }
  };

  /**
   * Retira o próximo da fila (ou null se acabou) e conta mais um como feito.
   * NÃO toca em refs nem processa — quem chama é que decide o que fazer, para
   * esta função continuar a poder ser usada de dentro de handlers.
   */
  const seguinteDaFila = (): Analisado | null => {
    setLote((l) => ({ ...l, feitos: l.feitos + 1 }));
    const [proximo, ...resto] = fila;
    if (!proximo) return null;
    setFila(resto);
    return proximo;
  };

  /** Depois de gravar: segue para o documento seguinte, ou fecha o lote. */
  const continuarOuFechar = () => {
    const proximo = seguinteDaFila();
    reset();
    if (proximo) {
      void encaminhar(proximo);
      return;
    }
    // `refresh` em vez de recarregar a página: renova os dados do servidor (as
    // fichas acabadas de atualizar, a lista de despesas) SEM deitar fora a
    // mensagem que diz o que ficou gravado e o que ainda falta.
    router.refresh();
  };

  const destino = destinoDe(tipo);
  const ehPortagemCoima = tipo === "portagem" || tipo === "coima";

  const confirmar = async () => {
    setErro(null);
    // Validações mínimas por destino.
    if (destino !== "kyc" && !data && destino === "despesa") return setErro("Indica a data.");
    if ((destino === "seguro" || destino === "manutencao") && !veiculoId)
      return setErro("Escolhe o veículo.");
    if (destino === "seguro" && !dataFim) return setErro("Indica a validade (fim) da apólice.");

    setFase("a-gravar");
    const localAuto = ehPortagemCoima ? local.trim() || null : null;
    const detalheDoc = {
      ...(res?.doc ?? {}),
      ...(ehPortagemCoima ? { local: localAuto } : {}),
      documento_url: docUrl,
    };
    // O documento como ficou gravado. O servidor põe-no no bucket que a categoria
    // confirmada pede — um aviso lido como coima que afinal é fatura volta ao
    // público, com outro URL —, e o que se grava a seguir (seguro, manutenção,
    // mensagem) tem de usar esse. Vai também para o estado: uma nova tentativa
    // depois de um erro não pode pedir o ficheiro pelo caminho antigo.
    let docFinal = docUrl;
    let msgOk = "";
    // O documento passa a ser de uma linha logo que uma gravação fica feita — e, na
    // dúvida, também quando o pedido rebenta (aguardarGravacao). Daí em diante
    // nenhuma saída do ecrã o apaga; só uma recusa explícita do servidor o deixa
    // sem dono.
    const gravacao = <T extends { success: boolean }>(pedido: Promise<T>) =>
      aguardarGravacao(pedido, () => setDocGravado(true));
    try {
      if (destino === "despesa") {
        const r = await gravacao(gravarDespesaDeFatura({
          veiculo_id: veiculoId || null,
          categoria,
          descricao: descricao || null,
          valor: valor || "0",
          data_despesa: data,
          data_vencimento: dataVencimento || null,
          imputar_a: imputarA,
          proprietario_id: null,
          motorista_id: ehPortagemCoima ? motoristaId : null,
          fornecedor: fornecedor || null,
          referencia_externa: referencia || null,
          km: km ? Number(km) : null,
          documento_url: docUrl,
          detalhe: detalheDoc,
        }));
        if (!r.success) throw new Error(r.error);
        if (r.aviso) setAvisoGravado(r.aviso);
        docFinal = r.documento_url ?? null;
        setDocUrl(docFinal);
        // Despesa de manutenção (mesmo guardada como "despesa") passa a ter registo
        // operacional, para o painel de saúde e os alertas a verem.
        if (categoria === "manutencao" && veiculoId && r.id) {
          await garantirManutencaoDeDespesa(r.id);
        }
        msgOk = `Despesa registada (${TIPO_ROTULO[tipo]}).` + (r.avisoKm ? ` ${r.avisoKm}` : "");
      } else if (destino === "seguro") {
        let despesaId: string | null = null;
        if (valor) {
          const rd = await gravacao(gravarDespesaDeFatura({
            veiculo_id: veiculoId, categoria: "seguro", descricao: descricao || "Prémio de seguro",
            valor, data_despesa: data || dataFim, data_vencimento: dataVencimento || null,
            imputar_a: quemPaga, proprietario_id: null, fornecedor: seguradora || null,
            referencia_externa: apolice || referencia || null, km: null, documento_url: docUrl, detalhe: detalheDoc,
          }));
          if (!rd.success) throw new Error(rd.error);
          despesaId = rd.id ?? null;
          docFinal = rd.documento_url ?? null;
          setDocUrl(docFinal);
        }
        const rs = await gravacao(criarSeguro({
          veiculo_id: veiculoId, data_fim: dataFim, seguradora: seguradora || null, apolice: apolice || null,
          tipo: seguroTipo, data_inicio: dataInicio || null, premio: valor || null, quem_paga: quemPaga,
          despesa_id: despesaId, origem: "ingestao", detalhe: { documento_url: docFinal },
        }));
        if (!rs.success) throw new Error(rs.error);
        docFinal = documentoDoDetalhe(rs.seguro?.detalhe) ?? docFinal;
        setDocUrl(docFinal);
        msgOk = "Apólice de seguro registada" + (despesaId ? " (com despesa do prémio)." : ".");
      } else if (destino === "manutencao") {
        let despesaId: string | null = null;
        if (valor) {
          const rd = await gravacao(gravarDespesaDeFatura({
            veiculo_id: veiculoId, categoria: "manutencao", descricao: descricao || null, valor,
            data_despesa: data || new Date().toISOString().slice(0, 10), data_vencimento: dataVencimento || null, imputar_a: imputarA,
            proprietario_id: null, fornecedor: fornecedor || null, referencia_externa: referencia || null,
            km: km ? Number(km) : null, documento_url: docUrl, detalhe: detalheDoc,
          }));
          if (!rd.success) throw new Error(rd.error);
          despesaId = rd.id ?? null;
          docFinal = rd.documento_url ?? null;
          setDocUrl(docFinal);
        }
        const rm = await gravacao(criarManutencao({
          veiculo_id: veiculoId, tipo: manutTipo, data: data || new Date().toISOString().slice(0, 10),
          km: km ? Number(km) : null, oficina: oficina || null, custo: valor || null,
          proxima_km: proximaKm ? Number(proximaKm) : null, proxima_data: proximaData || null,
          despesa_id: despesaId, origem: "ingestao", detalhe: { documento_url: docFinal },
        }));
        if (!rm.success) throw new Error(rm.error);
        docFinal = documentoDoDetalhe(rm.manutencao?.detalhe) ?? docFinal;
        setDocUrl(docFinal);
        msgOk = "Manutenção registada" + (despesaId ? " (com despesa)." : ".");
      }

      // Motor de procedimentos: corre as regras do evento (coima/portagem/carta
      // verde). Manual → devolve a comunicação para o cartão; auto → já enviou.
      const gatilho: ProcedimentoGatilho | null =
        tipo === "coima" ? "coima_registada" : tipo === "portagem" ? "portagem_registada" : tipo === "apolice_seguro" ? "seguro_registado" : null;
      if (gatilho) {
        const rc = await executarProcedimentos(gatilho, {
          veiculo_id: veiculoId,
          motorista_id: gatilho === "seguro_registado" ? null : motoristaId,
          matricula: motos.find((m) => m.id === veiculoId)?.matricula ?? null,
          valor: valor || null,
          data: data ? dataBR(data) : null,
          local: localAuto,
          documento_url: docFinal,
          categoria: tipo === "coima" ? "coima" : tipo === "portagem" ? "portagem" : "seguro",
        });
        const resultados = rc.resultados ?? [];
        const preparada = resultados.find((r) => r.estado === "preparada" && r.comunicacao);
        const enviadas = resultados.filter((r) => r.estado === "enviada").length;
        if (preparada?.comunicacao) {
          setComunicacao(preparada.comunicacao);
          setTextoMsg(preparada.comunicacao.texto);
          setIdiomaMsg(preparada.comunicacao.idioma_cod);
          setOk(msgOk + (enviadas ? ` · ${enviadas} enviada(s) automaticamente.` : ""));
          setFase("comunicar");
          return;
        }
        setOk(enviadas ? `${msgOk} · ${enviadas} comunicação(ões) enviada(s) automaticamente.` : msgOk);
        continuarOuFechar();
        return;
      }

      setOk(msgOk);
      continuarOuFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gravar.");
      setFase("rever");
    }
  };

  // Re-redige a mensagem no idioma escolhido (antes de enviar).
  const redigir = async (idioma: string) => {
    setIdiomaMsg(idioma);
    setARedigir(true);
    const tipoC = tipo === "coima" ? "coima" : tipo === "portagem" ? "portagem" : "seguro";
    const r = await prepararComunicacao({
      tipo: tipoC,
      veiculo_id: veiculoId,
      motorista_id: tipoC === "seguro" ? null : motoristaId,
      matricula: motos.find((m) => m.id === veiculoId)?.matricula ?? null,
      valor: valor || null,
      data: data ? dataBR(data) : null,
      local: tipoC === "seguro" ? null : local.trim() || null,
      documento_url: docUrl,
      idioma,
    });
    setARedigir(false);
    if (r.success && r.dados) {
      setComunicacao(r.dados);
      setTextoMsg(r.dados.texto);
    }
  };

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Carregar documento (IA)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Carrega qualquer documento (fatura, apólice de seguro, oficina, portagem, coima). A IA lê,
            classifica e pré-preenche — tu confirmas com um clique.
          </p>
        </div>
        {!aberto && (
          <button
            onClick={() => setAberto(true)}
            className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Carregar documento
          </button>
        )}
      </div>

      {ok && <p className="mt-3 text-sm text-emerald-700">{ok}</p>}
      {avisoGravado && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{avisoGravado}</p>
      )}

      {/* O passo seguinte, com o motorista ainda à frente do balcão. Sem isto
          o ecrã acabava numa frase verde e o gestor tinha de ir procurar o nome
          que acabou de criar — o contrato é para onde os documentos iam. */}
      {feitos.map((f) => (
        <div key={f.motoristaId} className="mt-3 space-y-2">
          <Link
            href={hrefJornada.criarContrato(f.motoristaId)}
            className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
          >
            <span>Próximo passo: criar contrato para {f.nome}</span>
            <span aria-hidden>→</span>
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
            {f.pronto ? (
              <span className="text-emerald-700">Ficha pronta para a entrega.</span>
            ) : (
              <span className="text-amber-800">
                Para a entrega ainda falta: {f.faltam.join(", ")} — não impede de criar o contrato.
              </span>
            )}
            <Link href={hrefJornada.ficha(f.motoristaId)} className="font-medium text-slate-600 underline">
              Abrir ficha
            </Link>
          </div>
        </div>
      ))}

      {aberto && pagamentoLido && motoristas && (
        <div className="mt-4">
          <PagamentoDeDocumento
            lido={pagamentoLido}
            motoristas={motoristas}
            onFeito={(msg) => {
              setPagamentoLido(null);
              setOk(msg);
              // Segue o lote: um comprovativo gravado não pode fazer cair os
              // documentos que vinham atrás dele.
              continuarOuFechar();
            }}
            onCancelar={() => {
              // O lote cai: os que esperavam na fila nunca foram referenciados por
              // nada — saem do storage, em vez de ficarem órfãos no público. (O
              // comprovativo já está em privado: a análise tirou-o de lá.)
              void descartarAoSair("descartar_lote");
              setPagamentoLido(null);
              setFila([]);
              setLote({ total: 0, feitos: 0 });
              reset();
            }}
          />
        </div>
      )}

      {aberto && kycLido && motoristas && (
        <div className="mt-4 space-y-3">
          {avisoKyc && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{avisoKyc}</p>}
          <KycDeDocumento
            lido={kycLido}
            motoristas={motoristas}
            tipos={kycTipos}
            docPaths={kycPaths}
            onFeito={(r) => {
              // Um por motorista: o mesmo lote pode completar a mesma ficha
              // duas vezes, e o cartão é da pessoa, não da gravação.
              setFeitos((fs) => [...fs.filter((x) => x.motoristaId !== r.motoristaId), r]);
              setKycLido(null);
              setKycTipos([]);
              setKycPaths([]);
              setAvisoKyc(null);
              setOk(r.msg);
              continuarOuFechar();
            }}
            onCancelar={() => {
              // Ficheiros já no privado sem ficha que os reclame: saem.
              if (kycPaths.length) void apagarDocumentosPrivados(kycPaths);
              // O resto do lote também cai: sem revisão, sai do storage — com o
              // documento que se mandou ler como KYC, se ainda estiver no público.
              void descartarAoSair("descartar_lote");
              setKycLido(null);
              setKycTipos([]);
              setKycPaths([]);
              setAvisoKyc(null);
              setFila([]);
              setLote({ total: 0, feitos: 0 });
              reset();
            }}
          />
        </div>
      )}

      {aberto && !pagamentoLido && !kycLido && (
        <div className="mt-4 space-y-4">
          {lote.total > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-100 px-4 py-2.5">
              <p className="text-sm text-slate-700">
                Documento{" "}
                <strong>{Math.min(lote.feitos + 1, lote.total)} de {lote.total}</strong>
                {lote.feitos > 0 && ` · ${lote.feitos} já gravado(s)`}
              </p>
              {lote.total - lote.feitos - 1 > 0 && (
                <button
                  onClick={() => {
                    // Abandonar o resto do lote sem perder o que já foi gravado.
                    // Os que ficavam por rever — e o que está em revisão, se ainda
                    // não é de nenhuma linha — saem do storage, em vez de ficarem
                    // lá órfãos.
                    void descartarAoSair("descartar_lote");
                    setFila([]);
                    setLote({ total: 0, feitos: 0 });
                    reset();
                  }}
                  // A gravar ou a ler, o que está em curso ainda vai buscar o
                  // seguinte à fila que isto apagava.
                  disabled={fase === "a-gravar" || fase === "a-processar"}
                  className="text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-50"
                >
                  Descartar os restantes
                </button>
              )}
            </div>
          )}
          {(fase === "inicio" || fase === "a-processar") && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center">
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={aoEscolher}
                disabled={fase === "a-processar"}
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-2xl file:border-0 file:bg-emerald-600 file:px-5 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
              />
              <p className="mt-3 text-xs text-slate-500">
                {fase === "a-processar"
                  ? progresso ?? "A IA está a ler o documento…"
                  : "PDF ou foto até ~18 MB. Podes escolher vários de uma vez — os documentos de identidade da mesma pessoa são lidos em conjunto."}
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-red-700">{erro}</p>}

          {(fase === "rever" || fase === "a-gravar") && res && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {TIPO_ROTULO[tipo]}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      res.doc.confianca === "alta"
                        ? "bg-emerald-100 text-emerald-700"
                        : res.doc.confianca === "media"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    confiança {res.doc.confianca}
                  </span>
                </div>
                {/* Resolvido no servidor: numa coima/portagem é um URL assinado (já é privado). */}
                {res.documento_ver && (
                  <a href={res.documento_ver} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-700 underline">
                    ver ficheiro
                  </a>
                )}
              </div>

              {res.aviso && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{res.aviso}</p>}
              {res.duplicado && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                  ⚠ Já existe uma despesa com o mesmo fornecedor, referência e valor — pode ser duplicado.
                </p>
              )}

              {/* Corrigir a classificação, se a IA errou. */}
              <label className={etiqueta}>
                <span>Tipo de documento</span>
                <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as DocTipo)}>
                  {(Object.keys(TIPO_ROTULO) as DocTipo[]).map((t) => (
                    <option key={t} value={t}>{TIPO_ROTULO[t]}</option>
                  ))}
                </select>
              </label>

              {destino === "kyc" ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-600">
                    Isto parece um documento de identidade / comprovativo do motorista — não é
                    uma despesa.
                    {!motoristas && (
                      <>
                        {" "}Para o aplicar a uma ficha, carrega-o em{" "}
                        <Link href="/admin/documentos" className="font-semibold text-emerald-700 underline">
                          Financeiro → Documentos
                        </Link>
                        .
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {/* Lido como coima/portagem, o ficheiro já saiu do público (está em
                        privado/infracoes): não há cópia pública para ler como KYC —
                        apaga-se e carrega-se outra vez. */}
                    {/* Nem um documento já gravado numa linha: passá-lo para kyc/ tirava-o
                        do público e partia o documento dessa despesa. */}
                    {motoristas && res && docPath && !docGravado && !soPrivados([docUrl]).length && (
                      <button
                        className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                        onClick={() => {
                          // O mesmo ficheiro, sem o carregar outra vez: lê-se
                          // como KYC com o tipo que o gestor corrigiu.
                          const doc: Analisado = {
                            nome: docPath.split("/").pop() ?? docPath,
                            path: docPath,
                            url: docUrl ?? "",
                            res: { ...res, doc: { ...res.doc, tipo } },
                          };
                          void lerKycEmConjunto([doc], fila);
                        }}
                        disabled={fase === "a-gravar"}
                      >
                        Ler como documento do motorista →
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        // Um documento de identidade não fica no bucket público
                        // "só porque" veio parar ao ecrã errado. E o lote segue.
                        // (Bloqueia-se durante o apagar: um duplo clique contava
                        // o mesmo documento duas vezes no lote.) Se a leitura o
                        // tinha passado para privado, essa cópia sai também. O que
                        // sai decide-se ANTES de bloquear — e um documento já gravado
                        // numa linha fica.
                        const apagar = descartarAoSair("cancelar");
                        setFase("a-gravar");
                        await apagar;
                        continuarOuFechar();
                      }}
                      disabled={fase === "a-gravar"}
                      className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
                    >
                      {lote.total - lote.feitos - 1 > 0 ? "Apagar e seguir para o próximo" : "Apagar"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={etiqueta}>
                      <span>Veículo{destino !== "despesa" ? " *" : ""}</span>
                      <select className={campo} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                        <option value="">— sem veículo —</option>
                        {motos.map((m) => (
                          <option key={m.id} value={m.id}>{m.matricula ?? "?"} · {m.modelo}</option>
                        ))}
                      </select>
                    </label>
                    <label className={etiqueta}>
                      <span>{destino === "seguro" ? "Prémio (€)" : "Valor (€)"}</span>
                      <input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                    </label>
                    <label className={etiqueta}>
                      <span>Data</span>
                      <input className={campo} type="date" value={data} onChange={(e) => setData(e.target.value)} />
                    </label>
                    <label className={etiqueta}>
                      <span>Fornecedor / entidade</span>
                      <input className={campo} value={fornecedor} onChange={(e) => { setFornecedor(e.target.value); if (destino === "seguro") setSeguradora(e.target.value); }} />
                    </label>
                    {ehPortagemCoima && (
                      <label className={`${etiqueta} sm:col-span-2`}>
                        <span>Local</span>
                        <input
                          className={campo}
                          value={local}
                          onChange={(e) => setLocal(e.target.value)}
                          placeholder="Onde foi a infração / a passagem — vai na mensagem ao motorista"
                        />
                      </label>
                    )}
                  </div>

                  {ehPortagemCoima && (
                    <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                      {motoristaNome ? (
                        <>Motorista com a moto nesta data: <strong>{motoristaNome}</strong> — custo imputado ao motorista.</>
                      ) : (
                        <span className="text-amber-700">Não identifiquei o motorista desta data no histórico. Confere o veículo/data.</span>
                      )}
                    </div>
                  )}

                  {destino === "despesa" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}>
                        <span>Categoria</span>
                        <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value as DespesaCategoria)}>
                          {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.r}</option>)}
                        </select>
                      </label>
                      <label className={etiqueta}>
                        <span>Quem suporta o custo</span>
                        <select className={campo} value={imputarA} onChange={(e) => setImputarA(e.target.value as ImputarA)}>
                          {IMPUTAR.map((i) => <option key={i.v} value={i.v}>{i.r}</option>)}
                        </select>
                      </label>
                      <label className={`${etiqueta} sm:col-span-2`}>
                        <span>Descrição</span>
                        <input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                      </label>
                      <label className={etiqueta}>
                        <span>Vencimento</span>
                        <input className={campo} type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
                      </label>
                      <label className={etiqueta}>
                        <span>KM (atualiza a moto)</span>
                        <input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
                      </label>
                      <label className={`${etiqueta} sm:col-span-2`}>
                        <span>Referência</span>
                        <input className={campo} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                      </label>
                    </div>
                  )}

                  {destino === "seguro" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}><span>Nº apólice</span><input className={campo} value={apolice} onChange={(e) => setApolice(e.target.value)} /></label>
                      <label className={etiqueta}><span>Tipo de seguro</span><select className={campo} value={seguroTipo} onChange={(e) => setSeguroTipo(e.target.value as SeguroTipo)}>{TIPO_SEGURO.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
                      <label className={etiqueta}><span>Início</span><input className={campo} type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
                      <label className={etiqueta}><span>Fim (validade) *</span><input className={campo} type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
                      <label className={etiqueta}><span>Quem paga</span><select className={campo} value={quemPaga} onChange={(e) => setQuemPaga(e.target.value as ImputarA)}>{IMPUTAR.map((i) => <option key={i.v} value={i.v}>{i.r}</option>)}</select></label>
                    </div>
                  )}

                  {destino === "manutencao" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}><span>Tipo</span><select className={campo} value={manutTipo} onChange={(e) => setManutTipo(e.target.value as ManutencaoTipo)}>{TIPO_MANUT.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
                      <label className={etiqueta}><span>Oficina</span><input className={campo} value={oficina} onChange={(e) => setOficina(e.target.value)} /></label>
                      <label className={etiqueta}><span>KM na intervenção</span><input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></label>
                      <label className={etiqueta}><span>Próxima em km</span><input className={campo} inputMode="numeric" value={proximaKm} onChange={(e) => setProximaKm(e.target.value)} /></label>
                      <label className={etiqueta}><span>Próxima data</span><input className={campo} type="date" value={proximaData} onChange={(e) => setProximaData(e.target.value)} /></label>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={confirmar} disabled={fase === "a-gravar"} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                      {fase === "a-gravar" ? "A gravar…" : "Confirmar e registar"}
                    </button>
                    <button
                      onClick={() => {
                        // O documento em revisão sai do storage antes de o reset()
                        // esquecer o caminho — era o único sítio onde ele estava.
                        void descartarAoSair("cancelar");
                        reset();
                      }}
                      // A gravar, o documento está a entrar numa linha: não se apaga.
                      disabled={fase === "a-gravar"}
                      className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {fase === "comunicar" && comunicacao && (() => {
            const digits = comunicacao.motorista.telefone_e164?.replace(/\D/g, "") ?? "";
            const waLink = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(textoMsg)}` : null;
            return (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">Avisar o motorista</p>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <span>Idioma:</span>
                    <select
                      className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-emerald-500"
                      value={idiomaMsg}
                      onChange={(e) => redigir(e.target.value)}
                      disabled={aRedigir}
                    >
                      {IDIOMAS.map((i) => (
                        <option key={i.valor} value={i.valor}>{i.rotulo}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-slate-600">
                  Mensagem para <strong>{comunicacao.motorista.nome}</strong>
                  {comunicacao.fallback ? " · template" : " · redigida pela IA"}. Revê e envia.
                </p>
                <textarea className={`${campo} h-32`} value={aRedigir ? "A redigir…" : textoMsg} onChange={(e) => setTextoMsg(e.target.value)} disabled={aRedigir} />
                <div className="flex flex-wrap gap-3">
                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Abrir WhatsApp
                    </a>
                  )}
                  <button
                    onClick={() => {
                      continuarOuFechar();
                    }}
                    className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
