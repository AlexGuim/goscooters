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
      ? supabaseAdmin.from("motorista").select("*").eq("id", c.motorista_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("vistoria").select("id").eq("contrato_id", id).eq("tipo", "entrega").maybeSingle(),
  ]);

  const regras = await regrasAtivas();

  const m = mot as Record<string, unknown> | null;
  const motorista =
    m && c.motorista_id
      ? {
          id: c.motorista_id,
          nome: (m.nome as string) ?? "—",
          nif: (m.nif as string) ?? null,
          nif_valido: (m.nif_valido as boolean) ?? null,
          doc_id_tipo: (m.doc_id_tipo as string) ?? null,
          doc_id_numero: (m.doc_id_numero as string) ?? null,
          doc_id_validade: (m.doc_id_validade as string) ?? null,
          doc_urls: (m.doc_urls as string[]) ?? null,
          carta_numero: (m.carta_numero as string) ?? null,
          carta_categoria: (m.carta_categoria as string) ?? null,
          carta_pais: (m.carta_pais as string) ?? null,
          carta_validade: (m.carta_validade as string) ?? null,
          morada_linha1: (m.morada_linha1 as string) ?? null,
          codigo_postal: (m.codigo_postal as string) ?? null,
          localidade: (m.localidade as string) ?? null,
        }
      : undefined;

  return (
    <CapturaEntrega
      jaEntregue={!!ja}
      regras={regras ? { versao: regras.versao, hash: regras.hash, conteudo: regras.conteudo } : null}
      motorista={motorista}
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
