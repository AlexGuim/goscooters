"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminForAction } from "@/lib/dal";
import { criarManutencao } from "@/actions/frotaSaudeActions";
import { dataBR, dataDeHojeEmLisboa } from "@/lib/datas";
import { entradaOleo, lerDadosOleo } from "@/lib/manutencao/dados";
import {
  TIPOS_DE_SERVICO,
  avaliarOleo,
  leituraJaRegistada,
  textoAposOleoTrocado,
  validarKmManual,
} from "@/lib/manutencao/oleo";
import type { ManutencaoTipo } from "@/types/db";

/**
 * «Óleo trocado»: a rotina do dia a dia da manutenção. Uma linha de manutenção do
 * tipo «óleo» e, se o gestor escrever o km, uma leitura do conta-km — que é o que
 * faz a próxima troca ser prevista por km e não só por data.
 *
 * Nota de segurança: uma Server Action é um endpoint HTTP público, por isso a
 * sessão é revalidada na 1.ª linha e o km é validado outra vez aqui — o ecrã
 * pode ser contornado.
 */

export type OleoTrocadoInput = {
  motoId: string;
  /** AAAA-MM-DD. Por omissão, hoje em Lisboa (quem chama é que decide). */
  data: string;
  /** Null: fica sem km e a próxima troca conta só pela data. */
  km: number | null;
  /** O gestor viu o aviso e confirmou um km fora dos limites. */
  confirmoKm?: boolean;
};

export type OleoTrocadoResultado =
  | { success: true; mensagem: string; aviso?: string }
  /** `confirmar`: o km está fora dos limites e o erro é o motivo a mostrar. */
  | { success: false; error: string; confirmar?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data real, e não um 31 de fevereiro escrito à mão no URL. */
const ehDataReal = (d: string) =>
  DATA_ISO.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export async function registarOleoTrocado(input: OleoTrocadoInput): Promise<OleoTrocadoResultado> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const motoId = String(input.motoId ?? "");
  if (!UUID.test(motoId)) return { success: false, error: "Mota inválida." };

  const data = String(input.data ?? "").slice(0, 10);
  const hoje = dataDeHojeEmLisboa();
  if (!ehDataReal(data)) return { success: false, error: "Data inválida." };
  if (data > hoje) return { success: false, error: "A troca não pode ficar numa data futura." };

  const km = input.km == null ? null : Number(input.km);

  const { data: moto, error: erroMoto } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo, estado_operacional")
    .eq("id", motoId)
    .maybeSingle();
  if (erroMoto) {
    console.error("registarOleoTrocado moto:", erroMoto);
    return { success: false, error: "Erro ao ler a mota." };
  }
  if (!moto) return { success: false, error: "Mota não encontrada." };

  let dados;
  try {
    dados = (await lerDadosOleo(motoId)).get(motoId);
  } catch (erro) {
    console.error("registarOleoTrocado dados:", erro);
    return { success: false, error: "Erro ao ler a manutenção desta mota." };
  }

  // Duas trocas escritas à mão no mesmo dia são, quase sempre, o mesmo clique
  // duas vezes. A fatura da oficina é outra coisa e continua a entrar.
  const jaRegistada = (dados?.linhas ?? []).some(
    (m) => m.tipo === "oleo" && m.origem === "manual" && m.data.slice(0, 10) === data,
  );
  if (jaRegistada) {
    return { success: false, error: `Esta mota já tem uma troca de óleo registada a ${dataBR(data)}.` };
  }

  const entrada = entradaOleo(moto, dados, hoje);
  const antes = avaliarOleo(entrada);

  if (km != null) {
    const validacao = validarKmManual(km, data, antes.km.ultimaValida);
    if (validacao.resultado === "invalido") return { success: false, error: validacao.motivo };
    if (validacao.resultado === "precisa_confirmacao" && !input.confirmoKm) {
      return { success: false, error: validacao.motivo, confirmar: true };
    }
  }

  const criada = await criarManutencao({
    veiculo_id: motoId,
    tipo: "oleo",
    data,
    km,
    origem: "manual",
  });
  if (!criada.success || !criada.manutencao) {
    return { success: false, error: criada.error ?? "Erro ao gravar a troca de óleo." };
  }

  // A leitura do conta-km. O gatilho fn_km_atual põe este km na mota se for o
  // mais recente — é por isso que um km fora dos limites pede confirmação.
  let aviso: string | undefined;
  let leituraGravada = false;
  if (km != null && !leituraJaRegistada(entrada.leituras, km, data)) {
    const { error } = await supabaseAdmin
      .from("km_registo")
      .insert({ veiculo_id: motoId, km, data, fonte: "manutencao" });
    if (error) {
      console.error("registarOleoTrocado km_registo:", error);
      aviso = "A troca ficou registada, mas não consegui gravar a leitura de km.";
    } else {
      leituraGravada = true;
    }
  }

  // O estado depois da troca, sem voltar à base: é o que a mensagem final diz.
  const depois = avaliarOleo({
    ...entrada,
    manutencoes: [...entrada.manutencoes, { id: criada.manutencao.id, tipo: "oleo", data, km }],
    leituras: leituraGravada && km != null
      ? [...entrada.leituras, { km, data, fonte: "manutencao" }]
      : entrada.leituras,
  });

  revalidatePath("/admin/motas");
  revalidatePath(`/admin/motas/${motoId}`);
  return { success: true, mensagem: textoAposOleoTrocado(depois), aviso };
}

