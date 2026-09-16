import type { FaltaF306 } from "@/types/infracao";

/**
 * O texto do F306: o que se escreve em cada campo, o que falta para o poder
 * preencher e quem instrui o processo. Sem dependências, nem "server-only" —
 * testado em f306Texto.test.mjs. O preenchimento do PDF está em f306.ts.
 */

/** O documento de identificação como a ficha o guarda. */
export interface DocumentoF306 {
  tipo?: string | null;
  numero?: string | null;
  /** AAAA-MM-DD */
  emissao?: string | null;
  /** AAAA-MM-DD */
  validade?: string | null;
  /** Como impresso no documento. */
  emissor?: string | null;
  /** Nacionalidade (ISO-2): o emissor do passaporte, quando a ficha não diz outro. */
  paisIso2?: string | null;
}

export interface DadosF306 {
  /** N.º do auto de contraordenação (9 dígitos). */
  numeroAuto: string;
  arguido: {
    /** Nome do titular da mota (ou denominação social). */
    nome: string;
    /** Só para pessoa singular. */
    documento: DocumentoF306 | null;
    /** Só para pessoa singular. */
    carta?: string | null;
    nif: string;
  };
  condutor: {
    nome: string;
    domicilioFiscal: string;
    documento: DocumentoF306;
    carta: string;
    cartaEmissor: string;
    nif: string;
  };
}

const TIPO_DOCUMENTO_ROTULO: Record<string, string> = {
  passaporte: "Passaporte",
  titulo_residencia: "Título de residência",
  aima: "Documento AIMA",
};

/** O dia em que a AIMA substituiu o SEF: os títulos de residência emitidos antes são do SEF. */
const INICIO_AIMA = "2023-10-29";

