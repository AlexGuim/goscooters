import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { contratoAbertoDe } from "@/lib/contratoAberto";
import AluguelWizard from "./AluguelWizard";

/**
 * `?motorista=<id>` — quem chega de Documentos ("Próximo passo: criar
 * contrato") ou da ficha já escolheu o motorista: o wizard salta o passo 1.
 */
export default async function NovoAluguelPage({
  searchParams,
}: {
  searchParams: Promise<{ motorista?: string }>;
}) {
  await requireAdmin();
  const { motorista } = await searchParams;

  const [{ data: motoristas }, { data: motos }] = await Promise.all([
    supabaseAdmin.from("motorista").select("id, nome, telefone").order("nome"),
    supabaseAdmin
      .from("moto")
      .select("id, matricula, modelo, proprietario_id, estado_operacional")
      .order("matricula"),
  ]);

  // Um id inválido (link antigo, motorista apagado) cai no passo 1 — não em erro.
  const inicial = motorista ? (motoristas ?? []).find((m) => m.id === motorista) ?? null : null;

  // O contrato que ele já tem em curso, se tiver: o passo 2 finaliza um
  // pré-contrato em vez de abrir outro, e avisa se já há um rascunho/ativo.
  const contratoAberto = inicial ? await contratoAbertoDe(inicial.id) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Criar aluguer</h1>
        <p className="mt-1 text-slate-600">Do motorista à entrega da mota, num só fluxo.</p>
      </div>
      <AluguelWizard
        // O estado inicial do wizard depende do motorista: sem a key, navegar
        // de um "?motorista=" para outro no cliente ficava preso no primeiro.
        key={inicial?.id ?? "novo"}
        motoristas={motoristas ?? []}
        motos={motos ?? []}
        motoristaInicial={inicial ? { id: inicial.id, nome: inicial.nome } : null}
        contratoAberto={contratoAberto}
      />
    </div>
  );
}
