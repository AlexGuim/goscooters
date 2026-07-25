/**
 * Mensagens ao motorista (convites por WhatsApp).
 *
 * Política de língua (pedido do negócio): português para quem tem idioma 'pt'
 * (brasileiros/portugueses); inglês para todos os outros — é a língua franca da
 * base de motoristas. Nada de línguas intermédias.
 */
type Modelo = (nome: string, link: string) => string;

const N = (nome: string) => (nome ? ` ${nome.split(" ")[0]}` : "");

/** true quando a mensagem deve ir em português (idioma 'pt'); senão, inglês. */
const ehPt = (idioma: string | null | undefined) =>
  (idioma || "pt").slice(0, 2).toLowerCase() === "pt";

const LINK_ENTREGA: Record<"pt" | "en", Modelo> = {
  pt: (n, l) => `Olá${N(n)}! Para preparar a entrega da tua mota GoScooters, abre este link e segue os passos: ${l}`,
  en: (n, l) => `Hi${N(n)}! To prepare your GoScooters scooter handover, open this link and follow the steps: ${l}`,
};

export function mensagemLinkEntrega(nome: string, link: string, idioma: string | null | undefined): string {
  return (ehPt(idioma) ? LINK_ENTREGA.pt : LINK_ENTREGA.en)(nome, link);
}

const LINK_REGISTO: Record<"pt" | "en", Modelo> = {
  pt: (n, l) =>
    `Olá${N(n)}! A GoScooters precisa dos teus dados para o aluguer. Abre este link, tira uma foto do teu documento e confirma os dados — leva 2 minutos: ${l}`,
  en: (n, l) =>
    `Hi${N(n)}! GoScooters needs your details to set up your rental. Open this link, take a photo of your ID and confirm your details — it takes 2 minutes: ${l}`,
};

export function mensagemLinkRegisto(nome: string, link: string, idioma: string | null | undefined): string {
  return (ehPt(idioma) ? LINK_REGISTO.pt : LINK_REGISTO.en)(nome, link);
}
