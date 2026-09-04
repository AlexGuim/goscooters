import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import IntakeDocumento from "@/app/(admin)/admin/(protected)/despesas/IntakeDocumento";

/**
 * Documentos — a porta única de entrada.
 *
 * O gestor deixa de ter de saber, antes de carregar, a que ecrã pertence o
 * papel que tem em mãos. Carrega aqui; a IA identifica e encaminha.
 */
export default async function DocumentosPage() {
  await requireAdmin();

  // Só motoristas com dívida em aberto: são os únicos a quem faz sentido alocar
  // um pagamento. Evita uma lista de 45 nomes onde 9 interessam.
  const { data: abertas } = await supabaseAdmin
    .from("vw_cobranca_estado")
    .select("motorista_id")
    .in("estado_liquidacao", ["por_liquidar", "parcial"]);
  const ids = [...new Set((abertas ?? []).map((c) => c.motorista_id).filter(Boolean) as string[])];
  const { data: motos } = await supabaseAdmin
    .from("moto")
    .select("id, matricula, modelo, proprietario_id")
    .order("matricula");
  const { data: mots } = ids.length
    ? await supabaseAdmin.from("motorista").select("id, nome").in("id", ids).order("nome")
    : { data: [] as { id: string; nome: string }[] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Documentos</h1>
        <p className="mt-1 text-slate-600">
          Carrega qualquer documento — a IA identifica o que é e encaminha para o sítio certo.
        </p>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <IntakeDocumento
          motos={motos ?? []}
          motoristas={(mots ?? []).map((m) => ({ id: m.id, nome: m.nome }))}
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
