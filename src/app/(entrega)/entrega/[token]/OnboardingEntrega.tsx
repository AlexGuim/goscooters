"use client";

import { useRef, useState } from "react";
import { enviarDocPorToken, enviarAssinaturaPorToken } from "@/lib/uploads";
import {
  consentirPorToken,
  concluirPorToken,
  lerDocumentoIAporToken,
  type SessaoPublica,
} from "@/actions/entregaActions";
import { ocrFicheiro } from "@/lib/ocr";
import { interpretarDocumento } from "@/lib/documentos";
import AssinaturaCanvas from "@/components/AssinaturaCanvas";

const DOC_SLOTS = [
  { key: "identidade", rotulo: "Documento de identidade (frente)" },
  { key: "identidade_verso", rotulo: "Documento de identidade (verso)" },
  { key: "carta_frente", rotulo: "Carta de condução (frente)" },
  { key: "carta_verso", rotulo: "Carta de condução (verso)" },
  { key: "morada", rotulo: "Comprovativo de morada (opcional)" },
];

// Slots do documento de identidade — a MRZ do cartão de cidadão está no VERSO,
// por isso lê-se frente + verso.
const SLOTS_IDENTIDADE = ["identidade", "identidade_verso"];
// Slots com imagem que alimentam a leitura automática (identidade + carta).
const SLOTS_IMAGEM = ["identidade", "identidade_verso", "carta_frente", "carta_verso"];

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
  const registo = sessao.registo;
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
  // Ficheiros de identidade (frente/verso) para o recurso Tesseract, e caminhos
  // no bucket de todas as imagens (identidade+carta) para a leitura por IA.
  const identidadeFilesRef = useRef<Record<string, File>>({});
  const pathsRef = useRef<Record<string, string>>({});
  const [aLerOcr, setALerOcr] = useState(false);
  const [ocrEstado, setOcrEstado] = useState<"idle" | "ok" | "falhou">("idle");
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
    setACarregar(slot);
    const r = await enviarDocPorToken(token, file);
    setACarregar(null);
    if (r.success && r.path) {
      setDocs((d) => ({ ...d, [slot]: r.path! }));
      // Imagem de identidade/carta: guarda o caminho e corre a leitura automática.
      if (SLOTS_IMAGEM.includes(slot) && file.type.startsWith("image/")) {
        pathsRef.current[slot] = r.path;
        if (SLOTS_IDENTIDADE.includes(slot)) identidadeFilesRef.current[slot] = file;
        analisarDocumentos();
      }
    } else setErro(r.error ?? "Erro ao carregar.");
  };

  // Preenche o formulário a partir dos campos lidos (só o que veio preenchido).
  const aplicar = (c: {
    nome?: string | null; numero?: string | null; validade?: string | null;
    tipo?: string | null; carta_numero?: string | null; carta_categoria?: string | null;
    carta_pais?: string | null; carta_validade?: string | null;
  }): boolean => {
    if (c.nome) setNome(c.nome);
    if (c.numero) setNumero(c.numero);
    if (c.validade) setValidade(c.validade);
    if (c.tipo && ["cc", "passaporte", "titulo_residencia", "aima"].includes(c.tipo)) setTipo(c.tipo);
    if (c.carta_numero) setCartaNumero(c.carta_numero);
    if (c.carta_categoria) setCartaCategoria(c.carta_categoria);
    if (c.carta_pais) setCartaPais(c.carta_pais.toUpperCase());
    if (c.carta_validade) setCartaValidade(c.carta_validade);
    return !!(c.nome || c.numero || c.carta_numero);
  };

  // Leitura automática: tenta o Gemini (servidor, lê identidade+carta); se não
  // houver chave ou falhar, recorre ao OCR do browser (Tesseract) na identidade.
  const analisarDocumentos = async () => {
    const paths = Object.values(pathsRef.current);
    if (!paths.length) return;
    setALerOcr(true);
    setOcrEstado("idle");
    try {
      const r = await lerDocumentoIAporToken(token, paths);
      if (r.ok && r.dados) {
        const ok = aplicar({
          nome: r.dados.nome,
          numero: r.dados.doc_id_numero,
          validade: r.dados.doc_id_validade,
          tipo: r.dados.doc_id_tipo,
          carta_numero: r.dados.carta_numero,
          carta_categoria: r.dados.carta_categoria,
          carta_pais: r.dados.carta_pais,
          carta_validade: r.dados.carta_validade,
        });
        setOcrEstado(ok ? "ok" : "falhou");
        return;
      }
      // Sem IA (sem chave) ou falha → Tesseract nas imagens de identidade.
      const files = Object.values(identidadeFilesRef.current);
      if (files.length) {
        const textos = await Promise.all(files.map((f) => ocrFicheiro(f)));
        const d = interpretarDocumento(textos.join("\n"));
        const ok = aplicar({ nome: d.nome, numero: d.numero, validade: d.validade, tipo: d.tipo });
        setOcrEstado(ok ? "ok" : "falhou");
      } else {
        setOcrEstado("falhou");
      }
    } catch {
      setOcrEstado("falhou");
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
            Obrigado, {nome.split(" ")[0] || ""}.{" "}
            {registo
              ? "A GoScooters vai rever os teus dados e entra em contacto."
              : "A GoScooters vai rever e vemo-nos na entrega da tua mota."}
          </p>
        </div>
      </main>
    );
  }

  if (!consentiu) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-5 rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">
            {registo ? "Registo do motorista" : "Preparar a entrega"}
          </h1>
          <p className="text-sm text-slate-600">
            Olá{sessao.motorista_nome ? ` ${sessao.motorista_nome.split(" ")[0]}` : ""}!{" "}
            {registo ? (
              "Vamos registar os teus dados. Leva 2 minutos: carregas os teus documentos e confirmas os dados."
            ) : (
              <>
                Vamos preparar a entrega da <strong>{sessao.veiculo}</strong>. Leva 2 minutos:
                carregas os teus documentos, confirmas os dados e aceitas as regras.
              </>
            )}
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
      <h1 className="text-2xl font-semibold text-slate-950">
        {registo ? "Os teus dados" : "Preparar a entrega"}
      </h1>
      {!registo && <p className="text-sm text-slate-600">{sessao.veiculo}</p>}

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Documentos</h2>
        <p className="text-xs text-slate-500">Tira uma foto nítida ou escolhe do telemóvel. Identidade (frente e verso) e frente da carta são obrigatórias.</p>
        {DOC_SLOTS.map((s) => (
          <label key={s.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-400">
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => carregarDoc(s.key, e.target.files?.[0])} />
            <span>{s.rotulo}</span>
            <span className={docs[s.key] ? "text-emerald-600" : "text-slate-400"}>
              {aCarregar === s.key ? "a carregar…" : docs[s.key] ? "✓" : "foto / ficheiro"}
            </span>
          </label>
        ))}
      </section>

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Os teus dados</h2>
        {aLerOcr ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            ✨ A ler o documento…
          </p>
        ) : ocrEstado === "ok" ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
            ✓ Preenchi os dados a partir do documento — confirma que estão certos.
          </p>
        ) : ocrEstado === "falhou" ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
            Não consegui ler o documento automaticamente — preenche os campos à mão.
          </p>
        ) : null}
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

      {!registo && (
        <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assinatura</h2>
          <p className="text-xs text-slate-500">Assina com o dedo.</p>
          <AssinaturaCanvas onChange={setAssinatura} />
        </section>
      )}

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
