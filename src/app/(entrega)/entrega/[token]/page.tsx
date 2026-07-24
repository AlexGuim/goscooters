import Link from "next/link";
import { sessaoPorToken } from "@/actions/entregaActions";
import OnboardingEntrega from "./OnboardingEntrega";

export default async function EntregaPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await sessaoPorToken(token);

  if (!r.ok || !r.sessao) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">Link indisponível</h1>
          <p className="mt-2 text-sm text-slate-600">{r.error}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-700">
            Ir ao site
          </Link>
        </div>
      </main>
    );
  }

  return <OnboardingEntrega token={token} sessao={r.sessao} />;
}