/**
 * «Registar serviço»: a manutenção que não é óleo — pneus, travões, revisão,
 * inspeção. O óleo tem o seu próprio botão, porque é o que gera os alertas.
 *
 * A fatura da oficina continua a ser o caminho normal (entra por Documentos);
 * isto é para o que se faz e ainda não tem papel, ou não vai ter.
 */

export type ServicoInput = {
  motoId: string;
  tipo: ManutencaoTipo;
  /** AAAA-MM-DD. */
  data: string;
  km: number | null;
  notas?: string | null;
  confirmoKm?: boolean;
};

export type ServicoResultado =
  | { success: true; aviso?: string }
  | { success: false; error: string; confirmar?: boolean };

export async function registarServico(input: ServicoInput): Promise<ServicoResultado> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { success: false, error: auth.error };

  const motoId = String(input.motoId ?? "");
  if (!UUID.test(motoId)) return { success: false, error: "Mota inválida." };

  const tipo = input.tipo;
  if (!TIPOS_DE_SERVICO.includes(tipo)) {
    return { success: false, error: "Serviço inválido. O óleo regista-se em «Óleo trocado»." };
  }

  const data = String(input.data ?? "").slice(0, 10);
  const hoje = dataDeHojeEmLisboa();
  if (!ehDataReal(data)) return { success: false, error: "Data inválida." };
  if (data > hoje) return { success: false, error: "O serviço não pode ficar numa data futura." };

  const km = input.km == null ? null : Number(input.km);
  const notas = (input.notas ?? "").trim().slice(0, 500) || null;

  const { data: moto, error: erroMoto } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo, estado_operacional")
    .eq("id", motoId)
    .maybeSingle();
  if (erroMoto) {
    console.error("registarServico moto:", erroMoto);
    return { success: false, error: "Erro ao ler a mota." };
  }
  if (!moto) return { success: false, error: "Mota não encontrada." };

  let dados;
  try {
    dados = (await lerDadosOleo(motoId)).get(motoId);
  } catch (erro) {
    console.error("registarServico dados:", erro);
    return { success: false, error: "Erro ao ler a manutenção desta mota." };
  }
  const entrada = entradaOleo(moto, dados, hoje);
  const antes = avaliarOleo(entrada);

  if (km != null) {
    const validacao = validarKmManual(km, data, antes.km.ultimaValida);
    if (validacao.resultado === "invalido") return { success: false, error: validacao.motivo };
    if (validacao.resultado === "precisa_confirmacao" && !input.confirmoKm) {
      return { success: false, error: validacao.motivo, confirmar: true };
    }
  }

  const criada = await criarManutencao({
    veiculo_id: motoId,
    tipo,
    data,
    km,
    observacoes: notas,
    origem: "manual",
  });
  if (!criada.success) return { success: false, error: criada.error ?? "Erro ao gravar o serviço." };

  let aviso: string | undefined;
  if (km != null && !leituraJaRegistada(entrada.leituras, km, data)) {
    const { error } = await supabaseAdmin
      .from("km_registo")
      .insert({ veiculo_id: motoId, km, data, fonte: "manutencao" });
    if (error) {
      console.error("registarServico km_registo:", error);
      aviso = "O serviço ficou registado, mas não consegui gravar a leitura de km.";
    }
  }

  revalidatePath("/admin/motas");
  revalidatePath(`/admin/motas/${motoId}`);
  return { success: true, aviso };
}
