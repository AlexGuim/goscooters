"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams, useParams } from "next/navigation";
import { createPedido } from "@/actions/createPedido";

interface PedidoPageProps {
  params: Promise<{ id: string }>;
}

type State = {
  success?: boolean;
  error?: string;
  pedidoId?: string;
  whatsappLink?: string;
};

export default function PedidoPage({ params: paramsPromise }: PedidoPageProps) {
  const params = useParams();
  const motoId = typeof params.id === "string" ? params.id : "";
  const searchParams = useSearchParams();
  const motoModelo = searchParams.get("modelo") || "Mota";

  const [state, formAction, isPending] = useActionState(
    async (
      _prevState: State | undefined,
      formData: FormData,
    ): Promise<State> => {
      const result = await createPedido({
        motoId,
        motoModelo,
        nome: formData.get("nome") as string,
        telefone: formData.get("telefone") as string,
        email: (formData.get("email") as string) || undefined,
        plataforma: formData.get("plataforma") as string,
        dataInicio: (formData.get("dataInicio") as string) || undefined,
        duracaoMeses: formData.get("duracaoMeses")
          ? parseInt(formData.get("duracaoMeses") as string, 10)
          : undefined,
        mensagem: (formData.get("mensagem") as string) || undefined,
        consentimento: formData.get("consentimento") === "on",
      });

      return {
        success: result.success,
        error: result.error,
        pedidoId: result.pedidoId,
        whatsappLink: result.whatsappLink,
      };
    },
    undefined,
  );

  if (state?.success) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm">
          <div className="space-y-6 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <span className="text-2xl">✓</span>
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-950">Pedido recebido!</h1>
              <p className="mt-3 text-slate-600">
                Obrigado por te interessares em alugar connosco. Entraremos em contacto em breve para confirmar os detalhes.
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                {state.whatsappLink && (
                  <>
                    Para acelerar o processo, pode também contactar-nos via WhatsApp:{" "}
                  </>
                )}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                {state.whatsappLink && (
                  <a
                    className="inline-flex items-center justify-center rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    href={state.whatsappLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir WhatsApp
                  </a>
                )}
                <Link
                  className="inline-flex items-center justify-center rounded-3xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:border-slate-400 hover:bg-slate-50"
                  href="/"
                >
                  Voltar ao catálogo
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">Pedir aluguer</h1>
            <p className="mt-2 text-slate-600">Mota: {motoModelo}</p>
          </div>

          <form action={formAction} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Nome <span className="text-red-600">*</span>
                </span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                  type="text"
                  name="nome"
                  required
                  placeholder="João Silva"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Telefone <span className="text-red-600">*</span>
                </span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                  type="tel"
                  name="telefone"
                  required
                  placeholder="+351 91 234 5678"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email (opcional)</span>
              <input
                className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                type="email"
                name="email"
                placeholder="joao@email.com"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Plataforma <span className="text-red-600">*</span>
              </span>
              <select
                className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                name="plataforma"
                required
              >
                <option value="">Selecciona uma plataforma</option>
                <option value="Uber">Uber</option>
                <option value="Glovo">Glovo</option>
                <option value="Bolt">Bolt</option>
                <option value="outro">Outro</option>
              </select>
            </label>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">Data de início</span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                  type="date"
                  name="dataInicio"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">Duração (meses)</span>
                <input
                  className="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                  type="number"
                  name="duracaoMeses"
                  min="1"
                  placeholder="3"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Mensagem</span>
              <textarea
                className="h-24 w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500"
                name="mensagem"
                placeholder="Deixa-nos uma mensagem (opcional)"
              />
            </label>

            <label className="flex items-start gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <input
                className="mt-1 h-4 w-4 flex-none accent-emerald-600"
                type="checkbox"
                name="consentimento"
                required
              />
              <span className="text-sm text-slate-700">
                Autorizo o tratamento dos meus dados para efeitos de resposta a este
                pedido de aluguer, nos termos da{" "}
                <Link
                  className="font-medium text-emerald-600 underline hover:text-emerald-700"
                  href="/privacidade"
                  target="_blank"
                >
                  Política de Privacidade
                </Link>
                . <span className="text-red-600">*</span>
              </span>
            </label>

            {state?.error && (
              <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-700">{state.error}</p>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-4 sm:flex-row">
              <button
                className="flex-1 rounded-3xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                type="submit"
                disabled={isPending}
              >
                {isPending ? "A gravar..." : "Pedir aluguer"}
              </button>
              <Link
                className="flex-1 rounded-3xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-950 transition hover:border-slate-400 hover:bg-slate-50"
                href={`/moto/${motoId}`}
              >
                Cancelar
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
