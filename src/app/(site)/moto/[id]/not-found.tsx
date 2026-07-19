import Link from "next/link";

export default function MotoNotFound() {
  return (
    <main className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <p className="text-5xl font-semibold text-slate-950">404</p>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">Mota não encontrada</h1>
          <p className="mt-4 text-slate-600">
            A mota que procuraste não existe, não está ativa ou encontra-se em manutenção.
          </p>
          <Link
            className="mt-8 inline-flex rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            href="/"
          >
            Voltar ao catálogo
          </Link>
        </div>
      </div>
    </main>
  );
}
