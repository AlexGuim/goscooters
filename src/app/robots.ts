import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // A administração e os endpoints de autenticação nunca devem ser
      // indexados. O acesso já está protegido; isto evita apenas que apareçam
      // em resultados de pesquisa.
      disallow: ["/admin", "/admin/", "/auth/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
