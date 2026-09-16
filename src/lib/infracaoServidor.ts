import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contratoDoVeiculoNaDataOuErro } from "@/lib/contratoAtivo";
import { dataBR } from "@/lib/datas";
import {
  BUCKET_PRIVADO,
  BUCKET_PUBLICO,
  documentoDoDetalhe,
  ehCaminhoDeInfracao,
  lerRefDocumento,
} from "@/lib/documentoDespesa";
import { hojeEmLisboa, somarDiasUteis } from "@/lib/diasUteis";
import { camposEmFaltaF306, emissorDaCarta, regimeDaEntidade, type DadosF306 } from "@/lib/f306Texto";
import { geminiConfigurado, lerAutoGemini, mimeDoCaminho } from "@/lib/gemini";
import type { Database, DocIdTipo, TipoPessoa } from "@/types/db";
import {
  DIAS_UTEIS_PARA_IDENTIFICAR,
  type FaltaF306,
  type Infracao,
  type InfracaoEstado,
  type InfracaoRegime,
} from "@/types/infracao";

/**
 * O processo do F306 de uma coima — a parte que as ações de identificação
 * (infracaoActions) partilham com os registos de coima (intake e «Registar
 * coima»), que o abrem logo ao gravar para o prazo começar a contar.
 *
 * NÃO verifica a sessão: chama-se sempre depois de requireAdminForAction. Por
 * isso vive aqui e não num ficheiro "use server", onde cada export é um endpoint.
 */

export const PASTA_F306 = "infracoes/f306";
export const SEM_MIGRACAO = "Falta aplicar a migração sql/fase16_infracao.sql.";
export const MENSAGEM_MUDOU =
  "A identificação mudou entretanto (noutro separador ou por outra pessoa) — carrega em «Atualizar dados».";
const ERRO_PISTAS = "Não consegui confirmar quem tinha a mota nessa data — tenta outra vez.";

export type InfracaoEscrita = Database["public"]["Tables"]["infracao"]["Update"];
type DetalheDespesa = Database["public"]["Tables"]["despesa"]["Update"]["detalhe"];

export type DonoF306 = {
  id: string;
  nome: string;
  titular_nome: string | null;
  tipo_pessoa: TipoPessoa;
  nif: string | null;
  doc_id_tipo: DocIdTipo | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null;
  doc_id_emissao: string | null;
  doc_id_emissor: string | null;
  carta_numero: string | null;
};

export type CondutorF306 = {
  id: string;
  nome: string;
  nif: string | null;
  /** Nacionalidade — o país que emitiu o passaporte. */
  pais_iso: string | null;
  doc_id_tipo: DocIdTipo | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null;
  doc_id_emissao: string | null;
  doc_id_emissor: string | null;
  carta_numero: string | null;
  carta_pais: string | null;
  morada_linha1: string | null;
  codigo_postal: string | null;
  localidade: string | null;
  precisa_revisao: boolean;
};

/** De onde veio o condutor: já associado à coima, o contrato que cobria a data, ou as cobranças dessa semana. */
export type OrigemCondutor = "coima" | "contrato" | "cobrancas";

/** Outro motorista para a mesma data, apontado por outra pista. */
export type CondutorAlternativo = {
  id: string;
  nome: string;
  origem: OrigemCondutor;
  contratoNumero: string | null;
};

