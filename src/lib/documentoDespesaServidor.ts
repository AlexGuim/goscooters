import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mimeDoCaminho } from "@/lib/gemini";
import { linhasComDocumento, reapontarDocumento } from "@/lib/documentoUsos";
import {
  AVISO_FICOU_NO_PUBLICO,
  BUCKET_PRIVADO,
  BUCKET_PUBLICO,
  avisoOriginalNoPublico,
  caminhoDaCopiaDeInfracao,
  destinoDoDocumento,
  infracaoParaPrivadoAoCarregar,
  infracaoParaPrivadoAoGravar,
  lerRefDocumento,
  podeVoltarAoPublico,
  valorParaGravar,
  type OperacoesInfracao,
} from "@/lib/documentoDespesa";

/**
 * Abrir e guardar o documento de uma despesa — a parte que fala com o storage.
 *
 * A regra está em documentoDespesa.ts: as faturas vivem no bucket público e
 * abrem-se pelo URL; os avisos de coima e de portagem vivem em
 * `privado/infracoes/` e só se abrem por URL ASSINADO, gerado aqui. Estas funções
 * NÃO verificam a sessão: chamam-se depois de requireAdmin/requireAdminForAction.
 * O portal do parceiro e as páginas abertas por token usam urlDocumentoParaParceiro.
 */

/** Validade de um link aberto num ecrã de admin. */
export const SEGUNDOS_ECRA_ADMIN = 60 * 60;
/** Validade do link da carta verde enviado ao motorista: tempo para a abrir e guardar. */
export const SEGUNDOS_LINK_MOTORISTA = 7 * 24 * 60 * 60;

/** Onde o intake carrega os documentos no bucket público (enviarDocumento). */
const PASTA_CARREGAMENTOS = "faturas/";

const FORA_DOS_CARREGAMENTOS =
  "O documento da coima/portagem não está na pasta de carregamentos — carrega-o outra vez.";

/**
 * URLs para ABRIR documentos num ecrã de admin, pela ordem recebida. Público → o
 * próprio URL; privado → URL assinado (todos num só pedido); não reconhecido ou
 * falha a assinar → null (o link não aparece, em vez de aparecer partido).
 */
export async function urlsDocumentosParaAdmin(
  valores: readonly unknown[],
  segundos = SEGUNDOS_ECRA_ADMIN,
): Promise<(string | null)[]> {
  const refs = valores.map(lerRefDocumento);
  const caminhos = [...new Set(refs.flatMap((r) => (r?.onde === "privado" ? [r.caminho] : [])))];
  const assinados = new Map<string, string>();
  if (caminhos.length) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).createSignedUrls(caminhos, segundos);
    if (error) console.error("urlsDocumentosParaAdmin:", error.message);
    for (const x of data ?? []) {
      if (x.path && x.signedUrl && !x.error) assinados.set(x.path, x.signedUrl);
    }
  }
  return refs.map((r) => (!r ? null : r.onde === "publico" ? r.url : assinados.get(r.caminho) ?? null));
}

export async function urlDocumentoParaAdmin(valor: unknown, segundos = SEGUNDOS_ECRA_ADMIN): Promise<string | null> {
  return (await urlsDocumentosParaAdmin([valor], segundos))[0];
}

/**
 * Link ASSINADO para enviar para fora da app (a carta verde ao motorista). Assina
 * no bucket onde o ficheiro está — também no público: o que sai numa mensagem
 * expira, em vez de ser o URL permanente. Um link que não é do nosso storage não
 * se consegue assinar → null (a mensagem segue sem link).
 */
export async function linkAssinadoParaPartilhar(
  valor: unknown,
  segundos = SEGUNDOS_LINK_MOTORISTA,
): Promise<string | null> {
  const ref = lerRefDocumento(valor);
  if (!ref?.caminho) return null;
  const bucket = ref.onde === "privado" ? BUCKET_PRIVADO : BUCKET_PUBLICO;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(ref.caminho, segundos);
  if (error || !data?.signedUrl) {
    console.error("linkAssinadoParaPartilhar:", error?.message ?? "sem URL");
    return null;
  }
  return data.signedUrl;
}

