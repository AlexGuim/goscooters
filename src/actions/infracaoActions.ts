"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { BUCKET_PRIVADO } from "@/lib/documentoDespesa";
import { urlsDocumentosParaAdmin } from "@/lib/documentoDespesaServidor";
import { hojeEmLisboa } from "@/lib/diasUteis";
import { enviarEmailExterno } from "@/lib/email";
import { CAMPOS_PREENCHIDOS_F306, camposDoF306, F306LetrasError, preencherF306 } from "@/lib/f306";
import { geminiConfigurado } from "@/lib/gemini";
import {
  atualizarInfracao,
  autoDaCoima,
  caminhoUsadoPorOutra,
  carregarContexto,
  comCondutorConfirmado,
  dadosF306,
  ehCaminhoDoF306,
  ehDataISO,
  erroDataNotificacao,
  f306Desatualizado,
  faltamNasFichas,
  fechada,
  gravarInfracao,
  lerAutoComIA,
  MENSAGEM_F306_DESATUALIZADO,
  mensagemAlternativa,
  mensagemFechada,
  nomeDoArguido,
  normalizarAuto,
  PASTA_F306,
  prazoDe,
  regimeDaCoima,
  removerFicheirosF306,
  removerSeSemUso,
  temAssinaturaDigital,
  temDocumento,
  type ContextoInfracao,
  type OrigemCondutor,
} from "@/lib/infracaoServidor";
import { criarMotorista } from "@/actions/motoristaActions";
import type { DocIdTipo } from "@/types/db";
import type {
  FaltaF306,
  Infracao,
  InfracaoEnvioCanal,
  InfracaoRegime,
  InfracaoSignatario,
} from "@/types/infracao";

/**
 * Identificação do condutor de uma coima — o F306 da ANSR (Código da Estrada,
 * art. 171.º), a partir da despesa da coima:
 *  1. o arguido é o titular da mota; o condutor, quem a tinha na data — pela
 *     coima, pelo contrato ou pelas cobranças —, ou quem o gestor escolher ou
 *     registar; quando as pistas discordam, o gestor confirma quem era;
 *  2. o n.º do auto e a data da notificação vêm da coima ou do documento (IA);
 *  3. o F306 sai preenchido para `privado/infracoes/f306/`;
 *  4. o titular assina-o — com assinatura qualificada (Autenticação.gov), e
 *     carrega-se aqui o PDF, ou à mão, e segue o original por correio;
 *  5. segue por email para a ANSR, ou regista-se o envio feito por outro canal.
 * Um auto de outra entidade (EMEL, câmara) não usa o F306 da ANSR: só se regista
 * o envio feito no canal dessa entidade.
 *
 * Os dados pessoais leem-se SEMPRE no servidor: do cliente só vêm ids, o n.º do
 * auto, as datas e as escolhas do gestor.
 */

const EMAIL_ANSR = "mail@ansr.pt";
const SIGNATARIOS: readonly string[] = ["arguido", "mandatario", "representante_legal"];
const TIPOS_DOCUMENTO: readonly string[] = ["cc", "passaporte", "titulo_residencia", "aima"];
const DESTINO_DO_CANAL: Record<InfracaoEnvioCanal, string> = {
  email: EMAIL_ANSR,
  portal: "Portal das Contraordenações",
  correio_registado: "ANSR, Av. de Casal de Cabanas, n.º 1, 2734-507 Barcarena",
  presencial: "PSP ou GNR",
};
/** O F306 gerado (e o assinado) deixa de servir: identifica outro auto, outro condutor ou outra entidade. */
const SEM_F306 = { estado: "por_identificar", f306_path: null, f306_gerado_em: null, f306_assinado_path: null } as const;

/** As coimas aparecem em Coimas e em Despesas. */
function revalidarCoimas() {
  revalidatePath("/admin/coimas");
  revalidatePath("/admin/despesas");
}

/** O que o modal mostra: nomes e o que falta nas fichas, nunca os números dos documentos. */
export interface IdentificacaoCondutor {
  despesa_id: string;
  matricula: string | null;
  /** A data que conta: a da infração; sem ela, a do auto. */
  data_infracao: string;
  /** A data da infração gravada na coima (null quando se usa a do auto). */
  data_infracao_registada: string | null;
  data_do_auto: string;
  descricao: string | null;
  /** A coima tem o documento carregado (dá para o ler com a IA). */
  tem_documento: boolean;
  /** Quem instrui o processo: a ANSR (F306) ou outra entidade (EMEL, câmara…). */
  regime: InfracaoRegime;
  entidade: string;
  /** O F306 gerado já não tem o condutor ou o titular de agora. */
  f306_desatualizado: boolean;
  arguido: {
    id: string;
    /** O titular no registo das motas. */
    nome: string;
    /** O nome do proprietário na plataforma, quando é outro (ex.: GoScooters). */
    parceiro: string | null;
    coletiva: boolean;
    nif: string | null;
  } | null;
  condutor: {
    id: string;
    nome: string;
    nif: string | null;
    contrato_numero: string | null;
    origem: OrigemCondutor;
  } | null;
  /** Outro motorista que a data aponta: o gestor confirma quem conduzia antes do F306. */
  alternativa: {
    id: string;
    nome: string;
    origem: OrigemCondutor;
    contrato_numero: string | null;
  } | null;
  /** O condutor da coima não tem contrato nem cobranças na data: o gestor confirma-o antes do F306. */
  condutor_por_confirmar: boolean;
  faltam: FaltaF306[];
  infracao: Infracao | null;
  /** URLs assinados (1 h) dos ficheiros em privado. */
  links: { f306: string | null; assinado: string | null; comprovativo: string | null };
}

