import Link from "next/link";
import type { Dicionario, Locale } from "@/lib/i18n";

export default function Footer({
  locale,
  dic,
  whatsappNumber,
}: {
  locale: Locale;
  dic: Dicionario;
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
            <p className="text-sm">{dic.footer.descricao}</p>
          </div>

          <div className="space-y-3 text-sm">
            <p className="font-semibold uppercase tracking-widest text-white/50">
              {dic.footer.contactos}
            </p>
            <a
              className="block transition hover:text-white"
              href={`https://wa.me/${whatsappNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <Link
              className="block transition hover:text-white"
              href={`/${locale}/privacidade`}
            >
              {dic.footer.privacidade}
            </Link>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-xs">
          <p>
            © {ano} GoScooters. {dic.footer.direitos}
          </p>
        </div>
      </div>
    </footer>
  );
}
