"use server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { gerarTextoGemini } from "@/lib/gemini";
import { textoCoima, IDIOMAS } from "@/lib/lembretes";

/**
 * Comunicações ao motorista — o "procedimento padrão" após registar uma coima,
 * portagem ou nova apólice (carta verde). Descobre o motorista, redige a
 * mensagem com a IA no idioma dele (com fallback para template) e devolve o
 * texto + telefone. NÃO envia — o admin revê e envia por WhatsApp (link wa.me),
 * mantendo a regra "prepara, tu confirmas".
 */

export type ComunicacaoTipo = "coima" | "portagem" | "seguro";

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
  documento_url?: string | null; // carta verde / comprovativo
}

export interface ComunicacaoPreparada {
  motorista: { id: string; nome: string; telefone_e164: string | null };
  texto: string;
  idioma: string;
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

  const idioma = nomeIdioma(m.idioma_preferido);
  const matricula = input.matricula ?? "?";
  const valor = input.valor ? `${input.valor} €` : "";

  // Contexto por tipo (o que a mensagem deve dizer).
  const contexto: Record<ComunicacaoTipo, string> = {
    coima: `a GoScooters recebeu uma coima/multa de trânsito da mota ${matricula}${input.data ? `, de ${input.data}` : ""}${valor ? `, no valor de ${valor}` : ""}. Este montante fica na conta do motorista.`,
    portagem: `há uma portagem por pagar da mota ${matricula}${input.data ? `, de ${input.data}` : ""}${valor ? `, no valor de ${valor}` : ""}. Este montante fica na conta do motorista.`,
    seguro: `há um novo comprovativo de seguro (carta verde) da mota ${matricula}. Pede para guardar o documento (o link vai a seguir).`,
  };

  const prompt = `Escreve UMA mensagem curta de WhatsApp, no idioma ${idioma}, da equipa GoScooters (aluguer de scooters em Lisboa) para o motorista ${m.nome}.
Contexto a comunicar: ${contexto[input.tipo]}
Tom cordial, direto e simples (o motorista pode ser imigrante). Sem assunto, sem assinatura formal, sem parênteses de instrução, sem placeholders. Devolve APENAS o texto da mensagem.`;

  let texto = await gerarTextoGemini(prompt);
  let fallback = false;

  if (!texto) {
    // Fallback sem IA: template (coima existe; portagem/seguro em pt/en simples).
    fallback = true;
    const pt = (m.idioma_preferido || "pt").slice(0, 2).toLowerCase() === "pt";
    if (input.tipo === "coima") {
      texto = textoCoima({ nome: m.nome, matricula, data: input.data ?? "", valor }, m.idioma_preferido);
    } else if (input.tipo === "portagem") {
      texto = pt
        ? `Olá ${m.nome}, a GoScooters registou uma portagem da mota ${matricula}${input.data ? ` de ${input.data}` : ""}${valor ? ` — valor ${valor}` : ""}. Este montante fica na tua conta. Qualquer dúvida, fala connosco.`
        : `Hi ${m.nome}, GoScooters registered a toll for scooter ${matricula}${input.data ? ` on ${input.data}` : ""}${valor ? ` — amount ${valor}` : ""}. This amount is added to your account. Any questions, contact us.`;
    } else {
      texto = pt
        ? `Olá ${m.nome}, segue o novo comprovativo de seguro (carta verde) da mota ${matricula}. Por favor guarda-o.`
        : `Hi ${m.nome}, here is the new insurance certificate (green card) for scooter ${matricula}. Please keep it.`;
    }
  }

  // A carta verde vai com o link do documento (nunca dependemos da IA para o URL).
  if (input.tipo === "seguro" && input.documento_url) {
    texto = `${texto.trim()}\n${input.documento_url}`;
  }

  return {
    success: true,
    dados: {
      motorista: { id: m.id, nome: m.nome, telefone_e164: m.telefone_e164 },
      texto: texto.trim(),
      idioma,
      fallback,
    },
  };
}
