import Link from "next/link";

/**
 * O not-found é renderizado por notFound() e não recebe params, portanto não
 * sabe o idioma. Como o texto é curto, mostra-se nos dois — mais simples e
 * fiável do que adivinhar a partir de cabeçalhos.
 */
export default function MotoNotFound() {
  return (
    <main className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
        <div className="text-center">
          <p className="text-5xl font-semibold text-slate-950">404</p>

          <h1 className="mt-4 text-3xl font-semibold text-slate-900">
            Mota não encontrada
          </h1>
          <p className="mt-3 text-slate-600">
            A mota que procuraste não existe, não está ativa ou encontra-se em
            manutenção.
          </p>

          <div className="mx-auto mt-8 max-w-sm border-t border-slate-200 pt-6">
            <h2 className="text-xl font-semibold text-slate-900">
              Scooter not found
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              The scooter you&apos;re looking for doesn&apos;t exist, is inactive
              or is under maintenance.
            </p>
          </div>

          <Link
            className="mt-8 inline-flex rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
            href="/"
          >
            Voltar ao catálogo · Back to catalogue
          </Link>
        </div>
      </div>
    </main>
  );
}
