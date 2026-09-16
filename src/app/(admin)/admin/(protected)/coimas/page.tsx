import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";
import { urlsDocumentosParaAdmin } from "@/lib/documentoDespesaServidor";
import { motoristasParaIntake } from "@/lib/motoristasParaIntake";
import IntakeDocumento from "@/app/(admin)/admin/(protected)/despesas/IntakeDocumento";
import CoimasList, { type CoimaLinha } from "./CoimasList";

/**
 * Coimas: os autos de contraordenação pelo que importa num auto — quem conduzia,
 * o prazo para o identificar e o estado da identificação. Continuam a ser
 * despesas (categoria "coima"); a identificação é a mesma que em Despesas.
 */
async function getDados() {
  const [despRes, infrRes, motosRes, donosRes, motsRes] = await Promise.all([
    supabaseAdmin
      .from("despesa")
      .select(
        "id, veiculo_id, proprietario_id, motorista_id, descricao, valor_total, data_despesa, data_infracao, referencia_externa, fornecedor, cobranca_id, detalhe",
      )
      .eq("categoria", "coima")
      .order("data_despesa", { ascending: false }),
    supabaseAdmin
      .from("infracao")
      .select("despesa_id, estado, prazo_identificacao, numero_auto, motorista_id, enviado_em, envio_canal, entidade"),
    supabaseAdmin.from("moto").select("id, matricula, modelo, proprietario_id").order("matricula"),
    supabaseAdmin.from("proprietario").select("id, nome"),
    supabaseAdmin.from("motorista").select("id, nome, estado"),
  ]);

  if (despRes.error) console.error("coimas: despesas:", despRes.error.message);
  // Sem a fase16 aplicada a tabela infracao não existe: as coimas aparecem sem o processo.
  if (infrRes.error) console.warn("coimas: infracao (fase16 por aplicar?):", infrRes.error.message);

  const motos = motosRes.data ?? [];
  const matricula = new Map(motos.map((m) => [m.id, m.matricula]));
  const donoDaMota = new Map(motos.map((m) => [m.id, m.proprietario_id]));
  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));
  const motoristas = motsRes.data ?? [];
  const nomeMotorista = new Map(motoristas.map((m) => [m.id, m.nome]));
  const infracaoDe = new Map((infrRes.data ?? []).map((i) => [i.despesa_id, i]));

  // Para escolher o condutor: todos, também os bloqueados — a coima pode ser de
  // quem entretanto deixou de alugar —, com a marca à vista.
  const condutores = motoristas
    .map((m) => ({ id: m.id, nome: m.estado === "bloqueado" ? `${m.nome} (bloqueado)` : m.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));

  const despesas = despRes.data ?? [];
  // "Ver o auto": os avisos de coima vivem em privado — URL assinado, gerado aqui.
  const docs = await urlsDocumentosParaAdmin(despesas.map((d) => documentoDoDetalhe(d.detalhe)));

  const linhas: CoimaLinha[] = despesas.map((d, idx) => {
    const i = infracaoDe.get(d.id);
    const condutorId = i?.motorista_id ?? d.motorista_id;
    const donoId = d.proprietario_id ?? (d.veiculo_id ? donoDaMota.get(d.veiculo_id) ?? null : null);
    return {
      id: d.id,
      matricula: d.veiculo_id ? matricula.get(d.veiculo_id) ?? "—" : null,
      dono: donoId ? nomeDono.get(donoId) ?? null : null,
      condutor: condutorId ? nomeMotorista.get(condutorId) ?? null : null,
      data_infracao: d.data_infracao ?? d.data_despesa,
      valor_total: d.valor_total,
      numero_auto: i?.numero_auto ?? d.referencia_externa,
      entidade: i && i.entidade !== "ANSR" ? i.entidade : d.fornecedor,
      descricao: d.descricao,
      divida_gerada: Boolean(d.cobranca_id),
      documento_ver: docs[idx],
      infracao: i
        ? {
            estado: i.estado,
            prazo_identificacao: i.prazo_identificacao,
            enviado_em: i.enviado_em,
            envio_canal: i.envio_canal,
          }
        : null,
    };
  });

  return {
    linhas,
    motos,
    condutores,
    processoDisponivel: !infrRes.error,
    erro: despRes.error ? "Não consegui ler as coimas — recarrega a página." : null,
  };
}

export default async function CoimasAdminPage() {
  await requireAdmin();
  // Os motoristas do carregamento servem para um documento de identidade que entre
  // por aqui seguir para a ficha.
  const [{ linhas, motos, condutores, processoDisponivel, erro }, motoristasIntake] = await Promise.all([
    getDados(),
    motoristasParaIntake(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Coimas</h1>
        <p className="mt-1 text-slate-600">
          Autos de contraordenação: quem conduzia, o prazo para o identificar e o envio da identificação.
        </p>
      </div>

      {!processoDisponivel && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Falta aplicar a migração sql/fase16_infracao.sql: as coimas aparecem, mas sem o processo de
          identificação do condutor.
        </div>
      )}
      {erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</div>
      )}

      <details className="rounded-3xl bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Chegou um auto? Carrega-o e a IA lê
        </summary>
        <div className="mt-4">
          <IntakeDocumento motos={motos} motoristas={motoristasIntake} />
        </div>
      </details>

      <CoimasList inicial={linhas} motos={motos} motoristas={condutores} />
    </div>
  );
}
