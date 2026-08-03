import { requirePartner } from "@/lib/dal";
import { despesasDoParceiro } from "@/lib/portal/queries";
import DespesasParceiroLista from "./DespesasParceiroLista";
import SubNavFinanceiro from "../SubNavFinanceiro";

export default async function PortalDespesas() {
  const { proprietarioId } = await requirePartner();
  const despesas = await despesasDoParceiro(proprietarioId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Despesas</h1>
        <p className="mt-1 text-sm text-slate-500">
          As despesas das tuas motos que suportas como proprietário. Filtra por mês ou ano.
        </p>
      </div>
      <SubNavFinanceiro />
      <DespesasParceiroLista despesas={despesas} />
    </div>
  );
}
