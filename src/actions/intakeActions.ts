"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import {
  classificarDocumentoGemini,
  geminiConfigurado,
  mimeDoCaminho,
  type DocClassificado,
} from "@/lib/gemini";
import { encontrarMatricula } from "@/lib/matriculas";
import { AVISO_FICOU_NO_PUBLICO } from "@/lib/documentoDespesa";
import { guardarInfracaoEmPrivado, urlDocumentoParaAdmin } from "@/lib/documentoDespesaServidor";
import { tirarDoPublicoNaAnalise } from "@/lib/limpezaCarregamentos";
import { moverDocumentoParaPrivado } from "@/actions/fotoActions";
import type { ImputarA } from "@/types/db";

/**
 * Intake inteligente: um documento carregado (imagem ou PDF) é lido e
 * CLASSIFICADO pela IA (Gemini visão), e o servidor enriquece com dados da frota
 * (veículo por matrícula, dono, e — para portagem/coima — que motorista tinha a
 * moto na data). NÃO grava nada — devolve tudo pré-preenchido para o admin
 * confirmar com um clique (a confirmação reaproveita gravarDespesaDeFatura /
 * criarSeguro / criarManutencao).
 */

// Quem costuma suportar cada tipo de custo (default do cartão de revisão).
const IMPUTAR_PADRAO: Partial<Record<DocClassificado["tipo"], ImputarA>> = {
  manutencao: "proprietario",
  apolice_seguro: "proprietario",
  portagem: "motorista",
  coima: "motorista",
  fatura: "goscooters",
  outro: "goscooters",
};

export interface IntakeResultado {
  doc: DocClassificado;
  /**
   * O que a despesa guarda em `detalhe.documento_url`: o URL público (faturas)
   * ou, numa coima/portagem, o CAMINHO no bucket privado (`infracoes/…`). Num
   * comprovativo de pagamento é o caminho `comprovativos/…` — segue para
   * lerComprovativoPagamento e `pagamento.comprovativo_url`, não para uma despesa.
   */
  documento_url: string;
  /** Para abrir o ficheiro na revisão: o URL público, ou um URL assinado (expira). */
  documento_ver: string | null;
  veiculo: { id: string; matricula: string | null; modelo: string } | null;
  proprietario: { id: string; nome: string; eh_goscooters: boolean } | null;
  /** Só para portagem/coima: motorista que tinha a moto na data (do ledger). */
  motorista: { id: string; nome: string; telefone_e164: string | null } | null;
  imputar_a_sugerido: ImputarA;
  duplicado: boolean;
  aviso: string | null;
}

/**
 * Que motorista tinha o veículo numa data — a partir do ledger de cobranças
 * (denormaliza motorista+veículo+período). Prefere a semana PAGA (congela o
 * veículo real; as por-liquidar podem ter sido reapontadas numa troca de moto).
 * Exportada porque também servirá as ferramentas do chat de IA.
 */
export async function quemTinhaAMoto(
  veiculoId: string,
  dataISO: string,
): Promise<{ id: string; nome: string; telefone_e164: string | null } | null> {
  // Endpoint público (Server Action): protege o PII do motorista (nome/telefone).
  const auth = await requireAdminForAction();
  if (!auth.ok) return null;

  const { data } = await supabaseAdmin
    .from("cobranca")
    .select("motorista_id, valor_pago")
    .eq("veiculo_id", veiculoId)
    .eq("tipo", "renda")
    // Uma semana anulada nunca foi devida: o contrato acabou antes, a mota já não estava com ele.
    .neq("estado_liquidacao", "anulada")
    .lte("periodo_inicio", dataISO)
    .gte("periodo_fim", dataISO)
    .order("valor_pago", { ascending: false })
    .limit(1);
  const motoristaId = data?.[0]?.motorista_id;
  if (!motoristaId) return null;
  const { data: m } = await supabaseAdmin
    .from("motorista")
    .select("id, nome, telefone_e164")
    .eq("id", motoristaId)
    .maybeSingle();
  return m ? { id: m.id, nome: m.nome, telefone_e164: m.telefone_e164 ?? null } : null;
}

