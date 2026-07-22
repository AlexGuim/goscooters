import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import { normalizarTelefone } from "@/lib/telefone";
import type { AvaliacaoTipo, PedidoAluguer } from "@/types/db";
import PedidosList, { type AvisoMotorista } from "./PedidosList";

async function getPedidos(): Promise<PedidoAluguer[]> {
  const { data, error } = await supabaseAdmin
    .from("pedido_aluguer")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return data ?? [];
}

/**
 * Cruza cada pedido com o registo de motoristas pelo telefone. É o valor real
 * da funcionalidade: ao ver um pedido novo, sabes logo se aquele número já tem
 * histórico — positivo ou negativo.
 */
async function getAvisos(
  pedidos: PedidoAluguer[],
): Promise<Record<string, AvisoMotorista>> {
  const { data } = await supabaseAdmin
    .from("motorista")
    .select("id, telefone_digitos, avaliacao(tipo)");

  if (!data?.length) return {};

  const porTelefone = new Map<string, AvisoMotorista>();
  for (const m of data) {
    const avs = (m as { avaliacao?: { tipo: AvaliacaoTipo }[] }).avaliacao ?? [];
    porTelefone.set(m.telefone_digitos, {
      motoristaId: m.id,
      positivas: avs.filter((a) => a.tipo === "positiva").length,
      negativas: avs.filter((a) => a.tipo === "negativa").length,
    });
  }

  const avisos: Record<string, AvisoMotorista> = {};
  for (const p of pedidos) {
    const aviso = porTelefone.get(normalizarTelefone(p.telefone));
    if (aviso) avisos[p.id] = aviso;
  }
  return avisos;
}

export default async function PedidosAdminPage() {
  // Verificação antes de qualquer leitura: estes dados são pessoais e o
  // supabaseAdmin usa a service_role, que ignora o RLS.
  await requireAdmin();

  const pedidos = await getPedidos();
  const avisos = await getAvisos(pedidos);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Pedidos de aluguer</h1>
        <p className="mt-1 text-slate-600">Gestão de leads e pedidos</p>
      </div>

      <PedidosList initialPedidos={pedidos} avisos={avisos} />
    </div>
  );
}
