/**
 * O texto das comunicações ao motorista depois de registar uma coima, uma
 * portagem ou uma carta verde: o pedido à IA, os templates para quando ela
 * falha e o texto que segue.
 *
 * O LOCAL nunca vai à IA. O Gemini é um terceiro, e nome + matrícula + data +
 * local de uma contraordenação é o registo completo de uma pessoa identificada
 * (e a leitura do auto pode ter confundido o local com a morada de quem foi
 * notificado). A IA redige sem ele e o servidor junta-o depois, numa linha à
 * parte — como o link da carta verde (textoComLinkDocumento). Os templates não
 * saem do servidor e levam-no na frase.
 *
 * O que já ia à IA antes (nome, matrícula, data e valor) fica como estava, à
 * espera do parecer jurídico.
 *
 * Funções puras, sem Supabase nem Next — testadas em comunicacaoTexto.test.mjs.
 */

export type ComunicacaoTipo = "coima" | "portagem" | "seguro";

/** O que a mensagem diz, SEM o local: é isto que pode ir à IA. */
export interface DadosComunicacao {
  nome: string;
  matricula: string;
  data: string; // formatada, ex. "12/07"; "" quando não se sabe
  valor: string; // já com o €, ex. "2.40 €"; "" quando não se sabe
}

/** O local como segue para o motorista: uma linha, até 120 caracteres. A carta verde não tem. */
export function localDaInfracao(tipo: ComunicacaoTipo, local: string | null | undefined): string {
  if (tipo === "seguro") return "";
  return local?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
}

/**
 * O pedido ao Gemini. Não recebe o local: por construção, não o pode mandar.
 * `comLocal` só avisa a IA de que há uma linha do local a seguir, para não o
 * dar por desconhecido nem o inventar.
 */
export function promptComunicacao(
  tipo: ComunicacaoTipo,
  idioma: string,
  d: DadosComunicacao,
  comLocal: boolean,
): string {
  const de = d.data ? `, de ${d.data}` : "";
  const noValor = d.valor ? `, no valor de ${d.valor}` : "";
  // Contexto por tipo (o que a mensagem deve dizer).
  const contexto: Record<ComunicacaoTipo, string> = {
    coima: `a GoScooters recebeu uma coima/multa de trânsito da mota ${d.matricula}${de}${noValor}. Este montante fica na conta do motorista.`,
    portagem: `há uma portagem por pagar da mota ${d.matricula}${de}${noValor}. Este montante fica na conta do motorista.`,
    seguro: `há um novo comprovativo de seguro (carta verde) da mota ${d.matricula}. Pede para guardar o documento (o link vai a seguir).`,
  };
  // Coima/portagem vão sem documento: a IA não pode prometer um anexo que não segue.
  const semAnexo = tipo === "seguro" ? "" : "\nNão incluas links nem digas que segue um documento ou anexo.";
  const linhaDoLocal =
    tipo !== "seguro" && comLocal ? "\nO local vai numa linha à parte, a seguir ao texto: não o menciones." : "";

  return `Escreve UMA mensagem curta de WhatsApp, no idioma ${idioma}, da equipa GoScooters (aluguer de scooters em Lisboa) para o motorista ${d.nome}.
Contexto a comunicar: ${contexto[tipo]}
Tom cordial, direto e simples (o motorista pode ser imigrante). Sem assunto, sem assinatura formal, sem parênteses de instrução, sem placeholders. Devolve APENAS o texto da mensagem.${semAnexo}${linhaDoLocal}`;
}

/**
 * Templates sem IA da portagem e da carta verde (o da coima é textoCoima, em
 * lembretes.ts): português para 'pt', inglês para os restantes. Não saem do
 * servidor, por isso a portagem leva o local na frase.
 */
export function textoModeloComunicacao(
  tipo: "portagem" | "seguro",
  d: DadosComunicacao & { local: string },
  idiomaCod: string,
): string {
  const pt = idiomaCod === "pt";
  if (tipo === "portagem") {
    return pt
      ? `Olá ${d.nome}, a GoScooters registou uma portagem da mota ${d.matricula}${d.data ? ` de ${d.data}` : ""}${d.local ? `, em ${d.local}` : ""}${d.valor ? ` — valor ${d.valor}` : ""}. Este montante fica na tua conta. Qualquer dúvida, fala connosco.`
      : `Hi ${d.nome}, GoScooters registered a toll for scooter ${d.matricula}${d.data ? ` on ${d.data}` : ""}${d.local ? ` at ${d.local}` : ""}${d.valor ? ` — amount ${d.valor}` : ""}. This amount is added to your account. Any questions, contact us.`;
  }
  return pt
    ? `Olá ${d.nome}, segue o novo comprovativo de seguro (carta verde) da mota ${d.matricula}. Por favor guarda-o.`
    : `Hi ${d.nome}, here is the new insurance certificate (green card) for scooter ${d.matricula}. Please keep it.`;
}

/**
 * O texto que segue para o motorista. `redigido` = o que a IA escreveu (sem ter
 * visto o local), ou null se ela falhou; aí vai o `modelo`, que já traz o local
 * na frase. Ao texto da IA junta-se o local numa linha com 📍 — lê-se em
 * qualquer idioma, sem traduzir um rótulo.
 */
export function textoParaMotorista(redigido: string | null, modelo: string, local: string): string {
  const texto = redigido?.trim();
  if (!texto) return modelo.trim();
  return local ? `${texto}\n📍 ${local}` : texto;
}