export async function analisarDocumento(
  path: string,
  documentoUrl: string,
): Promise<{ success: boolean; resultado?: IntakeResultado; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!geminiConfigurado()) {
    return { success: false, error: "A leitura por IA (Gemini) não está configurada neste ambiente." };
  }

  const mime = mimeDoCaminho(path);
  if (!mime.startsWith("image/") && mime !== "application/pdf") {
    return { success: false, error: "Formato não suportado. Usa uma imagem (JPG/PNG) ou PDF." };
  }

  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from("motas").download(path);
  if (dlErr || !blob) {
    console.error("analisarDocumento download error:", dlErr);
    return { success: false, error: "Não consegui abrir o ficheiro carregado." };
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  // Limite prático da chamada inline do Gemini (~20MB no corpo); guardamos folga.
  if (buf.byteLength > 18 * 1024 * 1024) {
    return { success: false, error: "Ficheiro demasiado grande para a IA (máx. ~18 MB)." };
  }

  const doc = await classificarDocumentoGemini([{ mime, base64: buf.toString("base64") }]);
  if (!doc) return { success: false, error: "Não consegui ler o documento. Tenta outra foto/ficheiro." };

  // Coima ou portagem: o aviso/auto traz matrícula, local, hora e a quem foi
  // notificado (nome, NIF, morada). Comprovativo de pagamento: nomes, IBAN e
  // valores de terceiros. Saem do bucket público JÁ — antes da revisão e de um
  // lote inteiro ficar à espera na fila; o comprovativo, antes, só saía quando
  // chegava a vez dele (lerComprovativoPagamento), sem prazo. Qual sai e como
  // decide-o tirarDoPublicoNaAnalise. Falha fechado: se a cópia falhar, o público
  // sai na mesma e o gestor volta a carregar (o ficheiro está-lhe na mão); se o
  // público não sair, não segue — erro com o aviso, e o ecrã tenta tirá-lo outra
  // vez. A despesa guarda o caminho privado da infração (a revisão abre-o por URL
  // assinado); o do comprovativo segue para o painel de pagamento, que o guarda.
  const fora = await tirarDoPublicoNaAnalise(doc.tipo, { path, url: documentoUrl }, {
    guardarInfracao: guardarInfracaoEmPrivado,
    moverComprovativo: (p) => moverDocumentoParaPrivado(p, "comprovativos"),
  });
  if (!fora.ok) {
    return { success: false, error: fora.ficouNoPublico ? `${fora.error} ${AVISO_FICOU_NO_PUBLICO}` : fora.error };
  }
  const documento = fora.documento;
  const documentoVer = await urlDocumentoParaAdmin(documento);

  return { success: true, resultado: await enriquecer(doc, documento, documentoVer) };
}

/** Associa veículo/dono/motorista e sugere quem suporta o custo + deduplicação. */
async function enriquecer(
  doc: DocClassificado,
  documento: string,
  documentoVer: string | null,
): Promise<IntakeResultado> {
  let veiculo: IntakeResultado["veiculo"] = null;
  let proprietario: IntakeResultado["proprietario"] = null;
  let motorista: IntakeResultado["motorista"] = null;
  let aviso: string | null = null;

  if (doc.matricula) {
    const { data: motos } = await supabaseAdmin
      .from("moto")
      .select("id, matricula, matricula_norm, modelo, proprietario_id");
    const match = encontrarMatricula(doc.matricula, motos ?? []);
    if (match) {
      const m = (motos ?? []).find((x) => x.id === match.candidato.id)!;
      veiculo = { id: m.id, matricula: m.matricula, modelo: m.modelo };
      if (match.motivo !== "exata") {
        aviso = `Li a matrícula "${doc.matricula}" e associei a ${m.matricula} por semelhança — confirma o veículo.`;
      }
      if (m.proprietario_id) {
        const { data: dono } = await supabaseAdmin
          .from("proprietario")
          .select("id, nome, eh_goscooters")
          .eq("id", m.proprietario_id)
          .maybeSingle();
        if (dono) proprietario = { id: dono.id, nome: dono.nome, eh_goscooters: !!dono.eh_goscooters };
      }
    } else {
      aviso = `Li a matrícula "${doc.matricula}" mas não a encontrei na frota.`;
    }
  }

  // Portagem/coima: quem tinha a moto na data da infração/utilização.
  if ((doc.tipo === "portagem" || doc.tipo === "coima") && veiculo && doc.data) {
    motorista = await quemTinhaAMoto(veiculo.id, doc.data);
  }

  // Quem suporta o custo: frota própria → GoScooters; senão o default do tipo.
  const imputar_a_sugerido: ImputarA = proprietario?.eh_goscooters
    ? "goscooters"
    : IMPUTAR_PADRAO[doc.tipo] ?? "goscooters";

  // Deduplicação: já existe despesa com o mesmo fornecedor + referência + valor?
  let duplicado = false;
  if (doc.fornecedor && doc.referencia && doc.valor) {
    const { data: ja } = await supabaseAdmin
      .from("despesa")
      .select("id")
      .eq("fornecedor", doc.fornecedor.trim())
      .eq("referencia_externa", doc.referencia.trim())
      .eq("valor", doc.valor)
      .limit(1)
      .maybeSingle();
    duplicado = !!ja;
  }

  return {
    doc,
    documento_url: documento,
    documento_ver: documentoVer,
    veiculo,
    proprietario,
    motorista,
    imputar_a_sugerido,
    duplicado,
    aviso,
  };
}
