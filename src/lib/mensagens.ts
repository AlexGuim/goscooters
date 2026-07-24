/**
 * Mensagens ao motorista na sua língua (o convite para preparar a entrega).
 * WhatsApp/Unicode, por isso as escritas não-latinas são seguras aqui.
 * Rascunhos razoáveis — afináveis; línguas sem modelo caem no inglês.
 */
type Modelo = (nome: string, link: string) => string;

const N = (nome: string) => (nome ? ` ${nome.split(" ")[0]}` : "");

const LINK: Record<string, Modelo> = {
  pt: (n, l) => `Olá${N(n)}! Para preparar a entrega da tua mota GoScooters, abre este link e segue os passos: ${l}`,
  en: (n, l) => `Hi${N(n)}! To prepare your GoScooters scooter handover, open this link and follow the steps: ${l}`,
  es: (n, l) => `¡Hola${N(n)}! Para preparar la entrega de tu moto GoScooters, abre este enlace y sigue los pasos: ${l}`,
  fr: (n, l) => `Bonjour${N(n)} ! Pour préparer la remise de votre scooter GoScooters, ouvrez ce lien et suivez les étapes : ${l}`,
  it: (n, l) => `Ciao${N(n)}! Per preparare la consegna del tuo scooter GoScooters, apri questo link e segui i passaggi: ${l}`,
  bn: (n, l) => `হ্যালো${N(n)}! আপনার GoScooters স্কুটার বুঝে নেওয়ার প্রস্তুতির জন্য এই লিঙ্কটি খুলুন এবং ধাপগুলো অনুসরণ করুন: ${l}`,
  hi: (n, l) => `नमस्ते${N(n)}! अपने GoScooters स्कूटर की डिलीवरी की तैयारी के लिए यह लिंक खोलें और चरणों का पालन करें: ${l}`,
  ne: (n, l) => `नमस्ते${N(n)}! आफ्नो GoScooters स्कुटर बुझ्ने तयारीका लागि यो लिंक खोल्नुहोस् र चरणहरू पालना गर्नुहोस्: ${l}`,
  ur: (n, l) => `ہیلو${N(n)}! اپنی GoScooters سکوٹر وصول کرنے کی تیاری کے لیے یہ لنک کھولیں اور مراحل پر عمل کریں: ${l}`,
};

export function mensagemLinkEntrega(nome: string, link: string, idioma: string | null | undefined): string {
  const lang = (idioma || "pt").slice(0, 2).toLowerCase();
  return (LINK[lang] ?? LINK.en)(nome, link);
}
