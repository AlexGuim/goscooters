import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Acerto, AcertoLinha, Proprietario } from "@/types/db";
import AcertosList, { type AcertoComLinhas } from "./AcertosList";

async function getDados(): Promise<{
  acertos: AcertoComLinhas[];
  proprietarios: Pick<Proprietario, "id" | "nome" | "comissao_valor">[];
}> {
  const [acRes, linRes, donosRes] = await Promise.all([
    supabaseAdmin
      .from("acerto")
      .select("*")
      .order("competencia_mes", { ascending: false }),
    supabaseAdmin.from("acerto_linha").select("*"),
    supabaseAdmin
      .from("proprietario")
      .select("id, nome, comissao_valor")
      .eq("eh_goscooters", false)
      .eq("ativo", true)
      .order("nome"),
  ]);

  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));
  const linRows = linRes.data ?? [];

  // Documento (bucket público) por despesa — para o detalhe do acerto abrir a
  // fatura/portagem/coima/apólice, tal como o parceiro vê no portal.
  const despesaIds = [...new Set(linRows.filter((l) => l.despesa_id).map((l) => l.despesa_id as string))];
  const docPorDespesa = new Map<string, string | null>();
  if (despesaIds.length > 0) {
    const { data: despesas } = await supabaseAdmin.from("despesa").select("id, detalhe").in("id", despesaIds);
    for (const d of despesas ?? []) {
      docPorDespesa.set(d.id, (d.detalhe as { documento_url?: string } | null)?.documento_url ?? null);
    }
  }

  const linhasPor = new Map<string, (AcertoLinha & { documento_url: string | null })[]>();
  for (const l of linRows) {
    const arr = linhasPor.get(l.acerto_id) ?? [];
    arr.push({ ...l, documento_url: l.despesa_id ? docPorDespesa.get(l.despesa_id) ?? null : null });
    linhasPor.set(l.acerto_id, arr);
  }

  const acertos: AcertoComLinhas[] = (acRes.data ?? []).map((a: Acerto) => ({
    ...a,
    proprietario_nome: nomeDono.get(a.proprietario_id) ?? "—",
    linhas: linhasPor.get(a.id) ?? [],
  }));

  return { acertos, proprietarios: donosRes.data ?? [] };
}

export default async function AcertosAdminPage() {
  await requireAdmin();
  const { acertos, proprietarios } = await getDados();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Acertos</h1>
        <p className="mt-1 text-slate-600">
          Fecho mensal por parceiro: receita − comissão − despesas = a transferir.
        </p>
      </div>

      <AcertosList inicial={acertos} proprietarios={proprietarios} />
    </div>
  );
}
