"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createPedido } from "@/actions/createPedido";
import { precosDisponiveis, formatarPreco } from "@/lib/precos";
import type { Moto, Periodo } from "@/types/db";

interface PedidoFormProps {
  moto: Moto;
}

type State = {
  success?: boolean;
  error?: string;
  pedidoId?: string;
  whatsappLink?: string;
};

const campo =
  "w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500";

export default function PedidoForm({ moto }: PedidoFormProps) {
  const precos = precosDisponiveis(moto);

  // Pré-selecciona o único período quando só há um — não faz sentido pedir uma
  // escolha que não existe.
  const [periodo, setPeriodo] = useState<Periodo | "">(
    precos.length === 1 ? precos[0].periodo : "",
  );

  const precoEscolhido = precos.find((p) => p.periodo === periodo);

  const [state, formAction, isPending] = useActionState(
    async (_prev: State | undefined, formData: FormData): Promise<State> => {
      const duracaoBruta = formData.get("duracao") as string | null;

      const result = await createPedido({
        motoId: moto.id,
        nome: formData.get("nome") as string,
        telefone: formData.get("telefone") as string,
        email: (formData.get("email") as string) || undefined,
        plataforma: formData.get("plataforma") as string,
        dataInicio: (formData.get("dataInicio") as string) || undefined,
        periodo: (formData.get("periodo") as Periodo) || undefined,
        duracao: duracaoBruta ? parseInt(duracaoBruta, 10) : undefined,
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
      <main className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-sm">
          <div className="space-y-6 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <span className="text-2xl">✓</span>
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-950">Pedido recebido!</h1>
              <p className="mt-3 text-slate-600">
                Obrigado pelo teu interesse. Entraremos em contacto em breve para
                confirmar os detalhes.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              {state.whatsappLink && (
                <a
                  className="inline-flex items-center justify-center rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  href={state.whatsappLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Falar no WhatsApp
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
      </main>
    );
  }

  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">Pedir aluguer</h1>
            <p className="mt-2 text-slate-600">Mota: {moto.modelo}</p>
          </div>

          <form action={formAction} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Nome <span className="text-red-600">*</span>
                </span>
                <input className={campo} type="text" name="nome" required placeholder="João Silva" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Telefone <span className="text-red-600">*</span>
                </span>
                <input
                  className={campo}
                  type="tel"
                  name="telefone"
                  required
                  placeholder="+351 91 234 5678"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email (opcional)</span>
              <input className={campo} type="email" name="email" placeholder="joao@email.com" />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                Plataforma <span className="text-red-600">*</span>
              </span>
              <select className={campo} name="plataforma" required defaultValue="">
                <option value="">Selecciona uma plataforma</option>
                <option value="Uber">Uber</option>
                <option value="Glovo">Glovo</option>
                <option value="Bolt">Bolt</option>
                <option value="outro">Outro</option>
              </select>
            </label>

            {/* ── Período de aluguer ──────────────────────────────────────
                Só aparecem os períodos que esta mota oferece. Com um único
                período, mostra-se apenas a informação, sem escolha a fazer. */}
            <div className="space-y-3">
              <span className="text-sm font-medium text-slate-700">
                Período de aluguer <span className="text-red-600">*</span>
              </span>

              {precos.length === 1 ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <input type="hidden" name="periodo" value={precos[0].periodo} />
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold text-slate-950">
                      {precos[0].rotulos.nome}
                    </span>{" "}
                    — {formatarPreco(precos[0].valor)} por {precos[0].rotulos.unidade}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {precos.map((preco) => {
                    const activo = periodo === preco.periodo;

                    return (
                      <label
                        key={preco.periodo}
                        className={`cursor-pointer rounded-3xl border px-4 py-3 transition ${
                          activo
                            ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="periodo"
                          value={preco.periodo}
                          checked={activo}
                          onChange={() => setPeriodo(preco.periodo)}
                          required
                        />
                        <span className="block text-xs uppercase tracking-wide text-slate-500">
                          {preco.rotulos.nome}
                        </span>
                        <span className="mt-1 block text-lg font-semibold text-slate-950">
                          {formatarPreco(preco.valor)}
                        </span>
                        <span className="block text-xs text-slate-500">
                          por {preco.rotulos.unidade}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">Data de início</span>
                <input className={campo} type="date" name="dataInicio" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">
                  Duração{" "}
                  <span className="text-slate-500">
                    ({precoEscolhido ? precoEscolhido.rotulos.plural : "escolhe o período"})
                  </span>
                </span>
                <input
                  className={campo}
                  type="number"
                  name="duracao"
                  min="1"
                  placeholder="3"
                  disabled={!precoEscolhido}
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Mensagem</span>
              <textarea
                className={`${campo} h-24`}
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
                href={`/moto/${moto.id}`}
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