/**
 * Passa o aviso de uma coima/portagem ACABADO DE CARREGAR de `motas/faturas/…`
 * para `privado/infracoes/…` e devolve o CAMINHO a guardar na despesa. Falha
 * fechado (infracaoParaPrivadoAoCarregar): se a cópia falhar, o público sai na
 * mesma — o gestor tem o ficheiro à mão e volta a carregá-lo —; se o público NÃO
 * sair, não há caminho: erro com o aviso, em vez de um "ok" com o aviso ainda
 * legível por URL (o ecrã tenta tirá-lo mais uma vez). Só mexe na pasta do
 * intake: uma foto de mota com outro caminho não sai do público por engano.
 * Um documento que já estava gravado passa pelo documentoConformeCategoria, que
 * nunca tira o público antes de a cópia estar confirmada e a linha gravada.
 */
export async function guardarInfracaoEmPrivado(
  caminhoPublico: string | null,
): Promise<{ ok: true; caminho: string } | { ok: false; error: string }> {
  if (!caminhoPublico?.startsWith(PASTA_CARREGAMENTOS)) return { ok: false, error: FORA_DOS_CARREGAMENTOS };
  const r = await infracaoParaPrivadoAoCarregar({
    ...operacoesDeCopia(caminhoPublico),
    // Acabada de criar e ainda não devolvida a ninguém: sai sem mais perguntas.
    removerCopia: (destino) => remover(BUCKET_PRIVADO, destino),
  });
  if (r.ok) return r;
  if (r.publicoFicou) console.error(`guardarInfracaoEmPrivado: o original continua no bucket público: ${caminhoPublico}`);
  return {
    ok: false,
    error:
      "Não consegui guardar o documento da coima/portagem em privado — carrega-o outra vez." +
      (r.publicoFicou ? ` ${AVISO_FICOU_NO_PUBLICO}` : ""),
  };
}

export type DocumentoConforme =
  | {
      ok: true;
      /** O que se grava em `documento_url`: URL público, caminho privado ou null. */
      valor: string | null;
      /** O ficheiro mudou de bucket nesta chamada: o valor a gravar é outro. */
      mudou: boolean;
      /**
       * Chamar DEPOIS de a linha ficar gravada. Devolve o aviso a mostrar ao gestor
       * quando o original de uma coima/portagem ficou no bucket público; null se
       * correu tudo bem.
       */
      confirmar: () => Promise<string | null>;
      /** Chamar se a gravação da linha falhar. */
      desfazer: () => Promise<void>;
    }
  | { ok: false; error: string };

const semAviso = async () => null;
const nada = async () => {};

/**
 * Põe o documento no bucket que a categoria CONFIRMADA pede, antes de gravar a
 * linha (despesa nova ou editada, seguro ou manutenção vindos do intake):
 *  - coima/portagem com o ficheiro no público → privado/infracoes, pela ordem do
 *    script de migração (infracaoParaPrivadoAoGravar). Pode ser um registo antigo,
 *    com o ÚNICO exemplar no público: a cópia fica confirmada ANTES de a linha ser
 *    gravada, e se falhar fica tudo como estava. O público só sai no `confirmar`,
 *    depois de as outras linhas com o mesmo URL — a manutenção espelho de uma
 *    despesa reclassificada — passarem para o caminho privado; se não sair, o
 *    `confirmar` devolve o aviso (e fica no log com o caminho). Se a gravação
 *    falhar, o `desfazer` tira só a cópia;
 *  - outra categoria com o ficheiro em privado/infracoes → cópia para
 *    motas/faturas: a leitura enganou-se, é uma fatura, e o extrato do parceiro
 *    abre-a pelo URL. Só se nenhuma OUTRA coima/portagem usar o ficheiro. A cópia
 *    privada sai no `confirmar` (depois de as outras linhas passarem para o URL);
 *    se a gravação falhar, o `desfazer` tira a cópia pública e fica tudo como estava;
 *  - o resto fica como está.
 * `despesaId`: a despesa que se está a editar (não conta como "outra linha").
 */
