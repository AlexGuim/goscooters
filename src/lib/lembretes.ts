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

// Adicionar uma língua = acrescentar uma linha aqui.
const MODELOS: Record<string, Modelo> = {
  pt: (d) =>
    `Olá ${d.nome}, lembrete GoScooters: a renda da mota ${d.matricula} vence amanhã (${d.data}) — valor ${d.valor}. Obrigado!`,
  en: (d) =>
    `Hi ${d.nome}, GoScooters reminder: rent for scooter ${d.matricula} is due tomorrow (${d.data}) — amount ${d.valor}. Thank you!`,
  es: (d) =>
    `Hola ${d.nome}, recordatorio GoScooters: el alquiler de la moto ${d.matricula} vence mañana (${d.data}) — importe ${d.valor}. ¡Gracias!`,
  fr: (d) =>
    `Bonjour ${d.nome}, rappel GoScooters : le loyer du scooter ${d.matricula} est dû demain (${d.data}) — montant ${d.valor}. Merci !`,
  it: (d) =>
    `Ciao ${d.nome}, promemoria GoScooters: il noleggio dello scooter ${d.matricula} scade domani (${d.data}) — importo ${d.valor}. Grazie!`,
  bn: (d) =>
    `হ্যালো ${d.nome}, GoScooters রিমাইন্ডার: ${d.matricula} স্কুটারের ভাড়া আগামীকাল (${d.data}) দিতে হবে — পরিমাণ ${d.valor}। ধন্যবাদ!`,
  hi: (d) =>
    `नमस्ते ${d.nome}, GoScooters रिमाइंडर: स्कूटर ${d.matricula} का किराया कल (${d.data}) देय है — राशि ${d.valor}। धन्यवाद!`,
  ne: (d) =>
    `नमस्ते ${d.nome}, GoScooters सम्झना: स्कुटर ${d.matricula} को भाडा भोलि (${d.data}) तिर्नुपर्छ — रकम ${d.valor}। धन्यवाद!`,
  ur: (d) =>
    `ہیلو ${d.nome}، GoScooters یاد دہانی: سکوٹر ${d.matricula} کا کرایہ کل (${d.data}) واجب الادا ہے — رقم ${d.valor}۔ شکریہ!`,
};

/**
 * Constrói o texto do lembrete. Português ou inglês vão sozinhos; qualquer
 * outra língua conhecida vai acompanhada do inglês (língua de origem + inglês).
 * Línguas sem modelo caem no português.
 */
export function textoLembrete(dados: DadosLembrete, idioma: string | null | undefined): string {
  const lang = (idioma || "pt").slice(0, 2).toLowerCase();
  if (lang === "pt") return MODELOS.pt(dados);
  if (lang === "en") return MODELOS.en(dados);
  const modelo = MODELOS[lang];
  // Língua conhecida → língua de origem + inglês; desconhecida → inglês + português.
  return modelo
    ? `${modelo(dados)}\n${MODELOS.en(dados)}`
    : `${MODELOS.en(dados)}\n${MODELOS.pt(dados)}`;
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
