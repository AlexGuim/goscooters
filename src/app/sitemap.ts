import type { MetadataRoute } from "next";
import { supabaseServer } from "@/lib/supabaseServer";
import { LOCALES, TAGS_HTML } from "@/lib/i18n";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Versões alternativas de um caminho, para o Google saber que são traduções. */
function alternativas(caminho: string) {
  return {
    languages: Object.fromEntries(
      LOCALES.map((l) => [TAGS_HTML[l], `${siteUrl}/${l}${caminho}`]),
    ),
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: motas } = await supabaseServer
    .from("moto")
    .select("id, created_at")
    .eq("ativo", true)
    .neq("estado", "manutencao");

  const paginasFixas = LOCALES.flatMap((locale) => [
    {
      url: `${siteUrl}/${locale}`,
      changeFrequency: "daily" as const,
      priority: 1,
      alternates: alternativas(""),
    },
    {
      url: `${siteUrl}/${locale}/privacidade`,
      changeFrequency: "yearly" as const,
      priority: 0.3,
      alternates: alternativas("/privacidade"),
    },
  ]);

  const paginasMotas = (motas ?? []).flatMap((moto) =>
    LOCALES.map((locale) => ({
      url: `${siteUrl}/${locale}/moto/${moto.id}`,
      lastModified: moto.created_at ? new Date(moto.created_at) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      alternates: alternativas(`/moto/${moto.id}`),
    })),
  );

  return [...paginasFixas, ...paginasMotas];
}
