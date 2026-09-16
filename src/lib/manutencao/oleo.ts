/**
 * Manutenção por mota: o cálculo da TROCA DE ÓLEO, puro (ponte até à F6).
 *
 * Sem base de dados, sem 'server-only' e sem relógio. Quem chama lê as tabelas
 * que já existem (moto, km_registo, manutencao e a descrição da despesa ligada) e
 * passa a data de hoje em Lisboa. O mesmo cálculo serve a página da mota, a lista
 * da frota e, mais tarde, os alertas, e testa-se com node --test.
 *
 * Fica num só ficheiro de propósito: os testes importam './oleo.ts' e, sem
 * allowImportingTsExtensions no tsconfig, dois módulos testados só podem partilhar
 * tipos. A composição (leituras → trocas → estado) tem de viver junto das partes.
 *
 * Por ordem:
 *  1. a regra do óleo pelo modelo da mota;
 *  2. o km de hoje, sem as leituras suspeitas;
 *  3. que manutenções são trocas de óleo (pelo tipo ou pelo texto);
 *  4. o estado da mota e a próxima troca prevista;
 *  5. o histórico, com os selos «fora do intervalo» e «repetida?»;
 *  6. se um km escrito à mão entra sem confirmação;
 *  7. os textos do ecrã («vencida há 9 dias», «aos 43.430 km ou a 07/10»).
 */

import type { EstadoOperacional, ManutencaoTipo } from "@/types/db";

// ── Constantes ──────────────────────────────────────────────────────────────
// As tolerâncias ficam aqui, no código. Por modelo só mudam os intervalos da regra.

/** «A aproximar» quando faltam este km ou menos para a próxima troca. */
export const A_APROXIMAR_KM = 250;
/** «A aproximar» quando faltam estes dias ou menos para a próxima troca. */
export const A_APROXIMAR_DIAS = 3;
/** Uma leitura é suspeita se uma leitura de data posterior tiver mais de este km a menos. */
export const RECUO_SUSPEITO_KM = 1000;
/** Acima disto por dia, desde a leitura válida anterior, a leitura é suspeita. */
export const KM_POR_DIA_MAX = 300;
/** O km escrito à mão pode ficar até este km abaixo da última leitura válida. */
export const KM_MANUAL_ABAIXO_MAX = 50;
/** Duas trocas de óleo da mesma mota a estes dias ou menos: «repetida?». */
export const TROCA_REPETIDA_DIAS = 3;
/** Uma troca sem km usa a leitura válida do mesmo dia ou de até estes dias antes. */
export const LEITURA_DA_TROCA_DIAS = 3;

export type EstadoOleo = "vencida" | "a_aproximar" | "ok" | "sem_dados" | "sem_regra";

export const ROTULO_ESTADO_OLEO: Record<EstadoOleo, string> = {
  vencida: "Vencida",
  a_aproximar: "A aproximar",
  ok: "OK",
  sem_dados: "Sem dados",
  sem_regra: "Sem regra",
};
export const TEXTO_KM_POR_CONFIRMAR = "km por confirmar";
export const SELO_FORA_DO_INTERVALO = "fora do intervalo";
export const SELO_REPETIDA = "repetida?";

// ── Datas e números ─────────────────────────────────────────────────────────
// Datas ISO (AAAA-MM-DD) contadas em UTC, para não dependerem do fuso do servidor.

const MS_POR_DIA = 86400000;

function partesIso(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const ehDataIso = (iso: unknown): iso is string => typeof iso === "string" && partesIso(iso) !== null;

/** Dias de `de` até `ate` (negativo se `ate` vier antes). */
function diasEntre(de: string, ate: string): number {
  const a = partesIso(de);
  const b = partesIso(ate);
  if (!a || !b) return Number.NaN;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / MS_POR_DIA);
}

function somarDias(iso: string, dias: number): string {
  const p = partesIso(iso);
  if (!p) return iso;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias)).toISOString().slice(0, 10);
}

/** DD/MM/AAAA, como o dataBR do resto do admin. */
const dataPt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const semAcentos = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const kmValido = (km: unknown): km is number => typeof km === "number" && Number.isFinite(km) && km > 0;

/** 41230 → "41.230". O Intl em pt-PT dava "41 230" e deixava "2200" sem ponto. */
export function formatarKm(km: number): string {
  const n = Math.round(km);
  const digitos = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 ? `-${digitos}` : digitos;
}

// ── 1. Regra do óleo por modelo ─────────────────────────────────────────────

export type RegraOleo = {
  codigo: "pcx" | "jet14";
  nome: string;
  /** Troca a cada `km` quilómetros ou a cada `dias` dias, o que chegar primeiro. */
  km: number;
  dias: number;
  /** Ainda por confirmar com a oficina (a Jet 14 segue o manual SYM da versão a ar). */
  porConfirmar: boolean;
  /** false: enquanto a mota estiver inativa, não se avalia. */
  avaliaInativa: boolean;
};

const REGRA_PCX: RegraOleo = {
  codigo: "pcx",
  nome: "Honda PCX",
  km: 2200,
  dias: 21,
  porConfirmar: false,
  avaliaInativa: true,
};

