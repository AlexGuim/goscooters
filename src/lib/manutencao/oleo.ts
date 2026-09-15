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
 *  6. se um km escrito à mão entra sem confirmação.
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
  /** A última leitura é suspeita: a mota só se avalia por tempo e mostra «km por confirmar». */
  porConfirmar: boolean;
};

function resumirKm(classificadas: readonly LeituraClassificada[]): KmDaMota {
  let valida: LeituraClassificada | null = null;
  for (const l of classificadas) if (!l.suspeita) valida = l;
  const ultima = classificadas.length > 0 ? classificadas[classificadas.length - 1] : null;
  return {
    ultimaValida: valida ? { km: valida.km, data: valida.data, fonte: valida.fonte ?? null } : null,
    porConfirmar: ultima?.suspeita === true,
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

/** Como se escreve a troca: «mudança de óleo», «troca do óleo», «trocar o óleo»… */
const VERBOS_TROCA = [
  ...["mudanca", "muda", "troca", "substituicao"].flatMap((v) => [`${v} de`, `${v} do`]),
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
};

/**
 * O estado do óleo de uma mota:
 *  - sem regra para o modelo: «Sem regra»;
 *  - Jet 14 inativa: não se avalia («Sem dados»);
 *  - sem troca registada: «Vencida» se a mota está ocupada, «Sem dados» se não;
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
  const semContas = { regra, km, ultimaTroca, proxima: null, faltaKm: null, faltaDias: null };

  if (!regra) return { estado: "sem_regra", ...semContas };
  if (e.estadoOperacional === "inativo" && !regra.avaliaInativa) return { estado: "sem_dados", ...semContas };
  const ocupada = e.estadoOperacional === "ocupado";
  if (!ultimaTroca) return { estado: ocupada ? "vencida" : "sem_dados", ...semContas };

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
  return { estado, regra, km, ultimaTroca, proxima, faltaKm, faltaDias };
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
    linhas.push({
      manutencaoId: m.id,
      data: m.data.slice(0, 10),
      km: kmDaManutencao(m, classificadas),
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
