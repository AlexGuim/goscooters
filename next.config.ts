import type { NextConfig } from "next";

/**
 * O hostname do Supabase é derivado da variável de ambiente em vez de estar
 * fixo: assim, mudar de projeto Supabase não exige tocar nesta configuração.
 */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    // Só imagens do nosso bucket público do Supabase são optimizadas e servidas.
    // Sem esta lista, o next/image recusa qualquer URL externo.
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
          // As motas de exemplo ainda usam fotografias do Unsplash.
          {
            protocol: "https",
            hostname: "images.unsplash.com",
            pathname: "/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
