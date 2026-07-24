"use client";

import { useState } from "react";
import { guardarRegras, type RegrasAtivas } from "@/actions/regrasActions";
import { dataBR } from "@/lib/datas";

export default function RegrasEditor({
  inicial,
  rascunho,
}: {
  inicial: RegrasAtivas | null;
  rascunho: string;
}) {
  const [texto, setTexto] = useState(inicial?.conteudo ?? rascunho);
  const [ativa, setAtiva] = useState<RegrasAtivas | null>(inicial);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const guardar = async () => {
    setErro(null);
    setOk(false);
    setAGravar(true);
    const r = await guardarRegras(texto);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao guardar.");
      return;
    }
    setAtiva({
      versao: r.versao ?? "",
      conteudo: texto.trim(),
      hash: r.hash ?? "",
      created_at: new Date().toISOString(),
    });
    setOk(true);
  };

  const alterado = texto.trim() !== (ativa?.conteudo ?? "").trim();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Regras do aluguer</h1>
        <p className="mt-1 text-slate-600">
          O texto que o motorista aceita na entrega. Cada gravação cria uma versão
          nova (com hash) — a prova de exatamente o que ele aceitou.
        </p>
      </div>

      {ativa ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-600">
          <span>Versão ativa: <strong className="text-slate-900">{ativa.versao}</strong></span>
          <span>· de {dataBR(ativa.created_at)}</span>
          {ativa.hash && <span className="font-mono">· hash {ativa.hash.slice(0, 12)}…</span>}
        </div>
      ) : (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Ainda não há regras publicadas — este é o rascunho inicial. Revê, ajusta os
          valores (caução, franquia, prazos) e clica em <strong>Publicar</strong>.
          (Se der erro ao guardar, corre <code>sql/fase4_regras.sql</code> no Supabase.)
        </p>
      )}

      <textarea
        className="h-[28rem] w-full rounded-3xl border border-slate-200 bg-white p-5 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={guardar}
          disabled={aGravar || !alterado}
          className="rounded-3xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {aGravar ? "A guardar…" : ativa ? "Publicar nova versão" : "Publicar"}
        </button>
        {!alterado && ativa && <span className="text-sm text-slate-400">Sem alterações por publicar.</span>}
        {ok && <span className="text-sm font-medium text-emerald-700">Publicado ✓</span>}
        {erro && <span className="text-sm text-red-700">{erro}</span>}
      </div>

      <p className="text-xs text-slate-500">
        Podes usar Markdown (títulos com <code>##</code>, listas). Aconselha-se rever
        as condições com apoio jurídico (cláusulas abusivas — DL 446/85).
      </p>
    </div>
  );
}
