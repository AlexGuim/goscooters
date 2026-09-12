"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { gerarTextoGemini } from "@/lib/gemini";
import { textoCoima, IDIOMAS } from "@/lib/lembretes";
import { textoComLinkDocumento } from "@/lib/documentoDespesa";
import { linkAssinadoParaPartilhar } from "@/lib/documentoDespesaServidor";
import {
  localDaInfracao,
  promptComunicacao,
  textoModeloComunicacao,
  textoParaMotorista,
  type ComunicacaoTipo,
  type DadosComunicacao,
} from "@/lib/comunicacaoTexto";

/**
 * Comunicações ao motorista — o "procedimento padrão" após registar uma coima,
 * portagem ou nova apólice (carta verde). Descobre o motorista, redige a
 * mensagem com a IA no idioma dele (com fallback para template) e devolve o
 * texto + telefone. NÃO envia — o admin revê e envia por WhatsApp (link wa.me),
 * mantendo a regra "prepara, tu confirmas". Os textos (o prompt, os templates e
 * o local que não vai à IA) estão em src/lib/comunicacaoTexto.ts.
 */

interface MotoristaMin {
  id: string;
  nome: string;
  telefone_e164: string | null;
  idioma_preferido: string | null;
}

async function buscarMotorista(id: string): Promise<MotoristaMin | null> {
  const { data } = await supabaseAdmin
    .from("motorista")
    .select("id, nome, telefone_e164, idioma_preferido")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Motorista com contrato ativo na moto (para a carta verde / seguro). */
async function motoristaAtualDaMoto(veiculoId: string): Promise<MotoristaMin | null> {
  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("motorista_id")
    .eq("veiculo_id", veiculoId)
    .in("estado", ["ativo", "pendente_fecho"])
    .order("data_inicio", { ascending: false })
    .limit(1)
    .maybeSingle();
  return c?.motorista_id ? buscarMotorista(c.motorista_id) : null;
}

const nomeIdioma = (cod: string | null | undefined) =>
  IDIOMAS.find((i) => i.valor === (cod || "pt"))?.rotulo ?? "Português";

export interface PrepararComunicacaoInput {
  tipo: ComunicacaoTipo;
  veiculo_id: string;
  motorista_id?: string | null; // conhecido (portagem/coima); senão descobre-se
  matricula?: string | null;
  valor?: string | null; // já em euros, ex. "2.40"
  data?: string | null; // formatada, ex. "12/07"
  /** Só coima/portagem: onde foi a infração ou a passagem, como está no auto. */
  local?: string | null;
  /** O documento guardado. Só a carta verde o envia — e assinado; coima/portagem nunca. */
  documento_url?: string | null;
  idioma?: string | null; // código ISO (pt/en/es…) para redigir; default inglês
}

export interface ComunicacaoPreparada {
  motorista: { id: string; nome: string; telefone_e164: string | null };
  texto: string;
  idioma: string; // nome legível (ex.: "English")
  idioma_cod: string; // código usado (ex.: "en") — para o seletor no cartão
  /** true se veio de template (IA indisponível). */
  fallback: boolean;
}

export async function prepararComunicacao(
  input: PrepararComunicacaoInput,
): Promise<{ success: boolean; dados?: ComunicacaoPreparada; error?: string }> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const m = input.motorista_id
    ? await buscarMotorista(input.motorista_id)
    : await motoristaAtualDaMoto(input.veiculo_id);
  if (!m) return { success: false, error: "Não encontrei o motorista para este veículo/data." };
  if (!m.telefone_e164) {
    return { success: false, error: `${m.nome} não tem telefone registado para enviar a mensagem.` };
  }

  // Âncora do idioma: o override do seletor manda; senão INGLÊS por omissão (a
  // maioria dos motoristas fala inglês; o `idioma_preferido` na BD é 'pt' por
  // defeito e não é fiável). O gestor pode mudar antes de enviar.
  const idiomaCod = (input.idioma || "en").slice(0, 2).toLowerCase();
  const idioma = nomeIdioma(idiomaCod);
  const valor = input.valor ? `${input.valor} €` : "";
  const dados: DadosComunicacao = { nome: m.nome, matricula: input.matricula ?? "?", data: input.data ?? "", valor };
  // Os dados do auto que a mensagem leva: data, local e valor (o documento não vai).
  const local = localDaInfracao(input.tipo, input.local);

  // A IA (um terceiro) redige SEM o local; junta-se a seguir, numa linha à parte.
  // Os templates do fallback sem IA correm aqui e levam-no na frase.
  const redigido = await gerarTextoGemini(promptComunicacao(input.tipo, idioma, dados, Boolean(local)));
  const fallback = !redigido;
  const modelo =
    input.tipo === "coima"
      ? textoCoima({ ...dados, local }, idiomaCod)
      : textoModeloComunicacao(input.tipo, { ...dados, local }, idiomaCod);
  let texto = textoParaMotorista(redigido, modelo, local);

  // O link do documento NÃO é da IA — junta-se aqui, e só à carta verde:
  //  - coima/portagem: nunca. O aviso traz dados de terceiros (a quem foi
  //    notificado, NIF, morada) e a mensagem já leva a data e o valor;
  //  - carta verde: sim, mas ASSINADO (expira) — nunca o URL público permanente,
  //    que ficava para sempre na conversa e em cada reencaminhamento.
  const link = input.tipo === "seguro" ? await linkAssinadoParaPartilhar(input.documento_url) : null;
  texto = textoComLinkDocumento(texto, input.tipo, link);

  return {
    success: true,
    dados: {
      motorista: { id: m.id, nome: m.nome, telefone_e164: m.telefone_e164 },
      texto: texto.trim(),
      idioma,
      idioma_cod: idiomaCod,
      fallback,
    },
  };
}