export interface ContextoInfracao {
  despesa: {
    id: string;
    veiculo_id: string | null;
    descricao: string | null;
    /** A que conta: a da infração; sem ela, a do auto. */
    data_infracao: string;
    /** A data da infração gravada na coima (null quando se está a usar a do auto). */
    data_infracao_registada: string | null;
    /** A data do auto (data da despesa). */
    data_despesa: string;
    referencia_externa: string | null;
    /** Quem levantou o auto, como ficou na coima (ANSR, PSP, EMEL…). */
    fornecedor: string | null;
    imputar_a: string;
    /** A dívida gerada ao motorista ao registar a coima, se houve. */
    cobranca_id: string | null;
    detalhe: unknown;
  };
  matricula: string | null;
  dono: DonoF306 | null;
  condutor: CondutorF306 | null;
  origemCondutor: OrigemCondutor | null;
  /**
   * As pistas não batem certo: outra aponta este motorista para a data. Enquanto
   * o gestor não confirmar quem conduzia, o F306 não se gera, assina nem envia.
   */
  alternativa: CondutorAlternativo | null;
  /**
   * O condutor está associado à coima, mas nada da data o apoia — nem contrato nem
   * cobranças — e o gestor não o confirmou para ela (foi achado por outra data, ou
   * escolhido sem prova). Também espera confirmação.
   */
  condutorSemApoio: boolean;
  contratoId: string | null;
  contratoNumero: string | null;
  infracao: Infracao | null;
}

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function carregarContexto(
  despesaId: string,
): Promise<{ ok: true; c: ContextoInfracao } | { ok: false; error: string }> {
  if (!despesaId) return { ok: false, error: "Coima em falta." };
  const { data: d, error } = await supabaseAdmin
    .from("despesa")
    .select(
      "id, categoria, veiculo_id, proprietario_id, motorista_id, contrato_id, descricao, data_despesa, data_infracao, referencia_externa, fornecedor, imputar_a, cobranca_id, detalhe",
    )
    .eq("id", despesaId)
    .maybeSingle();
  if (error) {
    console.error("identificação: ler a despesa:", error.message);
    return { ok: false, error: "Não consegui ler a coima." };
  }
  if (!d) return { ok: false, error: "Coima não encontrada." };
  if (d.categoria !== "coima") return { ok: false, error: "Só as coimas têm identificação de condutor." };

  const dataInfracao = d.data_infracao ?? d.data_despesa;
  const [moto, contratoLido, cobrancasLidas, infr] = await Promise.all([
    d.veiculo_id
      ? supabaseAdmin.from("moto").select("matricula, proprietario_id").eq("id", d.veiculo_id).maybeSingle()
      : Promise.resolve(null),
    contratoDoVeiculoNaDataOuErro(d.veiculo_id ?? "", dataInfracao),
    motoristaDasCobrancas(d.veiculo_id ?? "", dataInfracao),
    supabaseAdmin.from("infracao").select("*").eq("despesa_id", d.id).maybeSingle(),
  ]);
  if (infr.error) {
    console.error("identificação: ler a infração:", infr.error.message);
    return { ok: false, error: SEM_MIGRACAO };
  }
  // Sem as pistas da data não se sabe se o condutor é o certo: recusa-se, em vez
  // de deixar gerar ou enviar o F306 sem a dúvida à vista.
  if (!contratoLido.ok || !cobrancasLidas.ok) return { ok: false, error: ERRO_PISTAS };
  const contrato = contratoLido.contrato;
  const doLedger = cobrancasLidas.motoristaId;

  // Quem conduzia, por três pistas: o motorista associado à coima (ao registar ou
  // escolhido à mão), o contrato que cobria a data e as cobranças de renda dessa
  // semana — o mesmo histórico que o intake usa. Fica a primeira que houver. Se
  // outra apontar outro motorista (uma data corrigida depois de registar, uma
  // troca de mota que o contrato não guardou), volta como alternativa, até o
  // gestor confirmar quem era. A confirmação vale para a data em que se fez.
  const pistas: { id: string; origem: OrigemCondutor }[] = [];
  if (d.motorista_id) pistas.push({ id: d.motorista_id, origem: "coima" });
  if (contrato?.motorista_id) pistas.push({ id: contrato.motorista_id, origem: "contrato" });
  if (doLedger) pistas.push({ id: doLedger, origem: "cobrancas" });
  const principal = pistas[0] ?? null;
  const confirmado = principal?.origem === "coima" && condutorConfirmado(d.detalhe, principal.id, dataInfracao);
  const outra = confirmado ? null : (pistas.find((p) => p.id !== principal?.id) ?? null);
  const semApoio = principal?.origem === "coima" && !confirmado && pistas.length === 1;
  const motoristaId = principal?.id ?? null;

  const donoId = d.proprietario_id ?? contrato?.proprietario_id ?? moto?.data?.proprietario_id ?? null;
  const [dono, condutor, alternativa] = await Promise.all([
    donoId
      ? supabaseAdmin
          .from("proprietario")
          .select(
            "id, nome, titular_nome, tipo_pessoa, nif, doc_id_tipo, doc_id_numero, doc_id_validade, doc_id_emissao, doc_id_emissor, carta_numero",
          )
          .eq("id", donoId)
          .maybeSingle()
      : Promise.resolve(null),
    motoristaId
      ? supabaseAdmin
          .from("motorista")
          .select(
            "id, nome, nif, pais_iso, doc_id_tipo, doc_id_numero, doc_id_validade, doc_id_emissao, doc_id_emissor, carta_numero, carta_pais, morada_linha1, codigo_postal, localidade, precisa_revisao",
          )
          .eq("id", motoristaId)
          .maybeSingle()
      : Promise.resolve(null),
    outra ? supabaseAdmin.from("motorista").select("id, nome").eq("id", outra.id).maybeSingle() : Promise.resolve(null),
  ]);
  const erroFichas = dono?.error ?? condutor?.error;
  if (erroFichas) {
    console.error("identificação: ler as fichas:", erroFichas.message);
    return { ok: false, error: `Não consegui ler o proprietário e o condutor. ${SEM_MIGRACAO}` };
  }
  if (alternativa?.error) {
    console.error("identificação: ler o outro condutor:", alternativa.error.message);
    return { ok: false, error: ERRO_PISTAS };
  }

  const doContrato = contrato && contrato.motorista_id === motoristaId ? contrato : null;
  return {
    ok: true,
    c: {
      despesa: {
        id: d.id,
        veiculo_id: d.veiculo_id,
        descricao: d.descricao,
        data_infracao: dataInfracao,
        data_infracao_registada: d.data_infracao,
        data_despesa: d.data_despesa,
        referencia_externa: d.referencia_externa,
        fornecedor: d.fornecedor,
        imputar_a: d.imputar_a,
        cobranca_id: d.cobranca_id,
        detalhe: d.detalhe,
      },
      matricula: moto?.data?.matricula ?? null,
      dono: dono?.data ?? null,
      condutor: condutor?.data ?? null,
      origemCondutor: condutor?.data ? (principal?.origem ?? null) : null,
      alternativa:
        outra && alternativa?.data
          ? {
              id: alternativa.data.id,
              nome: alternativa.data.nome,
              origem: outra.origem,
              contratoNumero: outra.origem === "contrato" ? (contrato?.contrato_numero ?? null) : null,
            }
          : null,
      condutorSemApoio: semApoio && Boolean(condutor?.data),
      contratoId: doContrato?.contrato_id ?? null,
      contratoNumero: doContrato?.contrato_numero ?? null,
      infracao: infr.data ?? null,
    },
  };
}

