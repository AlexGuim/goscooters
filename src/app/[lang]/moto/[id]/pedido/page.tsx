import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getDicionario } from "@/lib/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n";
import type { Moto } from "@/types/db";
import PedidoForm from "./PedidoForm";

interface PageProps {
  params: Promise<{ id: string; lang: string }>;
}

/**
 * Server Component de propósito: é aqui que a mota é carregada, para o
 * formulário conhecer os preços reais.
 *
 * A versão anterior lia o modelo de `?modelo=` no URL — controlado por quem
 * visita a página e reenviado no email de notificação, o que permitia forjar o
 * conteúdo do aviso. Passando pela base de dados, isso deixa de ser possível.
 */
async function getMoto(id: string): Promise<Moto | null> {
  const { data, error } = await supabaseServer
    .from("moto")
    .select("*")
    .eq("id", id)
    .eq("ativo", true)
    .neq("estado", "manutencao")
    .maybeSingle();

  if (error) {
    console.error("Erro ao carregar a mota para o pedido:", error);
    return null;
  }

  return data;
}

export default async function PedidoPage({ params }: PageProps) {
  const { id, lang } = await params;
  const locale = (isLocale(lang) ? lang : "pt") as Locale;
  const dic = await getDicionario(locale);
  const moto = await getMoto(id);

  if (!moto) {
    notFound();
  }

  return <PedidoForm moto={moto} locale={locale} dic={dic} />;
}
