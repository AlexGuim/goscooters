/**
 * O documento de uma despesa: onde vive e quem o pode abrir.
 *
 * `detalhe.documento_url` (despesa, seguro, manutenção) guarda uma de duas coisas:
 *  - um URL PÚBLICO do bucket "motas" — as faturas normais. O extrato do
 *    parceiro abre-as por esse URL, e é assim que têm de continuar;
 *  - um CAMINHO no bucket "privado" (`infracoes/…`) — os avisos e autos de
 *    coima e de portagem. Trazem matrícula, local, hora e a quem foi notificada
 *    (nome, NIF, morada do dono): não podem ficar legíveis por quem souber o
 *    URL. Só se abrem por URL assinado, gerado no servidor, para um admin.
 *
 * É o padrão dos comprovativos (`pagamento.comprovativo_url` guarda
 * `comprovativos/…`): o nome do campo mantém-se, o prefixo diz onde está.
 *
 * Funções puras, sem Supabase nem Next — testadas em documentoDespesa.test.mjs.
 * A passagem de um aviso para o bucket privado recebe as operações de storage de
 * fora: é a ORDEM entre elas que protege o documento, e testa-se sem rede em
 * documentoDespesaOrdem.test.mjs.
 */

export const BUCKET_PUBLICO = "motas";
export const BUCKET_PRIVADO = "privado";
/** Pasta do bucket privado onde ficam os documentos de coima e de portagem. */
export const PASTA_INFRACOES = "infracoes";

/** Coima e portagem: o documento nunca fica no bucket público. */
export function ehInfracao(categoriaOuTipo: string | null | undefined): boolean {
  return categoriaOuTipo === "coima" || categoriaOuTipo === "portagem";
}

export type RefDocumento =
  | {
      onde: "publico";
      url: string;
      /** Caminho no bucket "motas" — null se o URL não for do nosso storage. */
      caminho: string | null;
    }
  | { onde: "privado"; caminho: string };

const MARCADOR_PUBLICO = `/storage/v1/object/public/${BUCKET_PUBLICO}/`;
const MARCADOR_ASSINADO = "/storage/v1/object/sign/";

