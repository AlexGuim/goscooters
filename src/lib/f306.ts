import "server-only";
import {
  layoutMultilineText,
  PDFDocument,
  PDFName,
  PDFString,
  PDFTextField,
  type PDFFont,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import { F306_PDF_BASE64 } from "@/content/formularios/f306";
import { documentoParaF306, letraLegivel, limparTextoF306, semDiacriticos, type DadosF306 } from "@/lib/f306Texto";

/**
 * Preenche o F306 da ANSR ("Identificação de Condutor", art. 171.º do Código da
 * Estrada) a partir dos dados da plataforma. O texto de cada campo e o que falta
 * estão em f306Texto.ts.
 *
 * Usa o PDF oficial, com os seus campos: o documento que sai é o formulário da
 * ANSR, não uma imitação. Fica EDITÁVEL de propósito — quem assina pode corrigir
 * um campo antes de aplicar a assinatura qualificada (Autenticação.gov), que é o
 * que o fecha.
 *
 * As linhas de assinatura (arguido, mandatário, representante legal) ficam em
 * branco: a assinatura válida é a digital qualificada ou a manuscrita no papel,
 * não texto no campo.
 */

// Os nomes dos campos do PDF da ANSR são gerados (textarea_1kikz…). O mapa segue
// a posição de cada campo no formulário, de cima para baixo.
const CAMPO = {
  numeroAuto: "textarea_1kikz",
  arguidoNome: "textarea_2lyhb",
  arguidoDocumento: "textarea_3apgb",
  arguidoCarta: "textarea_4mngg",
  arguidoNif: "textarea_5wfkt",
  condutorNome: "textarea_6lqsv",
  condutorDomicilio: "textarea_7vjwg",
  condutorDocumento: "textarea_8waey",
  condutorCarta: "textarea_9eljl",
  condutorCartaEmissor: "textarea_10vooc",
  condutorNif: "textarea_11qrxp",
} as const;

type Campo = keyof typeof CAMPO;

/** Os campos que a plataforma preenche — os que um F306 assinado tem de manter iguais ao gerado. */
export const CAMPOS_PREENCHIDOS_F306: readonly string[] = Object.values(CAMPO);

const ROTULO: Record<Campo, string> = {
  numeroAuto: "n.º do auto",
  arguidoNome: "nome do titular",
  arguidoDocumento: "documento do titular",
  arguidoCarta: "carta do titular",
  arguidoNif: "NIF do titular",
  condutorNome: "nome do condutor",
  condutorDomicilio: "morada do condutor",
  condutorDocumento: "documento do condutor",
  condutorCarta: "carta do condutor",
  condutorCartaEmissor: "emissor da carta",
  condutorNif: "NIF do condutor",
};

/** Letras que o formulário não consegue escrever, nem simplificadas (cirílico, por exemplo). */
export class F306LetrasError extends Error {
  /** Como se mostram ao gestor: as que não se veem (um carácter de controlo, uma marca solta) em U+XXXX. */
  readonly letras: string[];

  constructor(
    readonly campo: string,
    letras: string[],
  ) {
    const legiveis = letras.map(letraLegivel);
    super(`F306: o campo ${campo} tem letras que o formulário não aceita: ${legiveis.join(" ")}`);
    this.letras = legiveis;
    this.name = "F306LetrasError";
  }
}

export interface TrocaDeLetras {
  campo: string;
  de: string;
  para: string;
}

/** Até onde descem as letras da Helvetica, em fração do tamanho: o ç e o Ç (o fundo do FontBBox, -225). */
const PERNAS = 0.225;

/**
 * O tamanho da letra com que se desenha um campo: o maior, de 7 pt para baixo às
 * décimas, em que o texto — partido em linhas como o pdf-lib o vai desenhar —
 * fica todo dentro da caixa do campo, pernas das letras incluídas. Numa linha,
 * 7 pt é o que cabe nos 13 pt de altura dos campos do F306; um texto comprido
 * desce até caber numa linha ou, abaixo de 4 pt, em duas.
 */
function tamanhoQueCabe(campo: PDFTextField, widget: PDFWidgetAnnotation, fonte: PDFFont): number {
  const { width, height } = widget.getRectangle();
  // A caixa onde o pdf-lib escreve e que recorta: o retângulo sem a borda e 1 pt de margem.
  const margem = (widget.getBorderStyle()?.getWidth() ?? 0) + 1;
  const caixa = { x: margem, y: margem, width: width - 2 * margem, height: height - 2 * margem };
  const texto = campo.getText() ?? "";
  for (let decimas = 70; decimas > 10; decimas--) {
    const tamanho = decimas / 10;
    const { lines } = layoutMultilineText(texto, {
      alignment: campo.getAlignment(),
      fontSize: tamanho,
      font: fonte,
      bounds: caixa,
    });
    if (lines.every((l) => l.y - PERNAS * tamanho >= caixa.y && l.x + l.width <= caixa.x + caixa.width)) return tamanho;
  }
  return 1;
}

/**
 * Preenche o F306. Os campos do PDF da ANSR usam a Helvetica com a codificação
 * WinAnsi, que tem os acentos do português (ç, ã, é…) mas não letras como Ș, ğ
 * ou ł. Essas escrevem-se sem o sinal (Ș → S) e voltam em `trocas`, para o gestor
 * confirmar no PDF; o que nem assim cabe dá F306LetrasError. Antes disso o texto
 * passa por limparTextoF306 (NFC, espaços e caracteres invisíveis).
 */
export async function preencherF306(d: DadosF306): Promise<{ pdf: Uint8Array; trocas: TrocaDeLetras[] }> {
  const pdf = await PDFDocument.load(Buffer.from(F306_PDF_BASE64, "base64"));
  const form = pdf.getForm();
  const fonte = form.getDefaultFont();
  const cabe = (ch: string) => {
    try {
      fonte.encodeText(ch);
      return true;
    } catch {
      return false;
    }
  };
  const trocas: TrocaDeLetras[] = [];

  const escrever = (campo: Campo, valor: string | null | undefined) => {
    const original = limparTextoF306(valor ?? "");
    if (!original) return;
    let texto = "";
    const semLugar = new Set<string>();
    for (const ch of original) {
      if (cabe(ch)) {
        texto += ch;
        continue;
      }
      const simples = semDiacriticos(ch);
      if (simples !== ch && [...simples].every(cabe)) {
        texto += simples;
        trocas.push({ campo: ROTULO[campo], de: ch, para: simples });
      } else {
        semLugar.add(ch);
      }
    }
    if (semLugar.size) throw new F306LetrasError(ROTULO[campo], [...semLugar]);
    form.getTextField(CAMPO[campo]).setText(texto);
  };

  escrever("numeroAuto", limparTextoF306(d.numeroAuto).replace(/[\s.-]/g, ""));
  escrever("arguidoNome", d.arguido.nome);
  escrever("arguidoDocumento", documentoParaF306(d.arguido.documento));
  escrever("arguidoCarta", d.arguido.carta);
  escrever("arguidoNif", d.arguido.nif);
  escrever("condutorNome", d.condutor.nome);
  escrever("condutorDomicilio", d.condutor.domicilioFiscal);
  escrever("condutorDocumento", documentoParaF306(d.condutor.documento));
  escrever("condutorCarta", d.condutor.carta);
  escrever("condutorCartaEmissor", d.condutor.cartaEmissor);
  escrever("condutorNif", d.condutor.nif);

  // O pdf-lib desenha o texto de cada campo (a aparência, que todos os leitores
  // mostram), mas deixa no /DA a fonte e o tamanho com que o desenhou: a
  // "/Helvetica", que não está no /DR do formulário, num tamanho fixo — quem
  // corrigisse um campo no leitor antes de assinar ficava com o texto cortado.
  // Por isso desenha-se aqui, o /DA volta ao do PDF da ANSR (/Helv, que está no
  // /DR, em tamanho automático) e ao gravar já não se redesenha.
  const DA = PDFName.of("DA");
  const daDaANSR = form
    .getFields()
    .flatMap((campo) => [campo.acroField.dict, ...campo.acroField.getWidgets().map((w) => w.dict)])
    .map((dict) => ({ dict, da: dict.get(DA) }));
  // Em tamanho automático o pdf-lib escolhe 8 pt numa linha, com a linha de base
  // tão em baixo que a caixa corta as pernas das letras: "Conceição" saía
  // "Conceicão" e "Portuguesa" "Portuquesa" no PDF que se assina. Para o desenho,
  // cada campo preenchido leva no /DA o tamanho em que cabe inteiro.
  for (const nome of CAMPOS_PREENCHIDOS_F306) {
    const campo = form.getTextField(nome);
    if (!campo.getText()) continue;
    for (const widget of campo.acroField.getWidgets()) {
      widget.dict.set(DA, PDFString.of(`/Helv ${tamanhoQueCabe(campo, widget, fonte)} Tf 0 0 0 rg`));
    }
  }
  form.updateFieldAppearances(fonte);
  for (const { dict, da } of daDaANSR) {
    if (da) dict.set(DA, da);
    else dict.delete(DA);
  }

  return { pdf: await pdf.save({ updateFieldAppearances: false }), trocas };
}

/**
 * Todos os campos de texto de um F306 — o nome do campo no PDF e o valor, sem
 * espaços nas pontas e em NFC —, para comparar campo a campo o PDF assinado com
 * o gerado. Null quando não é o F306: sem formulário, sem nenhum dos campos dele
 * ou um PDF que não se consegue ler.
 */
export async function camposDoF306(bytes: Uint8Array): Promise<Record<string, string> | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (!pdf.catalog.getAcroForm()) return null;
    const campos = Object.fromEntries(
      pdf
        .getForm()
        .getFields()
        .filter((campo) => campo instanceof PDFTextField)
        .map((campo) => [campo.getName(), (campo.getText() ?? "").normalize("NFC").trim()]),
    );
    return CAMPOS_PREENCHIDOS_F306.some((nome) => Object.hasOwn(campos, nome)) ? campos : null;
  } catch {
    return null;
  }
}

/**
 * Os campos que identificam um F306 já preenchido — para confirmar que o PDF
 * assinado que chega é o desta coima. Null quando não se conseguem ler (um PDF
 * sem os campos, por exemplo).
 */
export async function lerCamposF306(bytes: Uint8Array): Promise<{ numeroAuto: string; condutorNif: string } | null> {
  const campos = await camposDoF306(bytes);
  const numeroAuto = campos?.[CAMPO.numeroAuto];
  const condutorNif = campos?.[CAMPO.condutorNif];
  return numeroAuto === undefined || condutorNif === undefined ? null : { numeroAuto, condutorNif };
}
