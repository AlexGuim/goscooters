import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { regrasAtivas } from "@/actions/regrasActions";
import CapturaEntrega from "./CapturaEntrega";

export default async function EntregaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const { data: c } = await supabaseAdmin
    .from("contrato_aluguer")
    .select("id, numero, veiculo_id, motorista_id, preco_periodo, caucao, estado")
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: moto }, { data: mot }, { data: ja }] = await Promise.all([
    c.veiculo_id
      ? supabaseAdmin.from("moto").select("matricula, modelo, km_atual").eq("id", c.veiculo_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.motorista_id
      ? supabaseAdmin.from("motorista").select("nome").eq("id", c.motorista_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("vistoria").select("id").eq("contrato_id", id).eq("tipo", "entrega").maybeSingle(),
  ]);

  const regras = await regrasAtivas();

  return (
    <CapturaEntrega
      jaEntregue={!!ja}
      regras={regras ? { versao: regras.versao, hash: regras.hash, conteudo: regras.conteudo } : null}
      contrato={{
        id: c.id,
        numero: c.numero,
        preco_periodo: c.preco_periodo ?? "",
        caucao: c.caucao,
        motorista_nome: mot?.nome ?? "—",
        veiculo: moto ? `${moto.matricula ?? "?"} · ${moto.modelo}` : "—",
        km_atual: moto?.km_atual ?? null,
      }}
    />
  );
}
