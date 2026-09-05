import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { motoristasParaIntake } from "@/lib/motoristasParaIntake";
import IntakeDocumento from "@/app/(admin)/admin/(protected)/despesas/IntakeDocumento";

/**
 * Documentos — a porta única de entrada.
 *
 * O gestor deixa de ter de saber, antes de carregar, a que ecrã pertence o
 * papel que tem em mãos. Carrega aqui; a IA identifica e encaminha.
 */
export default async function DocumentosPage() {
  await requireAdmin();

  // Todos os motoristas ativos: um comprovativo de pagamento é de quem tem
  // dívida, mas um documento de identidade pode ser de qualquer um — incluindo
  // de quem ainda nem tem contrato.
  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo, proprietario_id")
    .order("matricula");
  // Com o perfil KYC e os ficheiros que a ficha já tem (loader partilhado com
  // Despesas — os dois ecrãs tratam um documento de identidade da mesma forma).
  const motoristas = await motoristasParaIntake();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Documentos</h1>
        <p className="mt-1 text-slate-600">
          Carrega qualquer documento — a IA identifica o que é e encaminha para o sítio certo.
          Motorista novo? Carrega o documento de identidade e a carta — o contrato segue daqui.
        </p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <IntakeDocumento
          motos={motos ?? []}
          motoristas={motoristas}
          sempreAberto
        />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          O que o sistema reconhece
        </p>
        <ul className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
          <li>• Comprovativo de pagamento do motorista → regista e aloca às semanas</li>
          <li>• Fatura de oficina / manutenção → despesa + histórico da mota</li>
          <li>• Apólice de seguro → ficha da mota e alertas de validade</li>
          <li>• Portagem ou coima → despesa imputada ao motorista</li>
          <li>• Documento de identidade / morada → ficha do motorista (KYC)</li>
          <li>• Outra fatura → despesa</li>
        </ul>
      </div>
    </div>
  );
}