export interface AutoLido {
  numero: string | null;
  dataNotificacao: string | null;
}

export type RespostaIdentificacao =
  | { ok: true; dados: IdentificacaoCondutor; aviso?: string; lido?: AutoLido }
  /** `dados`, quando vem, é o estado de agora — o que levou à recusa (outro condutor, uma falta). */
  | { ok: false; error: string; dados?: IdentificacaoCondutor };

export interface DadosDoAutoInput {
  numero_auto: string;
  data_notificacao: string;
  signatario: InfracaoSignatario;
  /** Quando o gestor a indica ou corrige: o condutor procura-se por ela. */
  data_infracao?: string | null;
}

export interface EnvioManualInput {
  canal: InfracaoEnvioCanal;
  data: string;
  referencia?: string | null;
  comprovativo_path?: string | null;
}

export interface NovoCondutorInput {
  nome: string;
  telefone: string;
  nif?: string | null;
  pais_iso?: string | null;
  doc_id_tipo?: DocIdTipo | null;
  doc_id_numero?: string | null;
  doc_id_emissao?: string | null;
  doc_id_validade?: string | null;
  doc_id_emissor?: string | null;
  carta_numero?: string | null;
  carta_pais?: string | null;
  morada_linha1?: string | null;
  codigo_postal?: string | null;
  localidade?: string | null;
}

/**
 * Abre a identificação. O n.º do auto e a data da notificação preenchem-se
 * sozinhos: com o que a coima já traz e, faltando algum, lendo o documento com
 * a IA — uma vez só (a leitura fica marcada em `auto_lido_em`).
 */
export async function abrirIdentificacao(despesaId: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  const i = c.infracao;
  if (fechada(i)) return responder(c);

  const conhecido = autoDaCoima(c);
  let numero = i?.numero_auto ?? conhecido.numero;
  let data = i?.data_notificacao ?? conhecido.dataNotificacao;
  let tentou = false;
  let leu = false;
  if ((!numero || !data) && !i?.auto_lido_em && temDocumento(c) && geminiConfigurado()) {
    tentou = true;
    const lido = await lerAutoComIA(c);
    if (lido) {
      leu = true;
      numero ??= lido.numero;
      data ??= lido.dataNotificacao;
    }
  }

  if (!i || leu || numero !== i.numero_auto || data !== i.data_notificacao) {
    const g = await gravarInfracao(c, {
      numero_auto: numero,
      data_notificacao: data,
      prazo_identificacao: data ? prazoDe(data) : null,
      ...(leu ? { auto_lido_em: new Date().toISOString() } : {}),
    });
    if (!g.ok) return g;
    c.infracao = g.infracao;
    revalidarCoimas();
  }

  const faltaLer = [!numero && "o n.º do auto", !data && "a data da notificação"].filter(
    (x): x is string => Boolean(x),
  );
  const aviso = !tentou
    ? undefined
    : !leu
      ? "Não consegui ler o documento agora — preenche à mão ou carrega em «Ler do documento»."
      : faltaLer.length
        ? `Li o documento, mas não encontrei ${faltaLer.join(" nem ")} — preenche à mão.`
        : "Li do documento o n.º do auto e a data da notificação — confirma-os antes de gerar o F306.";
  return responder(c, aviso);
}

/** Volta a ler o documento com a IA. Devolve o que leu para o formulário; só grava ao «Guardar». */
export async function lerAutoDoDocumento(despesaId: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  if (!temDocumento(c)) return { ok: false, error: "Esta coima não tem o documento carregado." };
  if (!geminiConfigurado()) return { ok: false, error: "A leitura por IA (Gemini) não está configurada neste ambiente." };
  const lido = await lerAutoComIA(c);
  if (!lido) return { ok: false, error: "Não consegui ler o documento — tenta outra vez ou preenche à mão." };
  if (c.infracao && !fechada(c.infracao)) {
    const a = await atualizarInfracao(c.infracao, { auto_lido_em: new Date().toISOString() });
    if (a.ok) c.infracao = a.infracao;
  }
  const resposta = await responder(
    c,
    !lido.numero && !lido.dataNotificacao
      ? "Não encontrei no documento o n.º do auto nem a data da notificação."
      : "Preenchi com o que li do documento — confirma e carrega em «Guardar».",
  );
  return resposta.ok ? { ...resposta, lido } : resposta;
}