export async function documentoConformeCategoria(
  valorGuardado: unknown,
  categoria: string | null | undefined,
  despesaId?: string,
): Promise<DocumentoConforme> {
  const ref = lerRefDocumento(valorGuardado);
  const destino = destinoDoDocumento(ref, categoria);

  if (destino === "privado" && ref?.onde === "publico" && ref.caminho) {
    if (!ref.caminho.startsWith(PASTA_CARREGAMENTOS)) return { ok: false, error: FORA_DOS_CARREGAMENTOS };
    const origem = ref.caminho;
    const antigo = ref.url;
    const s = await infracaoParaPrivadoAoGravar({
      ...operacoesDeCopia(origem),
      removerCopia: removerCopiaSemDono,
      reapontarOutras: (caminho) => reapontarDocumento(antigo, caminho, despesaId),
    });
    if (!s.ok) {
      return {
        ok: false,
        error: "Não consegui copiar o documento da coima/portagem para privado — ficou como estava. Tenta outra vez.",
      };
    }
    return {
      ok: true,
      valor: s.caminho,
      mudou: true,
      confirmar: async () => {
        const motivo = await s.confirmar();
        if (!motivo) return null;
        console.error(`documentoConformeCategoria (${motivo}): o original continua no bucket público: ${origem}`);
        return avisoOriginalNoPublico(origem, motivo);
      },
      desfazer: s.desfazer,
    };
  }

  if (destino === "publico" && ref?.onde === "privado") {
    const usos = await linhasComDocumento([ref.caminho]);
    const outras = usos && usos.filter((l) => !(l.tabela === "despesa" && l.id === despesaId));
    if (podeVoltarAoPublico(outras)) {
      const c = await copiarParaFaturas(ref.caminho);
      if (!c.ok) return c;
      const privado = ref.caminho;
      return {
        ok: true,
        valor: c.url,
        mudou: true,
        confirmar: async () => {
          // A cópia privada só sai se nenhuma linha ficar a apontar para ela.
          if (await reapontarDocumento(privado, c.url, despesaId)) await remover(BUCKET_PRIVADO, privado);
          return null;
        },
        desfazer: () => remover(BUCKET_PUBLICO, c.caminho),
      };
    }
  }

  return { ok: true, valor: valorParaGravar(ref), mudou: false, confirmar: semAviso, desfazer: nada };
}

const UUID_INICIAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Copia um ficheiro de privado/infracoes para motas/faturas, com nome novo. Não apaga a origem. */
async function copiarParaFaturas(
  caminhoPrivado: string,
): Promise<{ ok: true; caminho: string; url: string } | { ok: false; error: string }> {
  const { data: blob, error: erroLer } = await supabaseAdmin.storage.from(BUCKET_PRIVADO).download(caminhoPrivado);
  if (erroLer || !blob) {
    console.error("copiarParaFaturas download:", erroLer?.message ?? "sem dados");
    return { ok: false, error: "Não consegui abrir o documento guardado em privado — carrega-o outra vez." };
  }
  const nome = (caminhoPrivado.split("/").pop() ?? "documento").replace(UUID_INICIAL, "") || "documento";
  const destino = `${PASTA_CARREGAMENTOS}${crypto.randomUUID()}-${nome}`;
  const { error: erroGravar } = await supabaseAdmin.storage
    .from(BUCKET_PUBLICO)
    .upload(destino, blob, { contentType: mimeDoCaminho(caminhoPrivado), upsert: false });
  if (erroGravar) {
    console.error("copiarParaFaturas upload:", erroGravar.message);
    return { ok: false, error: "Não consegui passar o documento para as faturas — tenta outra vez." };
  }
  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from(BUCKET_PUBLICO).getPublicUrl(destino);
  return { ok: true, caminho: destino, url: publicUrl };
}

