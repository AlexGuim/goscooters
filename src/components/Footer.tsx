import Link from "next/link";

export default function Footer({
  whatsappNumber,
}: {
  whatsappNumber: string;
}) {
  const ano = new Date().getFullYear();

  return (
    <footer className="mt-16 bg-slate-950 text-white/70">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm space-y-3">
            <p className="text-xl font-extrabold uppercase italic tracking-tight text-white">
              <span className="text-emerald-500">Go</span>Scooters
            </p>
            <p className="text-sm">
              Aluguer de motas em Lisboa para motoristas de plataformas. Diário,
              semanal ou mensal.
            </p>
          </div>

          <div className="space-y-3 text-sm">
            <p className="font-semibold uppercase tracking-widest text-white/50">
              Contactos
            </p>
            <a
              className="block transition hover:text-white"
              href={`https://wa.me/${whatsappNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <Link className="block transition hover:text-white" href="/privacidade">
              Política de Privacidade
            </Link>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs">
          <p>© {ano} GoScooters. Todos os direitos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