/**
 * O condutor é outro — ou não havia, ou as pistas discordavam: associa à coima um
 * motorista já registado, confirmado pelo gestor para a data da infração.
 */
export async function definirCondutor(despesaId: string, motoristaId: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!motoristaId) return { ok: false, error: "Escolhe o motorista." };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  if (fechada(r.c.infracao)) return { ok: false, error: mensagemFechada(r.c.infracao) };
  const anterior = r.c.condutor?.id ?? null;
  // Já é este, na coima, e nada o põe em dúvida: nada a fazer.
  if (anterior === motoristaId && r.c.origemCondutor === "coima" && !r.c.alternativa && !r.c.condutorSemApoio) {
    return responder(r.c);
  }

  const { data: m, error: erroM } = await supabaseAdmin.from("motorista").select("id").eq("id", motoristaId).maybeSingle();
  if (erroM || !m) return { ok: false, error: "Motorista não encontrado." };
  const { error: erroD } = await supabaseAdmin
    .from("despesa")
    .update({ motorista_id: motoristaId, detalhe: comCondutorConfirmado(r.c, motoristaId) })
    .eq("id", r.c.despesa.id);
  if (erroD) {
    console.error("definirCondutor:", erroD.message);
    return { ok: false, error: "Não consegui associar o condutor à coima." };
  }

  const novo = await carregarContexto(despesaId);
  if (!novo.ok) return novo;
  const c = novo.c;
  const antes = c.infracao;
  const trocouF306 = Boolean(antes?.f306_path) && antes?.motorista_id !== motoristaId;
  let processoAtualizado = true;
  if (antes) {
    const a = await atualizarInfracao(antes, {
      motorista_id: motoristaId,
      contrato_id: c.contratoId,
      ...(trocouF306 ? SEM_F306 : {}),
    });
    if (a.ok) {
      c.infracao = a.infracao;
      if (trocouF306) await removerFicheirosF306([antes.f306_path, antes.f306_assinado_path]);
    } else {
      processoAtualizado = false;
    }
  }
  revalidarCoimas();
  const trocou = anterior !== motoristaId;
  const avisos = [
    trocouF306 && processoAtualizado && "O F306 identificava outro condutor: gera-o e assina-o outra vez.",
    !processoAtualizado && "O condutor ficou na coima, mas não consegui atualizar o processo: gera o F306 outra vez.",
    trocou &&
      anterior &&
      c.despesa.cobranca_id &&
      "A dívida desta coima foi gerada para o motorista anterior — acerta-a em Cobranças.",
    trocou &&
      !c.despesa.cobranca_id &&
      c.despesa.imputar_a === "motorista" &&
      "A dívida desta coima ao motorista não foi gerada — se for para lhe cobrar, cria-a em Cobranças.",
  ].filter((x): x is string => Boolean(x));
  return responder(c, avisos.join(" ") || undefined);
}

/** O condutor não está registado: cria-o em Motoristas e associa-o à coima. */
export async function registarCondutor(despesaId: string, input: NovoCondutorInput): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  if (fechada(r.c.infracao)) return { ok: false, error: mensagemFechada(r.c.infracao) };

  const texto = (v: string | null | undefined) => String(v ?? "").trim() || null;
  const data = (v: string | null | undefined) => {
    const t = texto(v);
    return t && ehDataISO(t) ? t : null;
  };
  const criado = await criarMotorista({
    nome: String(input?.nome ?? ""),
    telefone: String(input?.telefone ?? ""),
    nif: texto(input.nif),
    pais_iso: texto(input.pais_iso)?.toUpperCase() ?? null,
    doc_id_tipo: input.doc_id_tipo && TIPOS_DOCUMENTO.includes(input.doc_id_tipo) ? input.doc_id_tipo : null,
    doc_id_numero: texto(input.doc_id_numero),
    doc_id_emissao: data(input.doc_id_emissao),
    doc_id_validade: data(input.doc_id_validade),
    doc_id_emissor: texto(input.doc_id_emissor),
    carta_numero: texto(input.carta_numero),
    carta_pais: texto(input.carta_pais)?.toUpperCase() ?? null,
    morada_linha1: texto(input.morada_linha1),
    codigo_postal: texto(input.codigo_postal),
    localidade: texto(input.localidade),
    notas: `Registado como condutor de uma coima${r.c.matricula ? ` (${r.c.matricula})` : ""}.`,
  });
  if (!criado.success || !criado.id) {
    if (criado.jaExistiaId) {
      const { data: m } = await supabaseAdmin.from("motorista").select("nome").eq("id", criado.jaExistiaId).maybeSingle();
      return {
        ok: false,
        error: `Já existe um motorista com este telefone${m?.nome ? ` (${m.nome})` : ""} — escolhe-o na lista.`,
      };
    }
    return { ok: false, error: criado.error ?? "Não consegui registar o condutor." };
  }
  return definirCondutor(despesaId, criado.id);
}

