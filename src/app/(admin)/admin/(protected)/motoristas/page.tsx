import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { escolherContratoEmCurso } from "@/lib/contratoAberto";
import { requireAdmin } from "@/lib/dal";
import type { Avaliacao, ContratoEstado, Motorista } from "@/types/db";
import MotoristasList, { type MotoristaComAvaliacoes } from "./MotoristasList";

async function getMotoristas(): Promise<MotoristaComAvaliacoes[]> {
  const { data, error } = await supabaseAdmin
    .from("motorista")
    .select("*, avaliacao(*)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return (data ?? []).map((m) => {
    const { avaliacao, ...motorista } = m as Motorista & { avaliacao: Avaliacao[] };
    const avaliacoes = [...(avaliacao ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    return { ...(motorista as Motorista), avaliacoes };
  });
}

export default async function MotoristasAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requireAdmin();
  const [{ m: foco }, motoristas] = await Promise.all([searchParams, getMotoristas()]);

  // Contrato em curso por motorista — para a ficha oferecer o "próximo passo"
  // certo (finalizar o pré-contrato, entregar o rascunho, ou enviar o ativo).
  // Um pré-contrato/rascunho ganha a um ativo+: é o que está a meio do caminho.
  const { data: cs } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, estado, motorista_id")
    .in("estado", ["pre_contrato", "rascunho", "ativo", "pendente_fecho", "suspenso"])
    .order("created_at", { ascending: false });
  // A MESMA regra do wizard (`contratoAbertoDe`): a ficha e o "Criar aluguer"
  // têm de apontar para o mesmo contrato.
  const porMotorista: Record<string, { id: string; numero: string; estado: ContratoEstado }[]> = {};
  for (const c of cs ?? []) {
    if (!c.motorista_id) continue;
    (porMotorista[c.motorista_id] ??= []).push({ id: c.id, numero: c.numero, estado: c.estado });
  }
  const contratoPorMotorista: Record<string, { id: string; numero: string; estado: ContratoEstado }> = {};
  for (const [mid, lista] of Object.entries(porMotorista)) {
    const c = escolherContratoEmCurso(lista);
    if (c) contratoPorMotorista[mid] = c;
  }

  // Motoristas com "documentos por validar" em aberto — a ficha mostra o botão
  // "Validar identidade" para o gestor resolver num clique, sem ir às notificações.
  const { data: pv } = await supabaseAdmin
    .from("notificacao")
    .select("entidade_id")
    .eq("tipo", "kyc_por_validar")
    .neq("estado", "feita");
  const porValidar = [...new Set((pv ?? []).map((n) => n.entidade_id).filter(Boolean) as string[])];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Motoristas</h1>
        <p className="mt-1 text-slate-600">
          Registo privado do histórico e da conduta dos motoristas a quem alugaste.
        </p>
      </div>

      <MotoristasList
        inicial={motoristas}
        foco={foco ?? null}
        contratoPorMotorista={contratoPorMotorista}
        porValidar={porValidar}
      />
    </div>
  );
}