/** "2021-03-04" → "04/03/2021". Vazio se não for uma data AAAA-MM-DD. */
export function dataPT(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim().slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "BR" → "Brasil". O próprio código quando não se conhece. */
export function nomeDoPais(iso2: string | null | undefined): string {
  const pais = (iso2 ?? "").trim().toUpperCase();
  if (!pais) return "";
  try {
    const nome = new Intl.DisplayNames(["pt-PT"], { type: "region" }).of(pais);
    return nome && nome !== pais ? nome : pais;
  } catch {
    return pais;
  }
}

/**
 * Quem emitiu o documento: o que a ficha diz; senão, o que se sabe pelo tipo — a
 * República Portuguesa no Cartão de Cidadão; o SEF ou a AIMA no título de
 * residência, pela data de emissão ("SEF/AIMA" sem ela); o país da nacionalidade
 * no passaporte. Vazio quando não se sabe.
 */
export function emissorDoDocumento(d: DocumentoF306 | null | undefined): string {
  if (!d) return "";
  const escrito = (d.emissor ?? "").trim();
  if (escrito) return escrito;
  switch (d.tipo) {
    case "cc":
      return "República Portuguesa";
    case "titulo_residencia":
    case "aima": {
      if (!dataPT(d.emissao)) return "SEF/AIMA";
      return (d.emissao ?? "").slice(0, 10) < INICIO_AIMA ? "SEF" : "AIMA";
    }
    case "passaporte":
      return nomeDoPais(d.paisIso2);
    default:
      return "";
  }
}

/**
 * O campo do F306 chama-se "Número Cartão do Cidadão", mas a lei pede o número do
 * documento legal de identificação, a data e o serviço emissor (art. 171.º, n.º 1,
 * al. c)). O formulário não tem onde pôr os outros dois, por isso vão os três no
 * mesmo campo: "Passaporte n.º X · emitido em 04/03/2021 · emissor: Brasil". Sem
 * a data de emissão, vai a validade. Quem não tem CC leva o tipo à frente, para a
 * ANSR não ler o número como o de um CC.
 */
export function documentoParaF306(d: DocumentoF306 | null | undefined): string {
  const numero = (d?.numero ?? "").trim();
  if (!d || !numero) return "";
  const rotulo = d.tipo ? TIPO_DOCUMENTO_ROTULO[d.tipo] : undefined;
  const emissao = dataPT(d.emissao);
  const validade = dataPT(d.validade);
  const emissor = emissorDoDocumento(d);
  return [
    rotulo ? `${rotulo} n.º ${numero}` : numero,
    emissao ? `emitido em ${emissao}` : validade ? `válido até ${validade}` : "",
    emissor ? `emissor: ${emissor}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Serviço emissor da carta: o IMT para cartas portuguesas; o país para as estrangeiras. */
export function emissorDaCarta(paisIso2: string | null | undefined): string {
  const pais = (paisIso2 ?? "").trim().toUpperCase();
  if (!pais) return "";
  return pais === "PT" ? "IMT, I.P." : nomeDoPais(pais);
}

/**
 * Quem instrui o processo, pelo que a coima diz de quem a levantou. As
 * contraordenações do Código da Estrada são da ANSR (autos da PSP, da GNR ou da
 * própria ANSR); o estacionamento nos municípios que ficaram com essa competência
 * (EMEL, câmaras, polícias municipais) segue com a entidade e o formulário dela.
 * É só o ponto de partida: o gestor pode mudar.
 */
export function regimeDaEntidade(fornecedor: string | null | undefined): { regime: "ansr" | "outro"; entidade: string } {
  const f = (fornecedor ?? "").trim();
  const municipal = /\bEMEL\b|c[âa]mara|munic[ií]p|pol[ií]cia municipal/i;
  const nacional = /\bANSR\b|\bPSP\b|\bGNR\b|seguran[çc]a rodovi[áa]ria|pol[ií]cia de seguran[çc]a|guarda nacional/i;
  if (f && municipal.test(f) && !nacional.test(f)) return { regime: "outro", entidade: f.slice(0, 120) };
  return { regime: "ansr", entidade: "ANSR" };
}

const SEM_DECOMPOSICAO: Record<string, string> = { ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", ħ: "h", Ħ: "H" };

/** "Ștefan Yılmaz" → "Stefan Yilmaz": tira os sinais diacríticos e troca as letras que não se decompõem. */
export function semDiacriticos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁđĐıħĦ]/g, (ch) => SEM_DECOMPOSICAO[ch] ?? ch);
}

/**
 * O texto de um campo como vai para o F306. Sem os caracteres invisíveis de
 * formatação (marcas de direção, espaço de largura zero, BOM…), em NFC — o "ã" de
 * um "João" colado de um Mac chega como "a" + til e, letra a letra, perdia o til —,
 * com os espaços esquisitos (não separável, fino, estreito) e as quebras de linha
 * como um espaço normal, os hífenes U+2010/U+2011 como "-", sem espaços repetidos
 * nem nas pontas.
 */
export function limparTextoF306(texto: string): string {
  return texto
    .replace(/\p{Cf}/gu, "")
    .normalize("NFC")
    .replace(/[\p{Zs}\t\n\v\f\r\u0085\u2028\u2029]/gu, " ")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Uma letra como se mostra ao gestor: as que não se veem sozinhas (controlo,
 * espaço, marca combinante, uso privado…) como U+XXXX, para as encontrar na ficha.
 */
export function letraLegivel(letra: string): string {
  if (!/^[\p{C}\p{Z}\p{M}]/u.test(letra)) return letra;
  return `U+${(letra.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * O que falta para o F306, por pessoa, para mostrar ao gestor antes de gerar.
 * Do condutor, a lei pede tudo o que o art. 171.º, n.º 1, enumera — incluindo a
 * data e o emissor do documento. Do arguido singular, o documento e a carta
 * ajudam a ANSR a encontrar o processo, mas o nome, o NIF e o n.º do auto chegam:
 * não impedem gerar.
 */
export function camposEmFaltaF306(d: DadosF306, arguidoSingular: boolean): FaltaF306[] {
  const vazio = (v: string | null | undefined) => !v || !v.trim();
  const faltam: FaltaF306[] = [];
  const falta = (quem: FaltaF306["quem"], campo: string, obrigatorio = true) =>
    faltam.push({ quem, campo, obrigatorio });

  if (!/^\d{9}$/.test(d.numeroAuto.replace(/[\s.-]/g, ""))) falta("auto", "n.º do auto (9 dígitos)");

  if (vazio(d.arguido.nome)) falta("arguido", "nome");
  if (vazio(d.arguido.nif)) falta("arguido", "NIF");
  if (arguidoSingular && vazio(d.arguido.documento?.numero)) falta("arguido", "documento de identificação", false);
  if (arguidoSingular && vazio(d.arguido.carta)) falta("arguido", "carta de condução", false);

  if (vazio(d.condutor.nome)) falta("condutor", "nome");
  if (vazio(d.condutor.domicilioFiscal)) falta("condutor", "morada");
  const doc = d.condutor.documento;
  if (vazio(doc.numero)) {
    falta("condutor", "documento de identificação");
  } else {
    if (!dataPT(doc.emissao) && !dataPT(doc.validade)) falta("condutor", "data de emissão do documento");
    else if (!dataPT(doc.emissao)) falta("condutor", "data de emissão do documento (vai a validade)", false);
    if (!emissorDoDocumento(doc)) falta("condutor", "emissor do documento");
  }
  if (vazio(d.condutor.carta)) falta("condutor", "carta de condução");
  if (vazio(d.condutor.cartaEmissor)) falta("condutor", "país da carta");
  if (vazio(d.condutor.nif)) falta("condutor", "NIF");
  return faltam;
}