/** Quem instrui o processo: a ANSR (F306) ou outra entidade, com o formulário e o canal dela. */
export async function definirEntidade(
  despesaId: string,
  input: { regime: InfracaoRegime; entidade?: string | null },
): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const regime = input?.regime;
  if (regime !== "ansr" && regime !== "outro") return { ok: false, error: "Escolhe quem instrui o processo." };
  const entidade = regime === "ansr" ? "ANSR" : String(input.entidade ?? "").trim().slice(0, 120);
  if (!entidade) return { ok: false, error: "Indica a entidade (ex.: EMEL, Câmara Municipal de …)." };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  if (fechada(c.infracao)) return { ok: false, error: mensagemFechada(c.infracao) };

  const antes = c.infracao;
  const invalidar = regimeDaCoima(c).regime !== regime && Boolean(antes?.f306_path);
  const g = await gravarInfracao(c, { regime, entidade, ...(invalidar ? SEM_F306 : {}) });
  if (!g.ok) return g;
  if (invalidar) await removerFicheirosF306([antes?.f306_path, antes?.f306_assinado_path]);
  c.infracao = g.infracao;
  revalidarCoimas();
  return responder(c, invalidar ? "Mudou quem instrui o processo: o F306 gerado deixou de servir." : undefined);
}

/** Grava o n.º do auto, as datas (e o prazo) sem gerar o F306. */
export async function guardarDadosDoAuto(despesaId: string, input: DadosDoAutoInput): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  if (fechada(r.c.infracao)) return { ok: false, error: mensagemFechada(r.c.infracao) };
  const v = validarAuto(input, r.c);
  if (!v.ok) return v;
  const d = await comDataInfracao(r.c, v.dataInfracao);
  if (!d.ok) return d;
  const c = d.c;

  const antes = c.infracao;
  const invalidar = Boolean(antes?.f306_path) && (antes?.numero_auto !== v.numero || d.mudou);
  const g = await gravarInfracao(c, {
    numero_auto: v.numero,
    data_notificacao: v.data,
    prazo_identificacao: prazoDe(v.data),
    signatario: v.signatario,
    ...(invalidar ? SEM_F306 : {}),
  });
  if (!g.ok) return recusarComDados(c, g.error);
  if (invalidar) await removerFicheirosF306([antes?.f306_path, antes?.f306_assinado_path]);
  c.infracao = g.infracao;
  revalidarCoimas();
  const conflito = mensagemAlternativa(c);
  const avisos = [
    invalidar && "O F306 já não corresponde ao que ficou gravado: gera-o e assina-o outra vez.",
    conflito ?? (d.mudou && "A data da infração mudou: confirma que o condutor é o certo."),
  ].filter((x): x is string => Boolean(x));
  return responder(c, avisos.join(" ") || undefined);
}

export async function gerarF306(despesaId: string, input: DadosDoAutoInput): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  if (fechada(r.c.infracao)) return { ok: false, error: mensagemFechada(r.c.infracao) };
  const entidade = regimeDaCoima(r.c);
  if (entidade.regime !== "ansr") return { ok: false, error: mensagemOutraEntidade(entidade.entidade) };
  const v = validarAuto(input, r.c);
  if (!v.ok) return v;
  const d = await comDataInfracao(r.c, v.dataInfracao);
  if (!d.ok) return d;
  const c = d.c;

  // Com a data nova, o condutor e as faltas podem ser outros: a recusa leva-os, para o modal os mostrar.
  const conflito = mensagemAlternativa(c);
  if (conflito) return recusarComDados(c, conflito);
  const bloqueiam = faltamNasFichas(c).filter((f) => f.obrigatorio);
  if (bloqueiam.length) {
    return recusarComDados(c, `Faltam dados para o F306 — ${bloqueiam.map(rotuloFalta).join("; ")}.`);
  }

  let preenchido: Awaited<ReturnType<typeof preencherF306>>;
  try {
    preenchido = await preencherF306(dadosF306(c, v.numero));
  } catch (err) {
    if (err instanceof F306LetrasError) {
      return recusarComDados(
        c,
        `O campo «${err.campo}» tem letras que o formulário da ANSR não consegue escrever (${err.letras.join(" ")}). Escreve-o na ficha com letras latinas e gera outra vez.`,
      );
    }
    console.error("gerarF306: preencher:", err);
    return { ok: false, error: "Não consegui preencher o F306." };
  }

  const caminho = `${PASTA_F306}/${crypto.randomUUID()}-F306-${v.numero}.pdf`;
  const { error: erroUpload } = await supabaseAdmin.storage
    .from(BUCKET_PRIVADO)
    .upload(caminho, preenchido.pdf, { contentType: "application/pdf", upsert: false });
  if (erroUpload) {
    console.error("gerarF306: upload:", erroUpload.message);
    return { ok: false, error: "Não consegui guardar o F306 — tenta outra vez." };
  }

  const antes = c.infracao;
  const g = await gravarInfracao(c, {
    numero_auto: v.numero,
    data_notificacao: v.data,
    prazo_identificacao: prazoDe(v.data),
    signatario: v.signatario,
    estado: "gerada",
    f306_path: caminho,
    f306_gerado_em: new Date().toISOString(),
    // Um F306 novo pede assinatura nova.
    f306_assinado_path: null,
  });
  if (!g.ok) {
    await removerFicheirosF306([caminho]);
    return recusarComDados(c, g.error);
  }
  // Só depois de a linha nova ficar: se outra ação a mudou entretanto, os ficheiros dela ficam.
  await removerFicheirosF306([antes?.f306_path, antes?.f306_assinado_path]);
  c.infracao = g.infracao;
  revalidarCoimas();

  const trocas = [...new Map(preenchido.trocas.map((t) => [`${t.campo}|${t.de}`, t])).values()];
  const avisos = [
    trocas.length > 0 &&
      `Algumas letras não existem no formulário da ANSR e foram escritas sem o sinal: ${trocas
        .map((t) => `${t.de} → ${t.para} (${t.campo})`)
        .join(", ")}. Confirma no PDF.`,
    d.mudou && "A data da infração mudou: confirma que o condutor é o certo.",
  ].filter((x): x is string => Boolean(x));
  return responder(c, avisos.join(" ") || undefined);
}