/** As operações de storage das duas ordens (ao carregar, ao gravar), para um original. */
function operacoesDeCopia(caminhoPublico: string): Omit<OperacoesInfracao, "removerCopia"> {
  return {
    copiar: () => copiarParaInfracoes(caminhoPublico),
    confirmarCopia: async (destino, tamanho) => (await tamanhoNoStorage(BUCKET_PRIVADO, destino)) === tamanho,
    removerPublico: () => removerDoPublico(caminhoPublico),
  };
}

/**
 * Copia um original de motas/faturas para privado/infracoes, com nome novo. Não
 * apaga a origem. Como o script: o que se descarregou tem de ter o tamanho que o
 * storage diz que o original tem — uma cópia truncada nunca passa por boa.
 */
async function copiarParaInfracoes(
  caminhoPublico: string,
): Promise<{ ok: true; destino: string; tamanho: number } | { ok: false; destino?: string }> {
  const { data: blob, error: erroLer } = await supabaseAdmin.storage.from(BUCKET_PUBLICO).download(caminhoPublico);
  if (erroLer || !blob) {
    console.error("copiarParaInfracoes download:", erroLer?.message ?? "sem dados");
    return { ok: false };
  }
  const original = await tamanhoNoStorage(BUCKET_PUBLICO, caminhoPublico);
  if (original !== blob.size) {
    console.error(`copiarParaInfracoes: descarreguei ${blob.size} bytes, o storage diz ${original ?? "?"}`);
    return { ok: false };
  }
  const destino = caminhoDaCopiaDeInfracao(caminhoPublico, crypto.randomUUID());
  const { error: erroGravar } = await supabaseAdmin.storage
    .from(BUCKET_PRIVADO)
    .upload(destino, blob, { contentType: mimeDoCaminho(caminhoPublico), upsert: false });
  if (erroGravar) {
    console.error("copiarParaInfracoes upload:", erroGravar.message);
    return { ok: false, destino };
  }
  return { ok: true, destino, tamanho: blob.size };
}

/**
 * Tamanho de um objeto segundo o storage — pela listagem, como o script. Null se
 * não existe ou não se conseguiu ler (na dúvida, nada se dá por confirmado).
 */
async function tamanhoNoStorage(bucket: string, caminho: string): Promise<number | null> {
  const i = caminho.lastIndexOf("/");
  const nome = caminho.slice(i + 1);
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(i === -1 ? "" : caminho.slice(0, i), { search: nome, limit: 100 });
  if (error) {
    console.error(`tamanhoNoStorage (${bucket}):`, error.message);
    return null;
  }
  const objeto = data.find((o) => o.name === nome && o.id);
  const tamanho = Number(objeto?.metadata?.size ?? Number.NaN);
  return Number.isFinite(tamanho) ? tamanho : null;
}

/** Tira do bucket público, com uma segunda tentativa. True se saiu; cada falha fica no log com o caminho. */
async function removerDoPublico(caminho: string): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { error } = await supabaseAdmin.storage.from(BUCKET_PUBLICO).remove([caminho]);
    if (!error) return true;
    console.error(`removerDoPublico (tentativa ${tentativa}) ${caminho}:`, error.message);
  }
  return false;
}

/**
 * Tira a cópia privada que a gravação não chegou a usar. Se afinal há uma linha
 * a apontar para ela (o update deu erro, mas ficou feito), fica — e na dúvida
 * também: uma cópia a mais em privado não expõe nada.
 */
async function removerCopiaSemDono(destino: string): Promise<void> {
  const usos = await linhasComDocumento([destino]);
  if (usos === null || usos.length) {
    console.error(
      `documentoConformeCategoria: a cópia privada fica (${usos ? "já é usada" : "não consegui confirmar que ninguém a usa"}): ${destino}`,
    );
    return;
  }
  await remover(BUCKET_PRIVADO, destino);
}

async function remover(bucket: string, caminho: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(bucket).remove([caminho]);
  if (error) console.error(`documentoDespesaServidor remove (${bucket}):`, error.message);
}