const REGRA_JET14: RegraOleo = {
  codigo: "jet14",
  nome: "SYM Jet 14",
  km: 1000,
  dias: 21,
  porConfirmar: true,
  avaliaInativa: false,
};

/** «Honda PCX-125 (2019)» → "hondapcx1252019": minúsculas, sem acentos nem separadores. */
export function normalizarModelo(modelo: string | null | undefined): string {
  return semAcentos(modelo ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A regra do óleo do modelo, aceitando as várias grafias; null = «Sem regra». */
export function regraOleoDoModelo(modelo: string | null | undefined): RegraOleo | null {
  const m = normalizarModelo(modelo);
  if (m.includes("jet14")) return { ...REGRA_JET14 };
  if (m.includes("pcx")) return { ...REGRA_PCX };
  return null;
}

// ── 2. Km de hoje ───────────────────────────────────────────────────────────

export type LeituraKm = {
  km: number;
  data: string;
  /** De onde veio: km_registo.fonte, ou 'manutencao' para o km de uma manutenção. */
  fonte?: string | null;
};

/**
 * 'recuo': uma leitura de data posterior tem mais de 1.000 km a menos.
 * 'salto': mais de 300 km por dia desde a leitura válida anterior.
 */
export type MotivoSuspeita = "recuo" | "salto";

export type LeituraClassificada = LeituraKm & {
  suspeita: boolean;
  motivo: MotivoSuspeita | null;
};

/**
 * As leituras de uma mota por data (no mesmo dia, por km), cada uma marcada
 * suspeita ou não:
 *  - recuo: uma leitura de data posterior tem mais de 1.000 km a menos. O
 *    conta-km não anda para trás, por isso a errada é a alta;
 *  - salto: face à leitura VÁLIDA anterior, andou mais de 300 km por dia (no
 *    mesmo dia conta 1 dia). Uma suspeita nunca serve de anterior.
 * Leituras sem km (ou com 0) ou sem data ficam de fora: um 0 por preencher
 * tornava suspeitas todas as leituras anteriores.
 */
export function classificarLeituras(leituras: readonly LeituraKm[]): LeituraClassificada[] {
  const ordenadas = leituras
    .filter((l) => kmValido(l.km) && ehDataIso(l.data))
    .map((l) => ({ ...l, data: l.data.slice(0, 10), suspeita: false, motivo: null as MotivoSuspeita | null }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.km - b.km);

  for (const l of ordenadas) {
    if (ordenadas.some((p) => p.data > l.data && p.km < l.km - RECUO_SUSPEITO_KM)) {
      l.suspeita = true;
      l.motivo = "recuo";
    }
  }

  let anterior: LeituraClassificada | null = null;
  for (const l of ordenadas) {
    if (l.suspeita) continue;
    if (anterior) {
      const dias = Math.max(1, diasEntre(anterior.data, l.data));
      if (l.km - anterior.km > KM_POR_DIA_MAX * dias) {
        l.suspeita = true;
        l.motivo = "salto";
        continue;
      }
    }
    anterior = l;
  }
  return ordenadas;
}

export type KmDaMota = {
  /** A última leitura válida: é o km de hoje. Null sem leituras válidas. */
  ultimaValida: LeituraKm | null;
  /** O km de hoje não é de confiança: a mota só se avalia por tempo e mostra «km por confirmar». */
  porConfirmar: boolean;
};

function resumirKm(classificadas: readonly LeituraClassificada[]): KmDaMota {
  let valida: LeituraClassificada | null = null;
  let indice = -1;
  for (let i = 0; i < classificadas.length; i += 1) {
    if (!classificadas[i].suspeita) {
      valida = classificadas[i];
      indice = i;
    }
  }
  const ultima = classificadas.length > 0 ? classificadas[classificadas.length - 1] : null;
  // Um engano PARA BAIXO torna suspeitas as leituras altas que vêm antes dele, e
  // a regra do recuo culpa sempre a alta. Quando não sobra nenhuma leitura válida
  // antes da que ficou, não há em que apoiar esse km: tanto pode ser o engano
  // agora como leituras a mais antes. Diz-se «km por confirmar», como na gralha
  // para cima, em vez de dar um km baixo por certo.
  const antes = indice > 0 ? classificadas.slice(0, indice) : [];
  const recuoSemApoio = antes.some((l) => l.motivo === "recuo") && antes.every((l) => l.suspeita);
  return {
    ultimaValida: valida ? { km: valida.km, data: valida.data, fonte: valida.fonte ?? null } : null,
    porConfirmar: ultima?.suspeita === true || recuoSemApoio,
  };
}

/** O km de hoje a partir das leituras (de km_registo e, se houver, das manutenções). */
export function kmDeHoje(leituras: readonly LeituraKm[]): KmDaMota {
  return resumirKm(classificarLeituras(leituras));
}

// ── 3. Que manutenções são trocas de óleo ───────────────────────────────────

export type ManutencaoParaOleo = {
  id: string;
  tipo: ManutencaoTipo;
  data: string;
  km: number | null;
  /** Onde procurar o serviço: as observações, a descrição da despesa ligada… */
  textos?: readonly (string | null | undefined)[];
};

/**
 * Como se escreve a troca: «mudança de óleo», «troca do óleo», «trocar o óleo»…
 * e também a escrita curta das oficinas, sem preposição («TROCA OLEO»), que é
 * como a maior parte das faturas o diz.
 */
const VERBOS_TROCA = [
  ...["mudanca", "muda", "troca", "substituicao"].flatMap((v) => [v, `${v} de`, `${v} do`]),
  ...["mudar", "trocar", "substituir"].flatMap((v) => [v, `${v} o`]),
];

/** Nomes do óleo do motor que, sozinhos, dizem o serviço. «Óleo» sozinho não chega. */
const NOMES_OLEO_MOTOR = ["oleo do motor", "oleo de motor", "oleo motor"];

/** Sinónimos inequívocos de uma troca do óleo do MOTOR. */
const OLEO_DO_MOTOR = [
  ...NOMES_OLEO_MOTOR,
  "oleo e filtro",
  "oleo e filtros",
  "filtro e oleo",
  ...VERBOS_TROCA.map((v) => `${v} oleo`),
];

/** O que vem depois de «óleo» quando o óleo é de outra peça. */
const OUTRAS_PECAS = [
  "da transmissao", "de transmissao", "transmissao", "da transmissao final",
  "da caixa", "de caixa", "do diferencial",
  "dos travoes", "de travoes", "do travao", "de travao", "travoes", "travao",
  "da suspensao", "de suspensao", "das suspensoes", "da forqueta", "de forqueta",
];

/**
 * Não contam. O óleo de outra peça vai também com o verbo («troca de óleo da
 * transmissão»), para ser sempre mais comprido do que o sinónimo do motor que
 * contém; e ver o nível do óleo do motor não é trocá-lo.
 */
const NAO_E_TROCA_DO_MOTOR = [
  ...OUTRAS_PECAS.flatMap((p) => [`oleo ${p}`, ...VERBOS_TROCA.map((v) => `${v} oleo ${p}`)]),
  ...["nivel de", "nivel do"].flatMap((n) => NOMES_OLEO_MOTOR.map((o) => `${n} ${o}`)),
];

type Termo = { texto: string; motor: boolean };

const TERMOS: Termo[] = [
  ...OLEO_DO_MOTOR.map((texto) => ({ texto, motor: true })),
  ...NAO_E_TROCA_DO_MOTOR.map((texto) => ({ texto, motor: false })),
];

/** «Mudança de Óleo + Filtro» → "mudanca de oleo e filtro". */
export function normalizarTexto(texto: string | null | undefined): string {
  return semAcentos(texto ?? "")
    .toLowerCase()
    .replace(/[+&/]/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type TermoDeOleo = { termo: string; motor: boolean };

/**
 * Os termos de óleo de um texto, pela ordem em que aparecem, só com palavras
 * inteiras. Quando dois se sobrepõem, ganha o mais comprido: em «troca de óleo da
 * transmissão», «troca de óleo da transmissão» tapa «troca de óleo». Num empate,
 * ganha o que não conta.
 */
export function termosDeOleo(texto: string | null | undefined): TermoDeOleo[] {
  const alvo = ` ${normalizarTexto(texto)} `;
  const achados: (Termo & { inicio: number; fim: number })[] = [];
  for (const t of TERMOS) {
    const agulha = ` ${t.texto} `;
    for (let i = alvo.indexOf(agulha); i !== -1; i = alvo.indexOf(agulha, i + 1)) {
      achados.push({ ...t, inicio: i + 1, fim: i + 1 + t.texto.length });
    }
  }
  achados.sort(
    (a, b) => b.texto.length - a.texto.length || Number(a.motor) - Number(b.motor) || a.inicio - b.inicio,
  );
  const escolhidos: typeof achados = [];
  for (const a of achados) {
    if (!escolhidos.some((e) => a.inicio < e.fim && e.inicio < a.fim)) escolhidos.push(a);
  }
  return escolhidos.sort((a, b) => a.inicio - b.inicio).map((a) => ({ termo: a.texto, motor: a.motor }));
}

/**
 * Se a manutenção é uma troca de óleo do motor e porquê: 'tipo' quando tem o tipo
 * «óleo»; 'texto' quando um dos textos tem um sinónimo inequívoco; null se não é.
 */
export function origemTrocaDeOleo(m: Pick<ManutencaoParaOleo, "tipo" | "textos">): "tipo" | "texto" | null {
  if (m.tipo === "oleo") return "tipo";
  return (m.textos ?? []).some((t) => termosDeOleo(t).some((x) => x.motor)) ? "texto" : null;
}

/** O km de uma manutenção também é uma leitura do conta-km, e entra na série. */
function leiturasDaMota(
  leituras: readonly LeituraKm[],
  manutencoes: readonly ManutencaoParaOleo[],
): LeituraKm[] {
  const dasManutencoes: LeituraKm[] = [];
  for (const m of manutencoes) {
    if (kmValido(m.km)) dasManutencoes.push({ km: m.km, data: m.data, fonte: "manutencao" });
  }
  return [...leituras, ...dasManutencoes];
}

/**
 * O km de uma manutenção para as contas: o dela, se essa leitura não for
 * suspeita; senão, a leitura válida mais recente do mesmo dia ou de até 3 dias
 * antes. A fatura grava o km em km_registo, mas a manutenção criada a partir da
 * despesa não o copia.
 */
function kmDaManutencao(m: ManutencaoParaOleo, classificadas: readonly LeituraClassificada[]): number | null {
  const data = m.data.slice(0, 10);
  if (kmValido(m.km) && classificadas.some((l) => l.data === data && l.km === m.km && !l.suspeita)) {
    return m.km;
  }
  let km: number | null = null;
  for (const l of classificadas) {
    const dias = diasEntre(l.data, data);
    if (!l.suspeita && dias >= 0 && dias <= LEITURA_DA_TROCA_DIAS) km = l.km; // por ordem: fica a mais recente
  }
  return km;
}

export type TrocaOleo = {
  manutencaoId: string;
  data: string;
  /** Null quando não há km fiável: a próxima troca fica só pela data. */
  km: number | null;
  origem: "tipo" | "texto";
};

function trocasDeOleo(
  manutencoes: readonly ManutencaoParaOleo[],
  classificadas: readonly LeituraClassificada[],
): TrocaOleo[] {
  const trocas: TrocaOleo[] = [];
  for (const m of manutencoes) {
    if (!ehDataIso(m.data)) continue;
    const origem = origemTrocaDeOleo(m);
    if (origem) {
      trocas.push({ manutencaoId: m.id, data: m.data.slice(0, 10), km: kmDaManutencao(m, classificadas), origem });
    }
  }
  return trocas.sort((a, b) => a.data.localeCompare(b.data) || (a.km ?? -1) - (b.km ?? -1));
}

// ── 4. Estado da mota e próxima troca ───────────────────────────────────────

export type ProximaTroca = { km: number | null; data: string };

/** A próxima troca prevista: km da troca + intervalo, e data da troca + dias. */
export function proximaTroca(
  regra: Pick<RegraOleo, "km" | "dias">,
  troca: { km: number | null; data: string },
): ProximaTroca {
  return { km: kmValido(troca.km) ? troca.km + regra.km : null, data: somarDias(troca.data, regra.dias) };
}

export type EntradaOleo = {
  modelo: string | null;
  estadoOperacional: EstadoOperacional;
  /** As leituras de km_registo da mota. */
  leituras: readonly LeituraKm[];
  manutencoes: readonly ManutencaoParaOleo[];
  /** A data de hoje em Lisboa (AAAA-MM-DD). */
  hoje: string;
};

export type AvaliacaoOleo = {
  estado: EstadoOleo;
  regra: RegraOleo | null;
  km: KmDaMota;
  ultimaTroca: TrocaOleo | null;
  proxima: ProximaTroca | null;
  /** km até à próxima troca (0 ou negativo: vencida). Null quando não se avalia por km. */
  faltaKm: number | null;
  /** Dias até à próxima troca (negativo: vencida). Null quando não há troca avaliada. */
  faltaDias: number | null;
  /** A troca já passou (de data ou de km). Numa mota parada isso não é «Vencida», mas também não é «OK». */
  passou: boolean;
  /** Nunca houve troca de óleo registada nesta mota: é falta de registo, não atraso. */
  semRegisto: boolean;
};

/**
 * O estado do óleo de uma mota:
 *  - sem regra para o modelo: «Sem regra»;
 *  - Jet 14 inativa: não se avalia («Sem dados»);
 *  - sem troca registada: «Sem registo», contada à parte — nunca «Vencida»;
 *  - com troca: Vencida quando passou a data ou chegou ao km; A aproximar a 3
 *    dias ou 250 km; OK. Só as ocupadas ficam Vencida ou A aproximar; as outras
 *    ficam OK, com a próxima troca à vista.
 * Com a última leitura suspeita não se conta o km: só a data.
 */
export function avaliarOleo(e: EntradaOleo): AvaliacaoOleo {
  const classificadas = classificarLeituras(leiturasDaMota(e.leituras, e.manutencoes));
  const km = resumirKm(classificadas);
  const trocas = trocasDeOleo(e.manutencoes, classificadas);
  const ultimaTroca = trocas.length > 0 ? trocas[trocas.length - 1] : null;
  const regra = regraOleoDoModelo(e.modelo);
  const semContas = { regra, km, ultimaTroca, proxima: null, faltaKm: null, faltaDias: null, passou: false, semRegisto: false };

  if (!regra) return { estado: "sem_regra", ...semContas };
  if (e.estadoOperacional === "inativo" && !regra.avaliaInativa) return { estado: "sem_dados", ...semContas };
  const ocupada = e.estadoOperacional === "ocupado";
  // Sem NENHUMA troca registada não é atraso: é falta de registo (faltam faturas
  // antigas). Marcá-la «Vencida» enchia a lista que abre primeiro e ensinava a
  // ignorá-la. Fica «Sem registo», contada à parte.
  if (!ultimaTroca) return { estado: "sem_dados", ...semContas, semRegisto: true };

  const proxima = proximaTroca(regra, ultimaTroca);
  const faltaDias = diasEntre(e.hoje, proxima.data);
  const kmAtual = km.porConfirmar ? null : (km.ultimaValida?.km ?? null);
  const faltaKm = proxima.km != null && kmAtual != null ? proxima.km - kmAtual : null;

  let estado: EstadoOleo = "ok";
  if (ocupada) {
    if (faltaDias < 0 || (faltaKm != null && faltaKm <= 0)) estado = "vencida";
    else if (faltaDias <= A_APROXIMAR_DIAS || (faltaKm != null && faltaKm <= A_APROXIMAR_KM)) {
      estado = "a_aproximar";
    }
  }
  const passou = faltaDias < 0 || (faltaKm != null && faltaKm <= 0);
  return { estado, regra, km, ultimaTroca, proxima, faltaKm, faltaDias, passou, semRegisto: false };
}

/**
 * O que se lê no selo do estado. Uma mota parada nunca fica «Vencida» — é a regra
 * —, mas também não pode ficar verde a dizer «OK» com um «passou há 24 dias» ao
 * lado: fica «Parada», e o selo perde o verde (BadgeOleo).
 */
export function rotuloEstadoOleo(a: Pick<AvaliacaoOleo, "estado" | "passou" | "semRegisto">): string {
  if (a.semRegisto) return "Sem registo";
  return a.estado === "ok" && a.passou ? "Parada" : ROTULO_ESTADO_OLEO[a.estado];
}

// ── 5. Histórico ────────────────────────────────────────────────────────────

export type LinhaHistorico = {
  manutencaoId: string;
  data: string;
  km: number | null;
  /** «Óleo do motor», «Pneu (trás)», «Revisão + óleo do motor»… */
  servico: string;
  trocaDeOleo: boolean;
  /** Só nas trocas de óleo, contados desde a troca de óleo anterior. */
  kmDesdeAnterior: number | null;
  diasDesdeAnterior: number | null;
  /** «+2.180 km / 20 dias desde a anterior» */
  desdeAnterior: string | null;
  /** A troca veio depois do intervalo da regra: mais km ou mais dias desde a anterior. */
  foraDoIntervalo: boolean;
  /** Há outra troca de óleo da mesma mota a 3 dias ou menos. */
  repetida: boolean;
  /** O km que ficou gravado na manutenção quando foi posto de lado por suspeito. */
  kmRegistadoSuspeito: number | null;
};

const ROTULO_TIPO: Record<ManutencaoTipo, string> = {
  revisao: "Revisão",
  oleo: "Óleo do motor",
  pneu_frente: "Pneu (frente)",
  pneu_tras: "Pneu (trás)",
  pneus: "Pneus (ambos)",
  travoes: "Travões",
  corrente: "Corrente",
  inspecao: "Inspeção",
  outro: "Outro",
};

function servicoDe(tipo: ManutencaoTipo, trocaDeOleo: boolean): string {
  if (trocaDeOleo && (tipo === "oleo" || tipo === "outro")) return "Óleo do motor";
  const rotulo = ROTULO_TIPO[tipo] ?? "Outro";
  return trocaDeOleo ? `${rotulo} + óleo do motor` : rotulo;
}

function textoDesdeAnterior(km: number | null, dias: number): string {
  const tempo = `${dias} ${Math.abs(dias) === 1 ? "dia" : "dias"}`;
  const distancia = km == null ? "" : `${km >= 0 ? "+" : ""}${formatarKm(km)} km / `;
  return `${distancia}${tempo} desde a anterior`;
}

/**
 * Por km e data. As linhas sem km ficam no lugar da sua data e as com km ocupam
 * os lugares restantes por ordem de km. Com dados certos, km e data dão a mesma ordem.
 */
function ordenarPorKmEData(linhas: readonly LinhaHistorico[]): LinhaHistorico[] {
  const porData = [...linhas].sort(
    (a, b) =>
      a.data.localeCompare(b.data) || (a.km ?? -1) - (b.km ?? -1) || a.manutencaoId.localeCompare(b.manutencaoId),
  );
  const porKm = porData
    .filter((l) => l.km != null)
    .sort(
      (a, b) =>
        (a.km ?? 0) - (b.km ?? 0) || a.data.localeCompare(b.data) || a.manutencaoId.localeCompare(b.manutencaoId),
    );
  let i = 0;
  return porData.map((l) => (l.km != null ? porKm[i++] : l));
}

/** Todas as manutenções da mota, por km e data, com as contas das trocas de óleo. */
export function historicoManutencao(e: Pick<EntradaOleo, "modelo" | "leituras" | "manutencoes">): LinhaHistorico[] {
  const regra = regraOleoDoModelo(e.modelo);
  const classificadas = classificarLeituras(leiturasDaMota(e.leituras, e.manutencoes));
  const linhas: LinhaHistorico[] = [];
  for (const m of e.manutencoes) {
    if (!ehDataIso(m.data)) continue;
    const trocaDeOleo = origemTrocaDeOleo(m) !== null;
    const km = kmDaManutencao(m, classificadas);
    linhas.push({
      manutencaoId: m.id,
      data: m.data.slice(0, 10),
      km,
      // Sem isto a linha ficava só com a data e parecia que o km nunca tinha sido
      // registado, quando na verdade foi deitado fora por não bater certo.
      kmRegistadoSuspeito: kmValido(m.km) && km !== m.km ? m.km : null,
      servico: servicoDe(m.tipo, trocaDeOleo),
      trocaDeOleo,
      kmDesdeAnterior: null,
      diasDesdeAnterior: null,
      desdeAnterior: null,
      foraDoIntervalo: false,
      repetida: false,
    });
  }

  const ordenadas = ordenarPorKmEData(linhas);
  const trocas = ordenadas.filter((l) => l.trocaDeOleo);
  trocas.forEach((l, i) => {
    const anterior = i > 0 ? trocas[i - 1] : null;
    if (anterior) {
      const dias = diasEntre(anterior.data, l.data);
      const km = l.km != null && anterior.km != null ? l.km - anterior.km : null;
      l.diasDesdeAnterior = dias;
      l.kmDesdeAnterior = km;
      l.desdeAnterior = textoDesdeAnterior(km, dias);
      l.foraDoIntervalo = regra != null && ((km != null && km > regra.km) || dias > regra.dias);
    }
    l.repetida = trocas.some((o) => o !== l && Math.abs(diasEntre(o.data, l.data)) <= TROCA_REPETIDA_DIAS);
  });
  return ordenadas;
}

// ── 6. Km escrito à mão ─────────────────────────────────────────────────────

export type ValidacaoKmManual =
  | { resultado: "aceite" }
  | { resultado: "precisa_confirmacao"; motivo: string; minimo: number; maximo: number }
  | { resultado: "invalido"; motivo: string };

/**
 * Um km escrito à mão (ao terminar o contrato, em «Óleo trocado»…) entra sem
 * perguntas entre a última leitura válida − 50 km e essa leitura + 300 km por
 * cada dia desde ela (no mínimo 1 dia). Fora disso precisa de confirmação: o km
 * gravado passa a ser o km da mota (gatilho fn_km_atual), e um km a mais faz as
 * faturas seguintes deitarem fora as leituras certas.
 */
export function validarKmManual(
  km: number,
  data: string,
  ultimaValida: Pick<LeituraKm, "km" | "data"> | null,
): ValidacaoKmManual {
  if (!Number.isInteger(km) || km <= 0) {
    return { resultado: "invalido", motivo: "O km tem de ser um número inteiro maior do que zero." };
  }
  if (!ultimaValida) return { resultado: "aceite" };

  const desde = diasEntre(ultimaValida.data, data);
  const dias = Number.isFinite(desde) ? Math.max(1, desde) : 1;
  const minimo = ultimaValida.km - KM_MANUAL_ABAIXO_MAX;
  const maximo = ultimaValida.km + KM_POR_DIA_MAX * dias;
  const ultima = `a última leitura (${formatarKm(ultimaValida.km)} km a ${dataPt(ultimaValida.data)})`;

  if (km < minimo) {
    return { resultado: "precisa_confirmacao", motivo: `${formatarKm(km)} km é menos do que ${ultima}.`, minimo, maximo };
  }
  if (km > maximo) {
    return {
      resultado: "precisa_confirmacao",
      motivo: `${formatarKm(km)} km dá mais de ${KM_POR_DIA_MAX} km por dia desde ${ultima}.`,
      minimo,
      maximo,
    };
  }
  return { resultado: "aceite" };
}

/**
 * O que acontece ao km da mota quando se confirma um km escrito à mão. O gatilho
 * fn_km_atual só mexe na mota quando a leitura é a mais recente (new.data >=
 * km_atual_em): registar hoje uma troca ou uma recolha de dias atrás deixa o km
 * atual como está. Sem isto, a caixa de confirmação prometia uma coisa que não
 * acontecia.
 */
export function avisoDoKmConfirmado(
  data: string,
  ultimaValida: Pick<LeituraKm, "km" | "data"> | null,
): string {
  if (ultimaValida && ehDataIso(data) && ehDataIso(ultimaValida.data) && data < ultimaValida.data) {
    return "Fica no histórico da mota, mas não muda o km atual (há leituras mais recentes).";
  }
  return "Ao gravar, passa a ser o km da mota.";
}

/**
 * O km como se escreve num campo: «41230», «41.230» ou «41 230» dão 41230. Campo
 * vazio: null (fica sem km). Outra coisa qualquer («41,5», «abc»): NaN, que o
 * `validarKmManual` recusa com a mesma mensagem de sempre.
 */
export function lerKmEscrito(texto: string | null | undefined): number | null {
  const limpo = (texto ?? "").replace(/[\s.]/g, "");
  if (limpo === "") return null;
  return /^\d+$/.test(limpo) ? Number(limpo) : Number.NaN;
}

/**
 * Já existe uma leitura desta mota neste dia com este km. Gravar outra igual não
 * acrescenta nada — é o mesmo conta-km lido duas vezes (a fatura e o «Óleo trocado»).
 */
export function leituraJaRegistada(
  leituras: readonly Pick<LeituraKm, "km" | "data">[],
  km: number,
  data: string,
): boolean {
  const dia = data.slice(0, 10);
  return leituras.some((l) => l.km === km && ehDataIso(l.data) && l.data.slice(0, 10) === dia);
}

// ── 7. Textos para o ecrã ───────────────────────────────────────────────────

/** DD/MM: a próxima troca é sempre perto, e o ano só ocupava espaço. */
const dataCurtaPt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const unidadeDias = (n: number) => (Math.abs(n) === 1 ? "dia" : "dias");

/** «vencida há 9 dias», «passou há 2 dias», «é hoje», «faltam 5 dias». */
function textoDias(dias: number, vencida: boolean): string {
  const n = Math.abs(dias);
  if (dias < 0) return `${vencida ? "vencida" : "passou"} há ${n} ${unidadeDias(n)}`;
  if (dias === 0) return "é hoje";
  return `${n === 1 ? "falta" : "faltam"} ${n} ${unidadeDias(n)}`;
}

/** «+640 km» quando já passou do km da troca; «faltam 180 km» quando ainda falta. */
function textoKm(km: number): string {
  // No zero certo, «+0 km» lia-se como se nada tivesse acontecido: acabou de chegar.
  if (km === 0) return "chegou ao km";
  return km < 0 ? `+${formatarKm(-km)} km` : `${km === 1 ? "falta" : "faltam"} ${formatarKm(km)} km`;
}

/** A próxima troca: «aos 43.430 km ou a 07/10», ou só «a 07/10» sem km fiável. */
export function textoProximaTroca(proxima: ProximaTroca | null): string | null {
  if (!proxima || !ehDataIso(proxima.data)) return null;
  const data = `a ${dataCurtaPt(proxima.data)}`;
  return kmValido(proxima.km) ? `aos ${formatarKm(proxima.km)} km ou ${data}` : data;
}

/**
 * O estado em poucas palavras, para a coluna Estado da lista e a página da mota:
 *  - vencida: o que já passou — «vencida há 9 dias», «+640 km», ou os dois;
 *  - a aproximar: só o que aperta — «faltam 180 km», «falta 1 dia», «é hoje»;
 *  - OK: «faltam 1.200 km ou 12 dias»; numa mota parada, que nunca fica vencida,
 *    a data já passada aparece como «passou há 5 dias»;
 *  - sem contas: «sem troca registada», «não se avalia enquanto inativa», «sem
 *    regra para o modelo».
 * Com a última leitura suspeita, junta «km por confirmar» — o km não conta.
 */
export function textoEstadoOleo(
  a: Pick<AvaliacaoOleo, "estado" | "km" | "ultimaTroca" | "proxima" | "faltaKm" | "faltaDias">,
): string {
  const partes: string[] = [];
  const dias = a.faltaDias;
  const km = a.faltaKm;

  if (a.estado === "sem_regra") {
    partes.push("sem regra para o modelo");
  } else if (!a.proxima || dias == null) {
    partes.push(a.ultimaTroca ? "não se avalia enquanto inativa" : "sem troca registada");
  } else if (a.estado === "a_aproximar") {
    if (km != null && km <= A_APROXIMAR_KM) partes.push(textoKm(km));
    if (dias <= A_APROXIMAR_DIAS) partes.push(textoDias(dias, false));
  } else {
    const passou = [
      ...(dias < 0 ? [textoDias(dias, a.estado === "vencida")] : []),
      ...(km != null && km <= 0 ? [textoKm(km)] : []),
    ];
    if (passou.length > 0) partes.push(...passou);
    else if (km == null) partes.push(textoDias(dias, false));
    else if (dias > 0) partes.push(`${textoKm(km)} ou ${dias} ${unidadeDias(dias)}`);
    else partes.push(textoKm(km), textoDias(dias, false));
  }

  if (a.km.porConfirmar) partes.push(TEXTO_KM_POR_CONFIRMAR);
  return partes.join(" · ");
}

/** A frase que fecha o «Óleo trocado»: «Próxima troca aos 43.430 km ou a 07/10». */
export function textoAposOleoTrocado(a: Pick<AvaliacaoOleo, "estado" | "proxima" | "ultimaTroca">): string {
  const proxima = textoProximaTroca(a.proxima);
  if (proxima) return `Próxima troca ${proxima}`;
  if (a.estado === "sem_regra") return "Sem próxima troca prevista: o modelo não tem regra do óleo";
  if (a.estado === "sem_dados" && a.ultimaTroca) return "Sem próxima troca prevista enquanto a mota estiver inativa";
  return "Sem próxima troca prevista";
}

// ── 8. Lista da frota ───────────────────────────────────────────────────────

export type FiltroOleo = "vencidas" | "a_aproximar" | "sem_registo" | "todas";

export const ROTULO_FILTRO_OLEO: Record<FiltroOleo, string> = {
  vencidas: "Vencidas",
  a_aproximar: "A aproximar",
  sem_registo: "Sem registo",
  todas: "Todas",
};

export function passaFiltroOleo(a: Pick<AvaliacaoOleo, "estado" | "semRegisto">, filtro: FiltroOleo): boolean {
  if (filtro === "vencidas") return a.estado === "vencida";
  if (filtro === "a_aproximar") return a.estado === "a_aproximar";
  if (filtro === "sem_registo") return a.semRegisto;
  return true;
}

/** Vencidas primeiro, depois as que estão a chegar, as OK e, no fim, as que não se avaliam. */
const ORDEM_ESTADO: Record<EstadoOleo, number> = {
  vencida: 0,
  a_aproximar: 1,
  ok: 2,
  sem_dados: 3,
  sem_regra: 4,
};

/**
 * Quanto aperta, em partes do intervalo da regra, pelo lado que aperta mais: 1 é
 * «falta o intervalo inteiro», 0 é «é agora» e −0,43 é «passou 43% do intervalo».
 * Assim uma vencida há 9 dias (de 21) vem à frente de uma com 640 km a mais (de
 * 2.200), sem comparar km com dias. Uma vencida sem troca registada vai à frente
 * de todas; sem contas para fazer, fica no fim.
 */
export function urgenciaOleo(a: Pick<AvaliacaoOleo, "estado" | "regra" | "faltaKm" | "faltaDias">): number {
  if (!a.regra || a.faltaDias == null) return a.estado === "vencida" ? -Infinity : Infinity;
  const porDias = a.faltaDias / a.regra.dias;
  return a.faltaKm == null ? porDias : Math.min(porDias, a.faltaKm / a.regra.km);
}

/** Para ordenar a lista da frota. Em caso de empate, quem chama desempata (pela matrícula). */
export function compararUrgenciaOleo(
  a: Pick<AvaliacaoOleo, "estado" | "regra" | "faltaKm" | "faltaDias">,
  b: Pick<AvaliacaoOleo, "estado" | "regra" | "faltaKm" | "faltaDias">,
): number {
  const porEstado = ORDEM_ESTADO[a.estado] - ORDEM_ESTADO[b.estado];
  if (porEstado !== 0) return porEstado;
  const ua = urgenciaOleo(a);
  const ub = urgenciaOleo(b);
  // Sem subtrair: −Infinity menos −Infinity dava NaN, e o sort ignorava-o.
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

// ── 9. Km ao terminar o contrato ────────────────────────────────────────────
// A mota volta e o contrato acaba: é a leitura mais fácil de apanhar e a que
// mais falta faz (quase nenhum contrato concluído tem km final). Aqui só se
// decide; quem chama é que grava.

/**
 * A data da leitura da recolha: a do fim do contrato, mas nunca à frente de
 * hoje. O gatilho fn_km_atual grava esta data na mota, e uma data no futuro
 * travava as leituras seguintes. Uma data que não é data fica como está — quem
 * chama é que a recusa.
 */
export function dataDaLeituraDeRecolha(dataFim: string, hoje: string): string {
  if (!ehDataIso(dataFim) || !ehDataIso(hoje)) return dataFim;
  return dataFim > hoje ? hoje : dataFim;
}

/** O que fazer com o «Km na recolha» escrito à mão. */
export type DecisaoKmRecolha =
  | { acao: "sem_km" }
  | { acao: "gravar"; km: number }
  | { acao: "ja_registada"; km: number }
  | { acao: "confirmar"; motivo: string }
  | { acao: "invalido"; motivo: string };

/**
 * Campo vazio: o contrato termina como sempre. Um km fora dos limites do
 * `validarKmManual` pede «Confirmo este km», porque passa a ser o km da mota. Uma
 * leitura igual no mesmo dia não se repete — a vistoria de recolha ou a fatura da
 * oficina podem já a ter gravado.
 */
export function decidirKmDaRecolha(e: {
  /** Já lido com `lerKmEscrito`: null é campo vazio, NaN é o que não é número. */
  km: number | null;
  data: string;
  ultimaValida: Pick<LeituraKm, "km" | "data"> | null;
  leituras: readonly Pick<LeituraKm, "km" | "data">[];
  /** O gestor viu o aviso e confirmou o km. */
  confirmado?: boolean;
}): DecisaoKmRecolha {
  if (e.km == null) return { acao: "sem_km" };

  const validacao = validarKmManual(e.km, e.data, e.ultimaValida);
  if (validacao.resultado === "invalido") return { acao: "invalido", motivo: validacao.motivo };
  if (validacao.resultado === "precisa_confirmacao" && !e.confirmado) {
    return { acao: "confirmar", motivo: validacao.motivo };
  }

  if (leituraJaRegistada(e.leituras, e.km, e.data)) return { acao: "ja_registada", km: e.km };
  return { acao: "gravar", km: e.km };
}

/**
 * A frase que fecha o «Terminar contrato». Diz sempre como ficou o km: sem ele,
 * o intervalo desta mota fica com um buraco até à próxima leitura.
 */
export function textoContratoTerminado(r: { anuladas?: number | null; km?: number | null }): string {
  const partes = ["Contrato terminado."];
  const anuladas = r.anuladas ?? 0;
  if (anuladas > 0) partes.push(`${anuladas} cobrança(s) futura(s) anulada(s).`);
  partes.push(kmValido(r.km) ? `Km na recolha: ${formatarKm(r.km)} km.` : "Sem km na recolha.");
  return partes.join(" ");
}
