import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/dal";
import type { Despesa, Moto, Proprietario } from "@/types/db";
import DespesasList, { type DespesaComNomes } from "./DespesasList";
import ImportarFatura from "./ImportarFatura";
import IntakeDocumento from "./IntakeDocumento";
import { motoristasParaIntake } from "@/lib/motoristasParaIntake";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";
import { urlsDocumentosParaAdmin } from "@/lib/documentoDespesaServidor";

async function getDados(): Promise<{
  despesas: DespesaComNomes[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}> {
  const [despRes, motosRes, donosRes, infrRes] = await Promise.all([
    supabaseAdmin
      .from("despesa")
      .select("*")
      .order("data_despesa", { ascending: false }),
    supabaseAdmin.from("moto").select("id, matricula, modelo, proprietario_id").order("matricula"),
    supabaseAdmin.from("proprietario").select("id, nome").order("nome"),
    supabaseAdmin.from("infracao").select("despesa_id, estado, prazo_identificacao"),
  ]);

  const matricula = new Map((motosRes.data ?? []).map((m) => [m.id, m.matricula]));
  const nomeDono = new Map((donosRes.data ?? []).map((d) => [d.id, d.nome]));
  // O estado do F306 de cada coima. Sem a fase16 aplicada a tabela não existe: a
  // lista segue sem ele.
  if (infrRes.error) console.warn("despesas: infracao (fase16 por aplicar?):", infrRes.error.message);
  const infracaoDe = new Map(
    (infrRes.data ?? []).map((i) => [i.despesa_id, { estado: i.estado, prazo_identificacao: i.prazo_identificacao }]),
  );

  // "Ver documento": a fatura pelo URL público; a coima/portagem (bucket privado)
  // por URL assinado — gerado aqui, no servidor; a página só chega cá depois do
  // requireAdmin.
  const linhas: Despesa[] = despRes.data ?? [];
  const docs = await urlsDocumentosParaAdmin(linhas.map((d) => documentoDoDetalhe(d.detalhe)));

  const despesas: DespesaComNomes[] = linhas.map((d, i) => ({
    ...d,
    veiculo_matricula: d.veiculo_id ? matricula.get(d.veiculo_id) ?? "—" : null,
    proprietario_nome: d.proprietario_id ? nomeDono.get(d.proprietario_id) ?? null : null,
    documento_ver: docs[i],
    infracao: infracaoDe.get(d.id) ?? null,
  }));

  return {
    despesas,
    motos: motosRes.data ?? [],
    proprietarios: donosRes.data ?? [],
  };
}

export default async function DespesasAdminPage() {
  await requireAdmin();
  // Os motoristas também: um documento de identidade ou um comprovativo que
  // entre por aqui segue para a ficha/cobrança em vez de bater num aviso.
  const [{ despesas, motos, proprietarios }, motoristas, condutoresRes] = await Promise.all([
    getDados(),
    motoristasParaIntake(),
    // Para escolher o condutor de uma coima: todos, também os bloqueados (marcados).
    supabaseAdmin.from("motorista").select("id, nome, estado").order("nome"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Despesas</h1>
        <p className="mt-1 text-slate-600">
          Custos por veículo: manutenção, portagens, coimas, seguro, GPS.
        </p>
      </div>

      <IntakeDocumento motos={motos} motoristas={motoristas} />

      <details className="rounded-3xl bg-white p-6 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Importar fatura sem IA (OCR/texto) — alternativa
        </summary>
        <div className="mt-4">
          <ImportarFatura motos={motos} />
        </div>
      </details>

      <DespesasList
        inicial={despesas}
        motos={motos}
        proprietarios={proprietarios}
        motoristas={(condutoresRes.data ?? []).map((m) => ({
          id: m.id,
          nome: m.estado === "bloqueado" ? `${m.nome} (bloqueado)` : m.nome,
        }))}
      />
    </div>
  );
}
