"use client";

import { useState } from "react";
import { enviarDocPorToken, enviarAssinaturaPorToken } from "@/lib/uploads";
import { consentirPorToken, concluirPorToken, type SessaoPublica } from "@/actions/entregaActions";
import { ocrFicheiro } from "@/lib/ocr";
import { interpretarDocumento } from "@/lib/documentos";
import AssinaturaCanvas from "@/components/AssinaturaCanvas";

const DOC_SLOTS = [
  { key: "identidade", rotulo: "Documento de identidade" },
  { key: "carta_frente", rotulo: "Carta de condução (frente)" },
  { key: "carta_verso", rotulo: "Carta de condução (verso)" },
  { key: "morada", rotulo: "Comprovativo de morada (opcional)" },
];

const DOC_TIPOS = [
  { valor: "cc", rotulo: "Cartão de cidadão" },
  { valor: "passaporte", rotulo: "Passaporte" },
  { valor: "titulo_residencia", rotulo: "Título de residência" },
  { valor: "aima", rotulo: "Documento AIMA" },
];

const campo = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

export default function OnboardingEntrega({
  token,
  sessao,
}: {
  token: string;
  sessao: SessaoPublica;
}) {
  const [consentiu, setConsentiu] = useState(sessao.consentiu);
  const [aConsentir, setAConsentir] = useState(false);
  const [concluido, setConcluido] = useState(false);

  // Documentos
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [aCarregar, setACarregar] = useState<string | null>(null);
  // Dados
  const [nome, setNome] = useState(sessao.motorista_nome);
  const [tipo, setTipo] = useState("cc");
  const [numero, setNumero] = useState("");
  const [validade, setValidade] = useState("");
  const [identidadeFile, setIdentidadeFile] = useState<File | null>(null);
  const [aLerOcr, setALerOcr] = useState(false);
  // Carta de condução
  const [cartaNumero, setCartaNumero] = useState("");
  const [cartaCategoria, setCartaCategoria] = useState("");
  const [cartaPais, setCartaPais] = useState("");
  const [cartaValidade, setCartaValidade] = useState("");
  // Regras + assinatura
  const [regrasAceite, setRegrasAceite] = useState(false);
  const [assinatura, setAssinatura] = useState<Blob | null>(null);

  const [aSubmeter, setASubmeter] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const comecar = async () => {
    setErro(null);
    setAConsentir(true);
    const r = await consentirPorToken(token);
    setAConsentir(false);
    if (r.ok) setConsentiu(true);
    else setErro(r.error ?? "Erro.");
  };

  const carregarDoc = async (slot: string, file: File | undefined) => {
    if (!file) return;
    setErro(null);
    if (slot === "identidade") setIdentidadeFile(file);
    setACarregar(slot);
    const r = await enviarDocPorToken(token, file);
    setACarregar(null);
    if (r.success && r.path) setDocs((d) => ({ ...d, [slot]: r.path! }));
    else setErro(r.error ?? "Erro ao carregar.");
  };

  const lerDocumento = async () => {
    if (!identidadeFile) return;
    setErro(null);
    setALerOcr(true);
    try {
      const texto = await ocrFicheiro(identidadeFile);
      const d = interpretarDocumento(texto);
      if (d.nome) setNome(d.nome);
      if (d.numero) setNumero(d.numero);
      if (d.validade) setValidade(d.validade);
      if (!d.nome && !d.numero) setErro("Não consegui ler o documento — confirma os campos à mão.");
    } catch {
      setErro("Não consegui ler o documento — confirma os campos à mão.");
    } finally {
      setALerOcr(false);
    }
  };

  const submeter = async () => {
    setErro(null);
    if (!docs.identidade) return setErro("Carrega o documento de identidade.");
    if (!docs.carta_frente) return setErro("Carrega a frente da carta de condução.");
    if (sessao.regras && !regrasAceite) return setErro("Tens de aceitar as regras.");
    if (aCarregar) return setErro("Espera que os documentos acabem de carregar.");

    setASubmeter(true);
    let assinatura_path: string | null = null;
    if (assinatura) {
      const ra = await enviarAssinaturaPorToken(token, assinatura);
      if (!ra.success || !ra.path) { setErro("Erro ao enviar a assinatura."); setASubmeter(false); return; }
      assinatura_path = ra.path;
    }
    const r = await concluirPorToken({
      token,
      nome: nome || null,
      doc_id_tipo: tipo,
      doc_id_numero: numero || null,
      doc_id_validade: validade || null,
      doc_paths: DOC_SLOTS.map((s) => docs[s.key]).filter(Boolean) as string[],
      assinatura_path,
      regras_versao: sessao.regras?.versao ?? null,
      regras_hash: sessao.regras?.hash ?? null,
      carta_numero: cartaNumero || null,
      carta_categoria: cartaCategoria || null,
      carta_pais: cartaPais || null,
      carta_validade: cartaValidade || null,
    });
    setASubmeter(false);
    if (!r.ok) return setErro(r.error ?? "Erro ao submeter.");
    setConcluido(true);
  };

  if (concluido) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">✓</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-950">Está tudo enviado!</h1>
          <p className="mt-2 text-sm text-slate-600">
            Obrigado, {nome.split(" ")[0] || ""}. A GoScooters vai rever e vemo-nos na entrega da tua mota.
          </p>
        </div>
      </main>
    );
  }

  if (!consentiu) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">Preparar a entrega</h1>
          <p className="text-sm text-slate-600">
            Olá{sessao.motorista_nome ? ` ${sessao.motorista_nome.split(" ")[0]}` : ""}! Vamos preparar a
            entrega da <strong>{sessao.veiculo}</strong>. Leva 2 minutos: carregas os teus documentos,
            confirmas os dados e aceitas as regras.
          </p>
          <p className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-500">
            Ao continuar, autorizas a GoScooters a tratar os teus documentos para a gestão do aluguer,
            conforme a política de privacidade.
          </p>
          {erro && <p className="text-sm text-red-700">{erro}</p>}
          <button
            onClick={comecar}
            disabled={aConsentir}
            className="w-full rounded-3xl bg-emerald-600 px-6 py-4 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {aConsentir ? "..." : "Começar"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-8 pb-28">
      <h1 className="text-2xl font-semibold text-slate-950">Preparar a entrega</h1>
      <p className="text-sm text-slate-600">{sessao.veiculo}</p>

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Documentos</h2>
        <p className="text-xs text-slate-500">Tira uma foto nítida de cada um. Identidade e frente da carta são obrigatórias.</p>
        {DOC_SLOTS.map((s) => (
          <label key={s.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-400">
            <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => carregarDoc(s.key, e.target.files?.[0])} />
            <span>{s.rotulo}</span>
            <span className={docs[s.key] ? "text-emerald-600" : "text-slate-400"}>
              {aCarregar === s.key ? "a carregar…" : docs[s.key] ? "✓" : "câmara"}
            </span>
          </label>
        ))}
      </section>

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Os teus dados</h2>
        {identidadeFile && (
          <button
            type="button"
            onClick={lerDocumento}
            disabled={aLerOcr}
            className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {aLerOcr ? "a ler o documento…" : "✨ Ler documento automaticamente (opcional)"}
          </button>
        )}
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          <span>Nome completo</span>
          <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Tipo de documento</span>
            <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {DOC_TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Nº do documento</span>
            <input className={campo} value={numero} onChange={(e) => setNumero(e.target.value)} />
          </label>
        </div>
        <label className="block space-y-1.5 text-sm font-medium text-slate-700">
          <span>Validade do documento</span>
          <input className={campo} type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </label>
      </section>

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Carta de condução</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Nº da carta</span>
            <input className={campo} value={cartaNumero} onChange={(e) => setCartaNumero(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Categoria</span>
            <input className={campo} value={cartaCategoria} onChange={(e) => setCartaCategoria(e.target.value)} placeholder="A1, A, B…" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>País emissor</span>
            <input className={campo} value={cartaPais} onChange={(e) => setCartaPais(e.target.value)} placeholder="PT, BR…" maxLength={2} />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Validade</span>
            <input className={campo} type="date" value={cartaValidade} onChange={(e) => setCartaValidade(e.target.value)} />
          </label>
        </div>
      </section>

      {sessao.regras && (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Regras do aluguer</h2>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {sessao.regras.conteudo}
          </div>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={regrasAceite} onChange={(e) => setRegrasAceite(e.target.checked)} />
            <span>Li e <strong>aceito as regras</strong> (v{sessao.regras.versao}).</span>
          </label>
        </section>
      )}

      <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assinatura</h2>
        <p className="text-xs text-slate-500">Assina com o dedo.</p>
        <AssinaturaCanvas onChange={setAssinatura} />
      </section>

      {erro && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      <div className="sticky bottom-4">
        <button
          onClick={submeter}
          disabled={aSubmeter || !!aCarregar}
          className="w-full rounded-3xl bg-emerald-600 px-6 py-4 text-base font-semibold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {aSubmeter ? "A enviar…" : "Enviar"}
        </button>
      </div>
    </main>
  );
}