/** Caminho de storage aceitável: relativo, sem `..`, `.` nem segmentos vazios. */
function caminhoSeguro(caminho: string): boolean {
  if (!caminho || caminho.startsWith("/") || caminho.includes("\\")) return false;
  return caminho.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

/**
 * `https://…/storage/v1/object/public/motas/faturas/x.pdf` → `faturas/x.pdf`.
 * Null quando não é um URL do bucket público (ou o caminho não é seguro).
 */
export function caminhoDoUrlPublico(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const i = url.indexOf(MARCADOR_PUBLICO);
  if (i === -1) return null;
  const resto = url.slice(i + MARCADOR_PUBLICO.length).split(/[?#]/)[0];
  let caminho: string;
  try {
    caminho = decodeURIComponent(resto);
  } catch {
    return null;
  }
  return caminhoSeguro(caminho) ? caminho : null;
}

/** `infracoes/<ficheiro>` no bucket privado. */
export function ehCaminhoDeInfracao(valor: string): boolean {
  return valor.startsWith(`${PASTA_INFRACOES}/`) && caminhoSeguro(valor);
}

/**
 * Lê o que está guardado em `documento_url`. Um URL http(s) é público; um
 * caminho `infracoes/…` é privado. Qualquer outra coisa dá null — e o que não
 * se reconhece não se mostra (nem como link partido).
 */
export function lerRefDocumento(valor: unknown): RefDocumento | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return { onde: "publico", url: v, caminho: caminhoDoUrlPublico(v) };
  if (ehCaminhoDeInfracao(v)) return { onde: "privado", caminho: v };
  return null;
}

/** O `documento_url` cru de um `detalhe` (JSON), sem o interpretar. */
export function documentoDoDetalhe(detalhe: unknown): string | null {
  if (!detalhe || typeof detalhe !== "object" || Array.isArray(detalhe)) return null;
  const v = (detalhe as { documento_url?: unknown }).documento_url;
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Para quem NÃO é admin (portal do parceiro, extrato e recibo por link) e para
 * o que fica congelado num acerto: só um URL que já é público. Um documento
 * privado não aparece.
 */
export function urlPublicoDoDocumento(valor: unknown): string | null {
  const ref = lerRefDocumento(valor);
  return ref?.onde === "publico" ? ref.url : null;
}

/**
 * Para o parceiro (portal) e as páginas por token: nunca o documento de uma
 * coima/portagem, ESTEJA ONDE ESTIVER — um registo antigo ainda por migrar tem-no
 * no bucket público, e a categoria chega para saber que não é para mostrar.
 */
export function urlDocumentoParaParceiro(categoria: string | null | undefined, valor: unknown): string | null {
  return ehInfracao(categoria) ? null : urlPublicoDoDocumento(valor);
}

/** O que se grava em `documento_url`: o URL público, o caminho privado, ou null. */
export function valorParaGravar(ref: RefDocumento | null): string | null {
  if (!ref) return null;
  return ref.onde === "publico" ? ref.url : ref.caminho;
}

/**
 * Para onde tem de ir o documento, dada a categoria CONFIRMADA pelo gestor (é ela
 * que manda, não a leitura automática):
 *  - "privado": coima/portagem com o ficheiro no bucket público (e é nosso);
 *  - "publico": outra categoria com o ficheiro em privado/infracoes — a leitura
 *    enganou-se, é uma fatura, e o extrato do parceiro abre-a pelo URL;
 *  - "manter": já está onde deve (ou é um link externo, que não é nosso mover).
 */
export function destinoDoDocumento(
  ref: RefDocumento | null,
  categoria: string | null | undefined,
): "manter" | "privado" | "publico" {
  if (ehInfracao(categoria)) return ref?.onde === "publico" && ref.caminho ? "privado" : "manter";
  return ref?.onde === "privado" ? "publico" : "manter";
}

/**
 * Um ficheiro em privado/infracoes só volta ao público se nenhuma OUTRA despesa de
 * coima/portagem o usar. `outras` null = não se conseguiu ler: fica em privado.
 */
export function podeVoltarAoPublico(outras: readonly { categoria?: string | null }[] | null): boolean {
  return !!outras && !outras.some((l) => ehInfracao(l.categoria));
}

/** URL assinado do Supabase Storage (expira) — nunca o URL público permanente. */
export function ehUrlAssinado(url: string | null | undefined): boolean {
  return !!url && /^https:\/\//i.test(url) && url.includes(MARCADOR_ASSINADO) && /[?&]token=/.test(url);
}

/**
 * A mensagem ao motorista, com ou sem o link do documento.
 *  - Coima e portagem: NUNCA levam link — só os dados do auto, que já vão no texto.
 *  - Carta verde: leva o link, mas só se for ASSINADO (expira). Um URL público
 *    permanente não entra, mesmo que chegue aqui por engano.
 */
export function textoComLinkDocumento(texto: string, tipo: string, link: string | null | undefined): string {
  const base = texto.trim();
  if (ehInfracao(tipo) || !ehUrlAssinado(link)) return base;
  return `${base}\n${link}`;
}

// ── Passar o aviso de uma coima/portagem do bucket público para o privado ─────

/** Quando o original de uma coima/portagem não saiu do bucket público: diz-se sempre. */
export const AVISO_FICOU_NO_PUBLICO = 'ATENÇÃO: ficou no bucket público "motas" — apaga-o no Supabase.';

const UUID_INICIAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/**
 * Onde fica a cópia privada: `infracoes/<uuid novo>-<nome>`. O nome perde o uuid
 * do carregamento de propósito — a auditoria do bucket público reconhece um
 * ficheiro pelo uuid, e um original que não chegou a sair tem de lhe aparecer
 * como órfão, não como referenciado pelo caminho privado. Limpo como no upload
 * (sem acentos, espaços nem escapes: um URL antigo pode trazer qualquer nome); a
 * extensão fica, que é por ela que se sabe o tipo do ficheiro.
 */
export function caminhoDaCopiaDeInfracao(caminhoPublico: string, uuid: string): string {
  const nome = (caminhoPublico.split("/").pop() ?? "").replace(UUID_INICIAL, "");
  const extensao = /\.([a-z0-9]{1,8})$/i.exec(nome)?.[1].toLowerCase() ?? null;
  const base = (extensao ? nome.slice(0, -(extensao.length + 1)) : nome)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
    .toLowerCase();
  return `${PASTA_INFRACOES}/${uuid}-${base || "documento"}${extensao ? `.${extensao}` : ""}`;
}

/**
 * As operações de storage de que a passagem para privado precisa. Vêm de fora
 * (documentoDespesaServidor.ts): é a ORDEM entre elas que protege o documento, e
 * assim testa-se sem rede.
 */
export interface OperacoesInfracao {
  /**
   * Descarrega o original do público e grava a cópia em privado. Numa falha,
   * `destino` vem se se chegou a tentar gravar — a cópia pode ter ficado a meio.
   */
  copiar: () => Promise<{ ok: true; destino: string; tamanho: number } | { ok: false; destino?: string }>;
  /** A cópia está em privado, com o tamanho do que se descarregou? */
  confirmarCopia: (destino: string, tamanho: number) => Promise<boolean>;
  /** Tira o original do bucket público. True se saiu. */
  removerPublico: () => Promise<boolean>;
  /** Tira uma cópia privada que não chegou a ficar referida. */
  removerCopia: (destino: string) => Promise<void>;
}

/**
 * Ao CARREGAR (intake, importar fatura): o ficheiro acabou de subir e o gestor
 * tem-no à mão. Falha fechado — nunca se devolve um caminho privado com o
 * original ainda legível por URL:
 *   copiar → confirmar a cópia → tirar o público → só então o caminho.
 * Cópia falhada ou por confirmar: o público sai na mesma (volta-se a carregar) e
 * a cópia a meio também. Público que não sai: a cópia sai (nada a refere) e
 * `publicoFicou` vem a true — quem chama tem de o dizer.
 */
export async function infracaoParaPrivadoAoCarregar(
  op: OperacoesInfracao,
): Promise<{ ok: true; caminho: string } | { ok: false; publicoFicou: boolean }> {
  const c = await op.copiar();
  if (!c.ok || !(await op.confirmarCopia(c.destino, c.tamanho))) {
    const publicoSaiu = await op.removerPublico();
    if (c.destino) await op.removerCopia(c.destino);
    return { ok: false, publicoFicou: !publicoSaiu };
  }
  if (!(await op.removerPublico())) {
    await op.removerCopia(c.destino);
    return { ok: false, publicoFicou: true };
  }
  return { ok: true, caminho: c.destino };
}

/** Porque é que o original ficou no público depois de a linha estar gravada. */
export type OriginalNoPublico = "outras_linhas" | "remocao_falhou";

/**
 * Ao GRAVAR (editar uma despesa, gravar a partir de uma fatura): pode ser um
 * registo antigo, com o ÚNICO exemplar no público. A ordem é a do script de
 * migração:
 *   copiar → confirmar a cópia → [quem chama grava a linha] → `confirmar`:
 *   passar as outras linhas para o caminho privado → só então tirar o público.
 * Cópia falhada ou por confirmar: o público fica como estava e a cópia a meio sai.
 * `desfazer` (a gravação falhou) tira só a cópia. `confirmar` devolve null quando
 * o público saiu; senão diz porque ficou. Com outras linhas por passar, o público
 * FICA: tirá-lo partia-lhes o link.
 */
export async function infracaoParaPrivadoAoGravar(
  op: OperacoesInfracao & {
    /** Passa as OUTRAS linhas que usam o original para `destino`. True se ficaram todas. */
    reapontarOutras: (destino: string) => Promise<boolean>;
  },
): Promise<
  | {
      ok: true;
      caminho: string;
      /** Chamar DEPOIS de a linha ficar gravada. */
      confirmar: () => Promise<OriginalNoPublico | null>;
      /** Chamar se a gravação da linha falhar. */
      desfazer: () => Promise<void>;
    }
  | { ok: false }
> {
  const c = await op.copiar();
  if (!c.ok || !(await op.confirmarCopia(c.destino, c.tamanho))) {
    if (c.destino) await op.removerCopia(c.destino);
    return { ok: false };
  }
  const destino = c.destino;
  return {
    ok: true,
    caminho: destino,
    confirmar: async () => {
      if (!(await op.reapontarOutras(destino))) return "outras_linhas";
      return (await op.removerPublico()) ? null : "remocao_falhou";
    },
    desfazer: () => op.removerCopia(destino),
  };
}

/** O aviso para o ecrã quando o original ficou no público depois de gravar. */
export function avisoOriginalNoPublico(caminhoPublico: string, motivo: OriginalNoPublico): string {
  const inicio = `ATENÇÃO: o documento ficou gravado em privado, mas o original continua no bucket público "motas" (${caminhoPublico})`;
  return motivo === "outras_linhas"
    ? `${inicio}: não consegui passar para o caminho privado as outras linhas (seguro ou manutenção) que o usam. Confirma-as antes de o apagar no Supabase.`
    : `${inicio} — apaga-o no Supabase.`;
}

/**
 * A mensagem de um carregamento falhado, depois de o ecrã tentar tirar o ficheiro
 * do público: leva o aviso só se o ficheiro lá ficou mesmo — nem alarme falso (o
 * servidor não o tirou, o ecrã sim), nem silêncio (nem o ecrã o tirou).
 */
export function textoFalhaAoCarregar(texto: string, saiuDoPublico: boolean): string {
  const base = texto.replace(AVISO_FICOU_NO_PUBLICO, "").trim();
  if (saiuDoPublico) return base;
  return base ? `${base} ${AVISO_FICOU_NO_PUBLICO}` : AVISO_FICOU_NO_PUBLICO;
}