/**
 * Quem pagava a renda da mota nessa semana. Prefere a semana PAGA: as por liquidar
 * podem ter sido reapontadas numa troca de mota. As anuladas não contam — nunca
 * foram devidas, o contrato acabou antes.
 */
async function motoristaDasCobrancas(
  veiculoId: string,
  data: string,
): Promise<{ ok: true; motoristaId: string | null } | { ok: false }> {
  if (!veiculoId) return { ok: true, motoristaId: null };
  const { data: linhas, error } = await supabaseAdmin
    .from("cobranca")
    .select("motorista_id, valor_pago")
    .eq("veiculo_id", veiculoId)
    .eq("tipo", "renda")
    .neq("estado_liquidacao", "anulada")
    .lte("periodo_inicio", data)
    .gte("periodo_fim", data)
    .order("valor_pago", { ascending: false })
    .limit(1);
  if (error) {
    console.error("identificação: cobranças na data:", error.message);
    return { ok: false };
  }
  return { ok: true, motoristaId: linhas?.[0]?.motorista_id ?? null };
}

/** O gestor confirmou este condutor para esta data (definirCondutor). */
function condutorConfirmado(detalhe: unknown, motoristaId: string, dataInfracao: string): boolean {
  const conf = objeto(objeto(detalhe).condutor_confirmado);
  return conf.motorista_id === motoristaId && conf.data_infracao === dataInfracao;
}

