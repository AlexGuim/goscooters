"use client";

import { useState } from "react";
import { perguntar } from "@/actions/chatActions";

interface Msg {
  de: "user" | "ia";
  texto: string;
}

const EXEMPLOS = [
  "Que seguros expiram nos próximos 30 dias?",
  "Que motos precisam de pneu ou revisão?",
  "Quanto deve o Seif?",
  "Quanto gastei em manutenção no último mês?",
];

export default function AssistenteChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [aPensar, setAPensar] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = input.trim();
    if (!p || aPensar) return;
    setMsgs((m) => [...m, { de: "user", texto: p }]);
    setInput("");
    setAPensar(true);
    const r = await perguntar(p);
    setAPensar(false);
    setMsgs((m) => [...m, { de: "ia", texto: r.success ? r.dados!.resposta : r.error ?? "Erro." }]);
  };

  return (
    <div className="space-y-4">
      {msgs.length === 0 && (
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Pergunta em linguagem natural sobre a frota. Exemplos:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXEMPLOS.map((ex) => (
              <button
                key={ex}
                onClick={() => setInput(ex)}
                className="rounded-2xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {msgs.length > 0 && (
        <div className="space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.de === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-3xl p-4 shadow-sm ${
                  m.de === "user" ? "bg-emerald-600 text-white" : "bg-white text-slate-800"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{m.texto}</p>
              </div>
            </div>
          ))}
          {aPensar && (
            <div className="flex justify-start">
              <div className="rounded-3xl bg-white p-4 text-sm text-slate-400 shadow-sm">A pensar…</div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={enviar} className="flex gap-2">
        <input
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Faz uma pergunta…"
        />
        <button
          type="submit"
          disabled={aPensar || !input.trim()}
          className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          Perguntar
        </button>
      </form>
      <p className="text-xs text-slate-400">
        Responde sobre seguros a expirar, manutenção a vencer, quem tinha uma moto numa data, dívidas e despesas. Só leitura.
      </p>
    </div>
  );
}
