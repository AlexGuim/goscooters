/**
 * Texto dos lembretes de pagamento, na língua do motorista.
 *
 * Regra (pedido do negócio): enviar na língua de origem do motorista + inglês;
 * ou em português quando não há língua definida. O público é imigrante e
 * WhatsApp/telemóvel-first, por isso a mensagem tem de ser compreensível.
 */

export interface DadosLembrete {
  nome: string;
  matricula: string;
  data: string; // já formatada, ex. "24/07"
  valor: string; // já formatado, ex. "55,00 €"
}

type Modelo = (d: DadosLembrete) => string;

// Política de língua: português para idioma 'pt' (brasileiros/portugueses),
// inglês para todos os outros (língua franca da base de motoristas).
const MODELOS: Record<"pt" | "en", Modelo> = {
  pt: (d) =>
    `Olá ${d.nome}, lembrete GoScooters: a renda da mota ${d.matricula} vence amanhã (${d.data}) — valor ${d.valor}. Obrigado!`,
  en: (d) =>
    `Hi ${d.nome}, GoScooters reminder: rent for scooter ${d.matricula} is due tomorrow (${d.data}) — amount ${d.valor}. Thank you!`,
};

/** true quando o texto deve ir em português (idioma 'pt'); senão, inglês. */
const ehPt = (idioma: string | null | undefined) =>
  (idioma || "pt").slice(0, 2).toLowerCase() === "pt";

export function textoLembrete(dados: DadosLembrete, idioma: string | null | undefined): string {
  return (ehPt(idioma) ? MODELOS.pt : MODELOS.en)(dados);
}

export interface DadosCoima {
  nome: string;
  matricula: string;
  data: string; // data da infração, já formatada
  valor: string; // já formatado
}

type ModeloCoima = (d: DadosCoima) => string;

const MODELOS_COIMA: Record<"pt" | "en", ModeloCoima> = {
  pt: (d) =>
    `Olá ${d.nome}, a GoScooters recebeu uma coima da mota ${d.matricula} referente a ${d.data} — valor ${d.valor}. Este montante fica na tua conta. Qualquer dúvida, fala connosco.`,
  en: (d) =>
    `Hi ${d.nome}, GoScooters received a traffic fine for scooter ${d.matricula} dated ${d.data} — amount ${d.valor}. This amount is added to your account. Any questions, contact us.`,
};

/** Texto da notificação de coima: português para 'pt', inglês para os restantes. */
export function textoCoima(dados: DadosCoima, idioma: string | null | undefined): string {
  return (ehPt(idioma) ? MODELOS_COIMA.pt : MODELOS_COIMA.en)(dados);
}

/** Línguas oferecidas no formulário do motorista. */
export const IDIOMAS: { valor: string; rotulo: string }[] = [
  { valor: "pt", rotulo: "Português" },
  { valor: "en", rotulo: "English" },
  { valor: "es", rotulo: "Español" },
  { valor: "fr", rotulo: "Français" },
  { valor: "it", rotulo: "Italiano" },
  { valor: "bn", rotulo: "বাংলা (Bengali)" },
  { valor: "hi", rotulo: "हिन्दी (Hindi)" },
  { valor: "ne", rotulo: "नेपाली (Nepali)" },
  { valor: "ur", rotulo: "اردو (Urdu)" },
];