/** O detalhe da coima com o condutor confirmado pelo gestor para a data de agora. */
export function comCondutorConfirmado(c: ContextoInfracao, motoristaId: string): DetalheDespesa {
  return {
    ...objeto(c.despesa.detalhe),
    condutor_confirmado: { motorista_id: motoristaId, data_infracao: c.despesa.data_infracao },
  } as DetalheDespesa;
}

const QUEM_INDICA: Record<OrigemCondutor, (contrato: string | null) => string> = {
  coima: () => "a coima indica",
  contrato: (numero) => `o contrato${numero ? ` ${numero}` : ""} indica`,
  cobrancas: () => "as cobranças de renda dessa semana indicam",
};

/**
 * Null quando não há dúvida sobre o condutor; senão, o que pede ao gestor que
 * confirme: outra pista aponta outro motorista, ou nada da data apoia o da coima.
 */
export function mensagemAlternativa(c: ContextoInfracao): string | null {
  if (!c.condutor || fechada(c.infracao)) return null;
  const a = c.alternativa;
  const data = dataBR(c.despesa.data_infracao);
  if (a) {
    return `Na data da infração (${data}), ${QUEM_INDICA[a.origem](a.contratoNumero)} ${a.nome}, e não ${c.condutor.nome}. Confirma quem conduzia antes de continuar.`;
  }
  if (c.condutorSemApoio) {
    return `Nos contratos e nas cobranças de ${data}, nada indica que ${c.condutor.nome} tinha a mota. Confirma quem conduzia antes de continuar.`;
  }
  return null;
}

/** Quem instrui o processo: o que ficou na linha; sem linha, o que a coima diz. */
export function regimeDaCoima(c: ContextoInfracao): { regime: InfracaoRegime; entidade: string } {
  if (c.infracao) return { regime: c.infracao.regime, entidade: c.infracao.entidade };
  return regimeDaEntidade(c.despesa.fornecedor);
}

// ── O auto: n.º e data da notificação ───────────────────────────────────────

/**
 * O n.º do auto como se guarda: na ANSR, só os dígitos, quando tem a forma de um
 * (9 dígitos); nas outras entidades (EMEL, câmaras), o texto como vem.
 */
export function normalizarAuto(valor: unknown, regime: InfracaoRegime = "ansr"): string | null {
  if (typeof valor !== "string") return null;
  if (regime === "outro") return valor.trim().slice(0, 60) || null;
  const n = valor.replace(/[\s.-]/g, "");
  return /^\d{9}$/.test(n) ? n : null;
}

