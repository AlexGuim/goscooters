import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PedidoAluguer } from "@/types/db";
import PedidosList from "./PedidosList";

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

export default async function PedidosAdminPage() {
  const pedidos = await getPedidos();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Pedidos de aluguer</h1>
        <p className="mt-1 text-slate-600">Gestão de leads e pedidos</p>
      </div>

      <PedidosList initialPedidos={pedidos} />
    </div>
  );
}
