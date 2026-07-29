"use client";

import { useState } from "react";
import { guardarRegras, type RegrasAtivas } from "@/actions/regrasActions";
import { dataBR } from "@/lib/datas";
import { Botao } from "@/components/ui";
import { cx } from "@/components/ui/estilos";

type Lang = "pt" | "en";
const LINGUAS: { v: Lang; r: string }[] = [
  { v: "pt", r: "Português" },
  { v: "en", r: "English" },
];

/**
 * Editor das regras do aluguer, por LÍNGUA. Cada língua tem a sua versão ativa
 * (o motorista aceita as regras na sua língua). Publicar cria uma versão nova
 * (com hash) dessa língua — a prova do que foi aceite.
 */
export default function RegrasEditor({
  pt,
  en,
  rascunho,
}: {
  pt: RegrasAtivas | null;
  en: RegrasAtivas | null;
  rascunho: string;
}) {
  const [ativas, setAtivas] = useState<Record<Lang, RegrasAtivas | null>>({ pt, en });
  const [idioma, setIdioma] = useState<Lang>("pt");
  const base = (lang: Lang) => ativas[lang]?.conteudo ?? (lang === "pt" ? rascunho : "");
  const [texto, setTexto] = useState(base("pt"));
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const trocar = (lang: Lang) => {
    if (lang === idioma) return;
    setIdioma(lang);
    setTexto(base(lang));
    setOk(false);
    setErro(null);
  };

  const guardar = async () => {
    setErro(null);
    setOk(false);
    setAGravar(true);
    const r = await guardarRegras(texto, idioma);
    setAGravar(false);
    if (!r.success) {
      setErro(r.error ?? "Erro ao guardar.");
      return;
    }
    setAtivas((a) => ({
      ...a,
      [idioma]: { versao: r.versao ?? "", conteudo: texto.trim(), hash: r.hash ?? "", created_at: new Date().toISOString() },
    }));
    setOk(true);
  };

  const ativa = ativas[idioma];
  const alterado = texto.trim() !== (ativa?.conteudo ?? "").trim();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-950">Regras do aluguer</h1>
        <p className="mt-1 text-slate-600">
          O texto que o motorista aceita na entrega — na <strong>língua dele</strong>. Cada gravação
          cria uma versão nova (com hash), a prova do que ele aceitou.
        </p>
      </div>

      {/* Seletor de língua */}
      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
        {LINGUAS.map((l) => (
          <button
            key={l.v}
            onClick={() => trocar(l.v)}
            className={cx(
              "rounded-xl px-4 py-1.5 text-sm font-semibold transition",
              idioma === l.v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {l.r}
            {!ativas[l.v] && <span className="ml-1 text-[10px] font-normal opacity-70">(sem versão)</span>}
          </button>
        ))}
      </div>

      {ativa ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-600">
          <span>Versão ativa ({idioma.toUpperCase()}): <strong className="text-slate-900">{ativa.versao}</strong></span>
          <span>· de {dataBR(ativa.created_at)}</span>
          {ativa.hash && <span className="font-mono">· hash {ativa.hash.slice(0, 12)}…</span>}
        </div>
      ) : (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {idioma === "pt"
            ? "Ainda não há regras em português — revê o rascunho e publica. (Se der erro, corre sql/fase4_regras.sql e sql/fase9_regras_idioma.sql.)"
            : "Ainda não há versão em inglês. Traduz o texto (o motorista de língua inglesa verá esta versão; sem ela, recua para a portuguesa) e publica."}
        </p>
      )}

      <textarea
        className="h-[28rem] w-full rounded-3xl border border-slate-200 bg-white p-5 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-4">
        <Botao onClick={guardar} disabled={aGravar || !alterado}>
          {aGravar ? "A guardar…" : ativa ? "Publicar nova versão" : "Publicar"}
        </Botao>
        {!alterado && ativa && <span className="text-sm text-slate-400">Sem alterações por publicar.</span>}
        {ok && <span className="text-sm font-medium text-emerald-700">Publicado ✓</span>}
        {erro && <span className="text-sm text-red-700">{erro}</span>}
      </div>

      <p className="text-xs text-slate-500">
        Podes usar Markdown (títulos com <code>##</code>, listas). Aconselha-se rever as condições com
        apoio jurídico (cláusulas abusivas — DL 446/85).
      </p>
    </div>
  );
}