/**
 * Liga o PDF assinado, já carregado pelo browser para `privado/infracoes/f306/`.
 * Só aceita um PDF com assinatura digital que seja o F306 gerado agora para esta
 * coima, campo a campo: outro PDF assinado (um contrato, o F306 de outra coima,
 * uma versão anterior deste) nunca fica pronto a seguir para a ANSR.
 */
export async function registarF306Assinado(despesaId: string, caminho: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!ehCaminhoDoF306(caminho)) return { ok: false, error: "O ficheiro não foi carregado para a pasta do F306." };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  const i = c.infracao;
  if (!i?.f306_path) return { ok: false, error: "Gera primeiro o F306." };
  if (fechada(i)) return { ok: false, error: mensagemFechada(i) };
  if (i.regime !== "ansr") return { ok: false, error: mensagemOutraEntidade(i.entidade) };
  if (await caminhoUsadoPorOutra(caminho, i.id)) {
    return { ok: false, error: "Esse ficheiro já pertence a outra coima — carrega o PDF assinado desta." };
  }
  /** Recusa e tira o PDF que o browser acabou de carregar (se nenhuma linha o usar). */
  const recusar = async (error: string): Promise<RespostaIdentificacao> => {
    await removerSeSemUso(caminho);
    return { ok: false, error };
  };
  if (f306Desatualizado(c)) return recusar(MENSAGEM_F306_DESATUALIZADO);
  const conflito = mensagemAlternativa(c);
  if (conflito) return recusar(conflito);

  const [assinadoBytes, geradoBytes] = await Promise.all([lerPrivado(caminho), lerPrivado(i.f306_path)]);
  if (!assinadoBytes) return recusar("Não consegui abrir o PDF carregado — carrega-o outra vez.");
  if (!assinadoBytes.subarray(0, 1024).includes("%PDF-")) return recusar("O ficheiro carregado não é um PDF.");
  if (!temAssinaturaDigital(assinadoBytes)) {
    return recusar(
      "Este PDF não tem assinatura digital. Assina-o na app Autenticação.gov, com o Cartão de Cidadão ou a Chave Móvel Digital, e carrega o ficheiro assinado.",
    );
  }
  if (!geradoBytes) return recusar("Não consegui abrir o F306 gerado para o comparar com o assinado — gera-o outra vez.");

  const [assinado, gerado] = await Promise.all([camposDoF306(assinadoBytes), camposDoF306(geradoBytes)]);
  if (!assinado) {
    return recusar(
      "Não encontrei neste PDF os campos do F306. Carrega o F306 que geraste aqui, assinado na app Autenticação.gov — sem o imprimir para PDF nem o digitalizar.",
    );
  }
  if (!gerado) return recusar("Não consegui ler o F306 gerado para o comparar com o assinado — gera-o outra vez.");
  // Todos os campos que a plataforma preenche, também os vazios: um F306 antigo com
  // um dado que entretanto se tirou não passa. As linhas de assinatura ficam de fora.
  const semEspacos = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const diferente = CAMPOS_PREENCHIDOS_F306.some((nome) => semEspacos(gerado[nome]) !== semEspacos(assinado[nome]));
  if (diferente) {
    return recusar(
      "Este PDF assinado não é igual ao F306 gerado agora para esta coima. Se corrigiste algum dado no PDF, corrige-o na ficha, gera o F306 outra vez e assina esse.",
    );
  }

  const anterior = i.f306_assinado_path;
  const atualizada = await atualizarInfracao(i, { f306_assinado_path: caminho, estado: "assinada" });
  if (!atualizada.ok) return recusar(atualizada.error);
  if (anterior && anterior !== caminho) await removerFicheirosF306([anterior]);
  c.infracao = atualizada.infracao;
  revalidarCoimas();
  return responder(c);
}

/**
 * Envia o F306 assinado para mail@ansr.pt, com cópia para quem envia, e regista o
 * envio. A linha fica «enviada» ANTES de o email sair — só um envio passa, mesmo
 * com dois separadores — e volta a «assinada» se o email não sair.
 */
