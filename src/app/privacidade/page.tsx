import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | GoScooters",
  description:
    "Como a GoScooters recolhe, utiliza e protege os dados pessoais dos seus clientes.",
};

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-semibold text-slate-950">
            Política de Privacidade
          </h1>

          <div className="mt-8 space-y-8 text-slate-700">
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">
                Que dados recolhemos
              </h2>
              <p>
                Quando submete um pedido de aluguer, recolhemos o seu nome, telefone
                e, opcionalmente, o email, a plataforma em que trabalha, a data de
                início pretendida, a duração e a mensagem que nos deixar.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">
                Para que os usamos
              </h2>
              <p>
                Exclusivamente para responder ao seu pedido de aluguer e gerir o
                contrato daí resultante. Não usamos os seus dados para publicidade
                nem os vendemos ou partilhamos com terceiros para fins comerciais.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">
                Fundamento e prazo de conservação
              </h2>
              <p>
                O tratamento assenta no seu consentimento, dado ao submeter o
                formulário, e nas diligências pré-contratuais que solicita.
                Conservamos os dados enquanto durar a relação comercial e, depois,
                pelo prazo legalmente exigido. Se o pedido não resultar em contrato,
                eliminamo-los no prazo máximo de 12 meses.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">
                Com quem são partilhados
              </h2>
              <p>
                Os dados são alojados na infraestrutura da Supabase, nosso
                subcontratante para serviços de base de dados. Se optar por nos
                contactar via WhatsApp, essa comunicação fica sujeita à política de
                privacidade da Meta.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">
                Os seus direitos
              </h2>
              <p>
                Ao abrigo do RGPD, pode solicitar o acesso, a retificação, o
                apagamento, a limitação ou a portabilidade dos seus dados, bem como
                retirar o consentimento a qualquer momento — sem que isso afete a
                licitude do tratamento anterior. Tem também o direito de apresentar
                reclamação junto da CNPD.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-slate-950">Contacto</h2>
              <p>
                Para exercer os seus direitos ou esclarecer qualquer dúvida,
                contacte-nos através dos meios indicados no site.
              </p>
            </section>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6">
            <Link
              className="text-sm font-medium text-emerald-600 transition hover:text-emerald-700"
              href="/"
            >
              ← Voltar ao catálogo
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