export function ehDataISO(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Null se a data serve como data da notificação; senão, o motivo. */
export function erroDataNotificacao(data: string, dataInfracao: string): string | null {
  if (!ehDataISO(data)) return "Indica a data da notificação — é dela que conta o prazo.";
  if (data > hojeEmLisboa()) return "A data da notificação não pode ser no futuro.";
  if (data < dataInfracao) return "A notificação não pode ser anterior à infração.";
  return null;
}

export const prazoDe = (dataNotificacao: string) => somarDiasUteis(dataNotificacao, DIAS_UTEIS_PARA_IDENTIFICAR);

/**
 * O que a coima já traz: o n.º do auto — a referência confirmada ao registar ou,
 * sem ela, o que a IA leu — e a data da notificação lida pelo intake ou indicada
 * ao registar. Uma data que não serve não se usa, mas volta o motivo.
 */
export function autoDaCoima(c: ContextoInfracao): {
  numero: string | null;
  dataNotificacao: string | null;
  erroDataNotificacao: string | null;
} {
  const detalhe = objeto(c.despesa.detalhe);
  const { regime } = regimeDaCoima(c);
  const numero = normalizarAuto(c.despesa.referencia_externa, regime) ?? normalizarAuto(detalhe.numero_auto, regime);
  const data = typeof detalhe.data_notificacao === "string" && detalhe.data_notificacao ? detalhe.data_notificacao : null;
  const erro = data ? erroDataNotificacao(data, c.despesa.data_infracao) : null;
  return { numero, dataNotificacao: data && !erro ? data : null, erroDataNotificacao: erro };
}

export const temDocumento = (c: ContextoInfracao) =>
  Boolean(lerRefDocumento(documentoDoDetalhe(c.despesa.detalhe))?.caminho);

/**
 * Lê do documento da coima o n.º do auto e a data da notificação, com a IA.
 * Null se não há documento, IA ou resposta; campos a null se leu e não os achou.
 */
export async function lerAutoComIA(
  c: ContextoInfracao,
): Promise<{ numero: string | null; dataNotificacao: string | null } | null> {
  const ref = lerRefDocumento(documentoDoDetalhe(c.despesa.detalhe));
  if (!ref?.caminho || !geminiConfigurado()) return null;
  const mime = mimeDoCaminho(ref.caminho);
  if (!mime.startsWith("image/") && mime !== "application/pdf") return null;
  const { data: blob, error } = await supabaseAdmin.storage
    .from(ref.onde === "privado" ? BUCKET_PRIVADO : BUCKET_PUBLICO)
    .download(ref.caminho);
  if (error || !blob) {
    console.error("identificação: abrir o documento da coima:", error?.message ?? "sem dados");
    return null;
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  // Limite prático da chamada inline do Gemini (~20 MB no corpo), com folga.
  if (buf.byteLength > 18 * 1024 * 1024) return null;
  const lido = await lerAutoGemini([{ mime, base64: buf.toString("base64") }]);
  if (!lido) return null;
  const data = typeof lido.data_notificacao === "string" ? lido.data_notificacao : null;
  return {
    numero: normalizarAuto(lido.numero_auto, regimeDaCoima(c).regime),
    dataNotificacao: data && !erroDataNotificacao(data, c.despesa.data_infracao) ? data : null,
  };
}

/**
 * Abre o processo de uma coima acabada de registar, com o que já se sabe, para o
 * prazo começar a contar. Nunca falha o registo da coima: sem a fase16, ou com
 * erro, fica só no log (o modal volta a tentar ao abrir, com o que ficou na
 * coima). Devolve a linha, e um aviso quando a data da notificação não serviu.
 */
export async function prepararInfracaoDaCoima(
  despesaId: string,
  extra: { numeroAuto?: string | null; dataNotificacao?: string | null } = {},
): Promise<{ aviso?: string; infracao: Infracao | null }> {
  const r = await carregarContexto(despesaId);
  if (!r.ok) {
    console.warn("prepararInfracaoDaCoima:", r.error);
    return { infracao: null };
  }
  const c = r.c;
  if (c.infracao) return { infracao: c.infracao };
  const conhecido = autoDaCoima(c);
  const numero = normalizarAuto(extra.numeroAuto, regimeDaCoima(c).regime) ?? conhecido.numero;
  const erroExtra = extra.dataNotificacao ? erroDataNotificacao(extra.dataNotificacao, c.despesa.data_infracao) : null;
  const data = (extra.dataNotificacao && !erroExtra ? extra.dataNotificacao : null) ?? conhecido.dataNotificacao;
  const g = await gravarInfracao(c, {
    numero_auto: numero,
    ...(data ? { data_notificacao: data, prazo_identificacao: prazoDe(data) } : {}),
  });
  if (!g.ok) {
    console.warn("prepararInfracaoDaCoima:", g.error);
    return { infracao: null };
  }
  const erro = erroExtra ?? (extra.dataNotificacao ? null : conhecido.erroDataNotificacao);
  return {
    infracao: g.infracao,
    ...(erro
      ? { aviso: `A data da notificação não ficou gravada (${erro}) Indica-a na identificação do condutor, em Coimas.` }
      : {}),
  };
}

// ── O F306 ──────────────────────────────────────────────────────────────────

const ehSingular = (dono: DonoF306 | null) => dono?.tipo_pessoa !== "coletiva";

/**
 * O nome do arguido. Numa pessoa singular pode ser o titular do registo das motas
 * (a frota própria está no nome do dono, não no da GoScooters) — os NIF e
 * documentos da ficha são os dele. Numa coletiva, o arguido é a empresa.
 */
export function nomeDoArguido(dono: DonoF306 | null): string {
  if (!dono) return "";
  return (ehSingular(dono) ? dono.titular_nome?.trim() : null) || dono.nome;
}

function domicilio(m: CondutorF306 | null): string {
  if (!m) return "";
  const local = [m.codigo_postal, m.localidade].map((x) => x?.trim()).filter(Boolean).join(" ");
  return [m.morada_linha1?.trim(), local].filter(Boolean).join(", ");
}

export function dadosF306(c: ContextoInfracao, numeroAuto: string): DadosF306 {
  const { dono, condutor: m } = c;
  const singular = ehSingular(dono);
  return {
    numeroAuto,
    arguido: {
      nome: nomeDoArguido(dono),
      nif: dono?.nif ?? "",
      documento:
        singular && dono
          ? {
              tipo: dono.doc_id_tipo,
              numero: dono.doc_id_numero,
              emissao: dono.doc_id_emissao,
              validade: dono.doc_id_validade,
              emissor: dono.doc_id_emissor,
            }
          : null,
      carta: singular ? (dono?.carta_numero ?? null) : null,
    },
    condutor: {
      nome: m?.nome ?? "",
      domicilioFiscal: domicilio(m),
      documento: {
        tipo: m?.doc_id_tipo,
        numero: m?.doc_id_numero,
        emissao: m?.doc_id_emissao,
        validade: m?.doc_id_validade,
        emissor: m?.doc_id_emissor,
        paisIso2: m?.pais_iso,
      },
      carta: m?.carta_numero ?? "",
      cartaEmissor: emissorDaCarta(m?.carta_pais),
      nif: m?.nif ?? "",
    },
  };
}

export function faltamNasFichas(c: ContextoInfracao): FaltaF306[] {
  // O n.º do auto vem do formulário e valida-se à parte: aqui só contam as fichas.
  const faltam = camposEmFaltaF306(dadosF306(c, "000000000"), ehSingular(c.dono));
  if (c.condutor?.precisa_revisao) faltam.push({ quem: "condutor", campo: "ficha por confirmar", obrigatorio: true });
  return faltam;
}

/**
 * O condutor ou o titular de agora já não são os do F306 gerado — por exemplo,
 * uma troca de condutor que não chegou a invalidar o F306. Esse F306 não segue.
 */
export function f306Desatualizado(c: ContextoInfracao): boolean {
  const i = c.infracao;
  if (!i?.f306_path) return false;
  return i.motorista_id !== (c.condutor?.id ?? null) || i.proprietario_id !== (c.dono?.id ?? null);
}

export const MENSAGEM_F306_DESATUALIZADO =
  "O condutor ou o titular mudou depois de gerado o F306: gera-o e assina-o outra vez.";

export const fechada = (i: Infracao | null) => i?.estado === "enviada" || i?.estado === "nao_aplicavel";

export const mensagemFechada = (i: Infracao | null) =>
  i?.estado === "enviada"
    ? "Esta identificação já foi enviada — já não se altera."
    : "Esta coima está marcada como não aplicável — reabre-a primeiro.";

export const ehCaminhoDoF306 = (caminho: unknown): caminho is string =>
  typeof caminho === "string" && caminho.startsWith(`${PASTA_F306}/`) && ehCaminhoDeInfracao(caminho);

/**
 * Uma assinatura digital num PDF (PAdES, a da Autenticação.gov) deixa um
 * dicionário de assinatura com /ByteRange — chave que só existe aí e que fica
 * sempre fora dos object streams, para se poder calcular o que foi assinado.
 */
export const temAssinaturaDigital = (pdf: Buffer) => pdf.includes("/ByteRange");

// ── Escrita ─────────────────────────────────────────────────────────────────

/** Os estados em que o processo ainda se mexe. */
const ABERTOS: InfracaoEstado[] = ["por_identificar", "gerada", "assinada"];

export type EscritaInfracao = { ok: true; infracao: Infracao } | { ok: false; error: string };

/**
 * Cria ou atualiza a linha da coima, com a fotografia de mota, dono, condutor e
 * contrato. Depois de gerado, o F306 fixa quem lá está: só um F306 novo (ou o fim
 * dele) muda a fotografia — senão f306Desatualizado deixava de ver a diferença.
 * Ao criar, quem instrui o processo sai do que a coima diz.
 */
export async function gravarInfracao(c: ContextoInfracao, campos: InfracaoEscrita): Promise<EscritaInfracao> {
  const congelar = Boolean(c.infracao?.f306_path) && !("f306_path" in campos);
  const fotografia = congelar
    ? {}
    : {
        veiculo_id: c.despesa.veiculo_id,
        proprietario_id: c.dono?.id ?? null,
        motorista_id: c.condutor?.id ?? null,
        contrato_id: c.contratoId,
        data_infracao: c.despesa.data_infracao,
      };
  if (c.infracao) return atualizarInfracao(c.infracao, { ...fotografia, ...campos });

  // Criar. Se outro pedido a criou entretanto, não se pisa o que ele gravou.
  const { data, error } = await supabaseAdmin
    .from("infracao")
    .upsert(
      {
        despesa_id: c.despesa.id,
        ...regimeDaEntidade(c.despesa.fornecedor),
        ...fotografia,
        ...campos,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "despesa_id", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("identificação: gravar:", error.message);
    return { ok: false, error: "Não consegui gravar o processo da coima." };
  }
  return data ? { ok: true, infracao: data } : { ok: false, error: MENSAGEM_MUDOU };
}

/**
 * Atualiza a linha tal como foi lida: se entretanto mudou (outro separador, outra
 * pessoa, um envio a decorrer) ou fechou, não grava — em vez de desfazer o que a
 * outra ação fez, como reabrir um processo que acabou de seguir para a ANSR.
 */
export async function atualizarInfracao(i: Infracao, campos: InfracaoEscrita): Promise<EscritaInfracao> {
  const { data, error } = await supabaseAdmin
    .from("infracao")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", i.id)
    .eq("updated_at", i.updated_at)
    .in("estado", ABERTOS)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("identificação: atualizar:", error.message);
    return { ok: false, error: "Não consegui gravar o processo da coima." };
  }
  return data ? { ok: true, infracao: data } : { ok: false, error: MENSAGEM_MUDOU };
}

export async function removerFicheirosF306(caminhos: readonly (string | null | undefined)[]): Promise<void> {
  const lista = [...new Set(caminhos.filter(ehCaminhoDoF306))];
  if (!lista.length) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).remove(lista);
  if (error) console.error("identificação: remover ficheiros:", error.message);
}

const COLUNAS_DE_FICHEIRO = ["f306_path", "f306_assinado_path", "comprovativo_path"] as const;

/**
 * Tira um ficheiro carregado pelo browser que não chegou a ficar ligado. O
 * caminho vem do cliente: se alguma linha já o usa — ou na dúvida — fica. Um
 * ficheiro a mais em privado não expõe nada.
 */
export async function removerSeSemUso(caminho: string): Promise<void> {
  const usos = await Promise.all(
    COLUNAS_DE_FICHEIRO.map((coluna) =>
      supabaseAdmin.from("infracao").select("id", { count: "exact", head: true }).eq(coluna, caminho),
    ),
  );
  if (usos.some((u) => u.error || (u.count ?? 0) > 0)) return;
  await removerFicheirosF306([caminho]);
}

/**
 * Um caminho vindo do cliente já pertence a OUTRA coima — ou não se conseguiu
 * confirmar que não pertence. Ligá-lo a esta faria as duas partilhar o ficheiro,
 * e apagá-lo numa apagava-o na outra.
 */
export async function caminhoUsadoPorOutra(caminho: string, infracaoId: string): Promise<boolean> {
  const usos = await Promise.all(
    COLUNAS_DE_FICHEIRO.map((coluna) =>
      supabaseAdmin
        .from("infracao")
        .select("id", { count: "exact", head: true })
        .eq(coluna, caminho)
        .neq("id", infracaoId),
    ),
  );
  return usos.some((u) => u.error || (u.count ?? 0) > 0);
}