export async function enviarF306PorEmail(
  despesaId: string,
  input: {
    nota?: string | null;
    /** O que está no ecrã: tem de ser o que ficou gravado (e assinado). */
    signatario?: InfracaoSignatario | null;
    numero_auto?: string | null;
    data_infracao?: string | null;
  },
): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  const i = c.infracao;
  if (fechada(i)) return { ok: false, error: mensagemFechada(i) };
  if (i?.estado !== "assinada" || !i.f306_assinado_path) {
    return { ok: false, error: "Carrega primeiro o F306 assinado." };
  }
  if (i.regime !== "ansr") return { ok: false, error: mensagemOutraEntidade(i.entidade) };
  if (f306Desatualizado(c)) return { ok: false, error: MENSAGEM_F306_DESATUALIZADO };
  const conflito = mensagemAlternativa(c);
  if (conflito) return { ok: false, error: conflito };
  // As regras de quem assina são as do que está gravado: uma escolha por guardar no ecrã não passa.
  if (input?.signatario && input.signatario !== i.signatario) {
    return { ok: false, error: "Mudaste quem assina: carrega em «Guardar» antes de enviar." };
  }
  // Um n.º do auto ou uma data da infração corrigidos e por guardar: o F306 assinado é o dos antigos.
  const autoNoEcra = input?.numero_auto != null ? normalizarAuto(String(input.numero_auto), i.regime) : undefined;
  const dataNoEcra = String(input?.data_infracao ?? "").trim();
  if (
    (autoNoEcra !== undefined && autoNoEcra !== i.numero_auto) ||
    (dataNoEcra && dataNoEcra !== c.despesa.data_infracao_registada)
  ) {
    return { ok: false, error: "Há dados do auto por guardar: carrega em «Guardar» antes de enviar." };
  }
  if (i.signatario === "mandatario") {
    return {
      ok: false,
      error:
        "Com mandatário, o F306 tem de seguir com a procuração: envia-o pelo portal ou por correio e regista o envio em «Já foi enviado por outro canal».",
    };
  }
  const nota = String(input?.nota ?? "").trim().slice(0, 2000);
  if (i.signatario === "representante_legal" && !nota) {
    return { ok: false, error: "Indica na nota o código de acesso à certidão permanente da empresa." };
  }
  const assinado = i.f306_assinado_path;

  const bytes = await lerPrivado(assinado);
  if (!bytes) return { ok: false, error: "Não consegui abrir o F306 assinado — carrega-o outra vez." };
  const base64 = bytes.toString("base64");

  const agora = new Date().toISOString();
  const { data: reservada, error: erroReserva } = await supabaseAdmin
    .from("infracao")
    .update({
      estado: "enviada",
      envio_canal: "email",
      envio_destino: EMAIL_ANSR,
      envio_referencia: null,
      enviado_em: agora,
      updated_at: agora,
    })
    .eq("id", i.id)
    .eq("updated_at", i.updated_at)
    .eq("estado", "assinada")
    .eq("f306_assinado_path", assinado)
    .select("*")
    .maybeSingle();
  if (erroReserva || !reservada) {
    if (erroReserva) console.error("enviarF306PorEmail: reservar:", erroReserva.message);
    return { ok: false, error: "A identificação mudou entretanto (outro separador ou outra pessoa) — carrega em «Atualizar dados»." };
  }

  const auto = i.numero_auto ?? "";
  const titular = nomeDoArguido(c.dono);
  const remetente = auth.user.email ?? null;
  const texto = [
    "Exmos. Senhores,",
    "",
    `Nos termos do artigo 171.º do Código da Estrada, enviamos em anexo o formulário de identificação do condutor (F306), assinado com assinatura digital qualificada, relativo ao auto de contraordenação n.º ${auto}${c.matricula ? `, veículo de matrícula ${c.matricula}` : ""}.`,
    ...(nota ? ["", nota] : []),
    "",
    "Com os melhores cumprimentos,",
    ...(titular ? [titular] : []),
  ].join("\n");

  const envio = await enviarEmailExterno({
    para: [EMAIL_ANSR],
    cc: remetente ? [remetente] : [],
    responderPara: remetente,
    assunto: `Identificação de condutor — auto n.º ${auto}`,
    texto,
    anexos: [{ nome: `F306-${auto}.pdf`, base64 }],
  });
  if (!envio.ok) {
    const repor = () =>
      supabaseAdmin
        .from("infracao")
        .update({
          estado: "assinada",
          envio_canal: null,
          envio_destino: null,
          enviado_em: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", i.id)
        .eq("estado", "enviada")
        .eq("enviado_em", agora)
        .select("id")
        .maybeSingle();
    let reposta = await repor();
    if (reposta.error) reposta = await repor();
    if (reposta.error || !reposta.data) {
      console.error("enviarF306PorEmail: o email falhou e não consegui repor o estado:", reposta.error?.message ?? "sem linha");
      return {
        ok: false,
        error: `${envio.erro} E não consegui voltar a pô-la como assinada: pode aparecer como enviada, mas o email NÃO saiu. Envia-a pelo portal ou por correio dentro do prazo, e pede para corrigirem o registo.`,
      };
    }
    return { ok: false, error: envio.erro };
  }

  const { data: registada, error: erroRegisto } = await supabaseAdmin
    .from("infracao")
    .update({
      envio_referencia: envio.id || null,
      ...(nota ? { observacoes: nota } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", i.id)
    .eq("estado", "enviada")
    .eq("enviado_em", agora)
    .select("*")
    .maybeSingle();
  c.infracao = registada ?? reservada;
  revalidarCoimas();
  if (erroRegisto || !registada) {
    console.error(`enviarF306PorEmail: o email saiu (${envio.id}), mas não guardei a referência:`, erroRegisto?.message);
    return responder(c, `O email seguiu para a ANSR, mas não consegui guardar a referência do envio (${envio.id || "?"}).`);
  }
  return responder(c, remetente ? undefined : "O email seguiu sem cópia: a tua conta não tem email associado.");
}

/** Portal das Contraordenações, correio registado, PSP/GNR — ou um email enviado fora da app. */
export async function registarEnvioManual(despesaId: string, input: EnvioManualInput): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const comprovativo = input?.comprovativo_path || null;
  if (comprovativo && !ehCaminhoDoF306(comprovativo)) {
    return { ok: false, error: "O comprovativo não foi carregado para a pasta do F306." };
  }
  /** Recusa e tira o comprovativo que o browser acabou de carregar (se nenhuma linha o usar). */
  const recusar = async (error: string): Promise<RespostaIdentificacao> => {
    if (comprovativo) await removerSeSemUso(comprovativo);
    return { ok: false, error };
  };

  const canal = input?.canal;
  if (!canal || !Object.hasOwn(DESTINO_DO_CANAL, canal)) return recusar("Escolhe o canal do envio.");
  const data = String(input.data ?? "");
  if (!ehDataISO(data) || data > hojeEmLisboa()) return recusar("Indica a data do envio (hoje ou antes).");

  const r = await carregarContexto(despesaId);
  if (!r.ok) return recusar(r.error);
  const c = r.c;
  const i = c.infracao;
  if (!i) return recusar("Guarda primeiro o n.º do auto e a data da notificação.");
  if (fechada(i)) return recusar(mensagemFechada(i));
  if (comprovativo && (await caminhoUsadoPorOutra(comprovativo, i.id))) {
    return { ok: false, error: "Esse comprovativo já pertence a outra coima — carrega o desta." };
  }

  const atualizada = await atualizarInfracao(i, {
    estado: "enviada",
    envio_canal: canal,
    envio_destino: i.regime === "ansr" ? DESTINO_DO_CANAL[canal] : i.entidade,
    envio_referencia: String(input.referencia ?? "").trim().slice(0, 200) || null,
    // Meio-dia UTC: a data escolhida não muda de dia em nenhum fuso de Portugal.
    enviado_em: `${data}T12:00:00Z`,
    comprovativo_path: comprovativo,
  });
  if (!atualizada.ok) return recusar(atualizada.error);
  c.infracao = atualizada.infracao;
  revalidarCoimas();
  return responder(c);
}

/** Uma coima que não leva identificação (o dono conduzia, já foi tratada fora da app…). */
export async function marcarNaoAplicavel(despesaId: string, motivo: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const texto = String(motivo ?? "").trim().slice(0, 500);
  if (!texto) return { ok: false, error: "Indica o motivo." };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  if (fechada(c.infracao)) return { ok: false, error: mensagemFechada(c.infracao) };
  const g = await gravarInfracao(c, { estado: "nao_aplicavel", observacoes: texto });
  if (!g.ok) return recusarComDados(c, g.error);
  c.infracao = g.infracao;
  revalidarCoimas();
  return responder(c);
}

export async function reabrirIdentificacao(despesaId: string): Promise<RespostaIdentificacao> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const r = await carregarContexto(despesaId);
  if (!r.ok) return r;
  const c = r.c;
  const i = c.infracao;
  if (i?.estado !== "nao_aplicavel") return { ok: false, error: "Esta coima não está marcada como não aplicável." };
  const estado = i.f306_assinado_path ? "assinada" : i.f306_path ? "gerada" : "por_identificar";
  const { data, error } = await supabaseAdmin
    .from("infracao")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", i.id)
    .eq("estado", "nao_aplicavel")
    .select("*")
    .maybeSingle();
  if (error || !data) {
    console.error("reabrirIdentificacao:", error?.message ?? "sem linha");
    return { ok: false, error: "Não consegui reabrir — tenta outra vez." };
  }
  c.infracao = data;
  revalidarCoimas();
  return responder(c);
}

// ── Auxiliares ──────────────────────────────────────────────────────────────

async function responder(c: ContextoInfracao, aviso?: string): Promise<RespostaIdentificacao> {
  const i = c.infracao;
  const [f306, assinado, comprovativo] = await urlsDocumentosParaAdmin([
    i?.f306_path,
    i?.f306_assinado_path,
    i?.comprovativo_path,
  ]);
  const arguido = nomeDoArguido(c.dono);
  const { regime, entidade } = regimeDaCoima(c);
  const a = fechada(i) ? null : c.alternativa;
  return {
    ok: true,
    ...(aviso ? { aviso } : {}),
    dados: {
      despesa_id: c.despesa.id,
      matricula: c.matricula,
      data_infracao: c.despesa.data_infracao,
      data_infracao_registada: c.despesa.data_infracao_registada,
      data_do_auto: c.despesa.data_despesa,
      descricao: c.despesa.descricao,
      tem_documento: temDocumento(c),
      regime,
      entidade,
      f306_desatualizado: f306Desatualizado(c),
      arguido: c.dono
        ? {
            id: c.dono.id,
            nome: arguido,
            parceiro: arguido !== c.dono.nome ? c.dono.nome : null,
            coletiva: c.dono.tipo_pessoa === "coletiva",
            nif: c.dono.nif,
          }
        : null,
      condutor: c.condutor
        ? {
            id: c.condutor.id,
            nome: c.condutor.nome,
            nif: c.condutor.nif,
            contrato_numero: c.contratoNumero,
            origem: c.origemCondutor ?? "coima",
          }
        : null,
      alternativa: a ? { id: a.id, nome: a.nome, origem: a.origem, contrato_numero: a.contratoNumero } : null,
      condutor_por_confirmar: !fechada(i) && c.condutorSemApoio,
      faltam: faltamNasFichas(c),
      infracao: i,
      links: { f306, assinado, comprovativo },
    },
  };
}

/** Recusa com o estado de agora, para o modal mostrar o que levou à recusa. */
async function recusarComDados(c: ContextoInfracao, error: string): Promise<RespostaIdentificacao> {
  const r = await responder(c);
  return { ok: false, error, ...(r.ok ? { dados: r.dados } : {}) };
}

/** Um ficheiro em privado, ou null (com o motivo no log). */
async function lerPrivado(caminho: string): Promise<Buffer | null> {
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).download(caminho);
  if (error || !blob) {
    console.error("identificação: abrir", caminho, error?.message ?? "sem dados");
    return null;
  }
  return Buffer.from(await blob.arrayBuffer());
}

const rotuloFalta = (f: FaltaF306) =>
  f.quem === "arguido" ? `proprietário: ${f.campo}` : f.quem === "condutor" ? `condutor: ${f.campo}` : f.campo;

const mensagemOutraEntidade = (entidade: string) =>
  `Este auto é de ${entidade}: o F306 e o email da ANSR não servem. Identifica o condutor pelo formulário e canal dessa entidade e regista aqui o envio.`;

function validarAuto(
  input: DadosDoAutoInput,
  c: ContextoInfracao,
):
  | { ok: true; numero: string; data: string; dataInfracao: string | null; signatario: InfracaoSignatario }
  | { ok: false; error: string } {
  const regime = regimeDaCoima(c).regime;
  const numero = normalizarAuto(String(input?.numero_auto ?? ""), regime);
  // Os autos da ANSR têm 9 dígitos; os de outras entidades têm o formato delas.
  if (!numero) return { ok: false, error: regime === "ansr" ? "O n.º do auto tem 9 dígitos." : "Indica o n.º do auto." };
  const dataInfracao = String(input.data_infracao ?? "").trim() || null;
  if (dataInfracao && (!ehDataISO(dataInfracao) || dataInfracao > hojeEmLisboa())) {
    return { ok: false, error: "A data da infração não é válida (tem de ser hoje ou antes)." };
  }
  const data = String(input.data_notificacao ?? "");
  const erroData = erroDataNotificacao(data, dataInfracao ?? c.despesa.data_infracao);
  if (erroData) return { ok: false, error: erroData };
  if (!SIGNATARIOS.includes(input.signatario)) return { ok: false, error: "Escolhe quem assina o F306." };
  return { ok: true, numero, data, dataInfracao, signatario: input.signatario };
}

/**
 * Grava a data da infração quando o gestor a indica ou corrige, e volta a ler o
 * contexto: as pistas do condutor (contrato, cobranças) passam a ser as dessa
 * data, e uma que discorde do condutor da coima pede confirmação.
 */
async function comDataInfracao(
  c: ContextoInfracao,
  dataInfracao: string | null,
): Promise<{ ok: true; c: ContextoInfracao; mudou: boolean } | { ok: false; error: string }> {
  if (!dataInfracao || dataInfracao === c.despesa.data_infracao_registada) return { ok: true, c, mudou: false };
  const { error } = await supabaseAdmin.from("despesa").update({ data_infracao: dataInfracao }).eq("id", c.despesa.id);
  if (error) {
    console.error("identificação: gravar a data da infração:", error.message);
    return { ok: false, error: "Não consegui gravar a data da infração." };
  }
  const novo = await carregarContexto(c.despesa.id);
  if (!novo.ok) return novo;
  return { ok: true, c: novo.c, mudou: true };
}
