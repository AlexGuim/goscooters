"use client";

import { useEffect, useRef, useState } from "react";
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

type Lang = "pt" | "en";
type EstadoLeitura = "idle" | "lendo" | "ok" | "falhou";

const DOC_SLOTS: { key: string; pt: string; en: string }[] = [
  { key: "identidade", pt: "Documento de identidade (frente)", en: "ID document (front)" },
  { key: "identidade_verso", pt: "Documento de identidade (verso)", en: "ID document (back)" },
  { key: "carta_frente", pt: "Carta de condução (frente)", en: "Driving licence (front)" },
  { key: "carta_verso", pt: "Carta de condução (verso)", en: "Driving licence (back)" },
  { key: "morada", pt: "Comprovativo de morada (opcional)", en: "Proof of address (optional)" },
];

// A MRZ do cartão de cidadão está no VERSO, por isso lê-se frente + verso.
const SLOTS_IDENTIDADE = ["identidade", "identidade_verso"];
const SLOTS_CARTA = ["carta_frente", "carta_verso"];
const SLOTS_IMAGEM = [...SLOTS_IDENTIDADE, ...SLOTS_CARTA];

const DOC_TIPOS: { valor: string; pt: string; en: string }[] = [
  { valor: "cc", pt: "Cartão de cidadão", en: "ID card" },
  { valor: "passaporte", pt: "Passaporte", en: "Passport" },
  { valor: "titulo_residencia", pt: "Título de residência", en: "Residence permit" },
  { valor: "aima", pt: "Documento AIMA", en: "AIMA document" },
];

const STR: Record<Lang, Record<string, string>> = {
  pt: {
    enviado_titulo: "Está tudo enviado!",
    obrigado: "Obrigado",
    review_registo: "A GoScooters vai rever os teus dados e entra em contacto.",
    review_entrega: "A GoScooters vai rever e vemo-nos na entrega da tua mota.",
    titulo_registo: "Os teus dados",
    titulo_entrega: "Preparar a entrega",
    aviso: "Ao enviar, autorizas a GoScooters a tratar os teus documentos para a gestão do aluguer, conforme a política de privacidade.",
    docs_titulo: "Documentos",
    docs_ajuda: "Tira uma foto nítida ou escolhe do telemóvel. Identidade (frente e verso) e frente da carta são obrigatórias.",
    a_carregar: "a carregar…",
    foto_ficheiro: "foto / ficheiro",
    lendo_id: "✨ A ler o documento de identidade…",
    lendo_carta: "✨ A ler a carta de condução…",
    ok_id: "✓ Dados do documento preenchidos — confirma que estão certos.",
    ok_carta: "✓ Dados da carta preenchidos — confirma que estão certos.",
    falhou_id: "Não consegui ler o documento — preenche os campos à mão.",
    falhou_carta: "Não consegui ler a carta — preenche os campos à mão.",
    id_titulo: "Identidade",
    nome_completo: "Nome completo",
    tipo_doc: "Tipo de documento",
    num_doc: "Nº do documento",
    validade_doc: "Validade do documento",
    carta_titulo: "Carta de condução",
    num_carta: "Nº da carta",
    categoria: "Categoria",
    pais_emissor: "País emissor",
    validade: "Validade",
    regras_titulo: "Regras do aluguer",
    regras_pre: "Li e ",
    regras_strong: "aceito as regras",
    assinatura_titulo: "Assinatura",
    assinatura_ajuda: "Assina com o dedo.",
    enviar: "Enviar",
    a_enviar: "A enviar…",
    err_identidade: "Carrega o documento de identidade.",
    err_carta: "Carrega a frente da carta de condução.",
    err_regras: "Tens de aceitar as regras.",
    err_espera: "Espera que os documentos acabem de carregar.",
    err_assinatura: "Erro ao enviar a assinatura.",
    err_submeter: "Erro ao submeter.",
    err_carregar: "Erro ao carregar.",
    err_generico: "Erro.",
  },
  en: {
    enviado_titulo: "All done!",
    obrigado: "Thank you",
    review_registo: "GoScooters will review your details and get in touch.",
    review_entrega: "GoScooters will review and see you at your scooter handover.",
    titulo_registo: "Your details",
    titulo_entrega: "Prepare your handover",
    aviso: "By submitting, you authorise GoScooters to process your documents for rental management, in line with the privacy policy.",
    docs_titulo: "Documents",
    docs_ajuda: "Take a clear photo or pick from your phone. ID (front and back) and the front of your licence are required.",
    a_carregar: "uploading…",
    foto_ficheiro: "photo / file",
    lendo_id: "✨ Reading your ID document…",
    lendo_carta: "✨ Reading your driving licence…",
    ok_id: "✓ ID details filled in — please check they are correct.",
    ok_carta: "✓ Licence details filled in — please check they are correct.",
    falhou_id: "I couldn't read the document — please fill in the fields manually.",
    falhou_carta: "I couldn't read the licence — please fill in the fields manually.",
    id_titulo: "Identity",
    nome_completo: "Full name",
    tipo_doc: "Document type",
    num_doc: "Document number",
    validade_doc: "Document expiry",
    carta_titulo: "Driving licence",
    num_carta: "Licence number",
    categoria: "Category",
    pais_emissor: "Issuing country",
    validade: "Expiry",
    regras_titulo: "Rental rules",
    regras_pre: "I have read and ",
    regras_strong: "accept the rules",
    assinatura_titulo: "Signature",
    assinatura_ajuda: "Sign with your finger.",
    enviar: "Send",
    a_enviar: "Sending…",
    err_identidade: "Upload your ID document.",
    err_carta: "Upload the front of your driving licence.",
    err_regras: "You must accept the rules.",
    err_espera: "Wait for the documents to finish uploading.",
    err_assinatura: "Error uploading the signature.",
    err_submeter: "Error submitting.",
    err_carregar: "Upload error.",
    err_generico: "Error.",
  },
};

const campo = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";

export default function OnboardingEntrega({
  token,
  sessao,
}: {
  token: string;
  sessao: SessaoPublica;
}) {
  const registo = sessao.registo;
  const lang = sessao.idioma;
  const t = STR[lang];
  const rotulo = (o: { pt: string; en: string }) => (lang === "en" ? o.en : o.pt);

  const [concluido, setConcluido] = useState(false);

  // Documentos
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [aCarregar, setACarregar] = useState<string | null>(null);
  // Dados
  const [nome, setNome] = useState(sessao.motorista_nome);
  const [tipo, setTipo] = useState("cc");
  const [numero, setNumero] = useState("");
  const [validade, setValidade] = useState("");
  const [cartaNumero, setCartaNumero] = useState("");
  const [cartaCategoria, setCartaCategoria] = useState("");
  const [cartaPais, setCartaPais] = useState("");
  const [cartaValidade, setCartaValidade] = useState("");
  // Estado da leitura automática, por documento.
  const [estadoId, setEstadoId] = useState<EstadoLeitura>("idle");
  const [estadoCarta, setEstadoCarta] = useState<EstadoLeitura>("idle");
  // Ficheiros de identidade (recurso Tesseract) e caminhos no bucket (leitura IA).
  const identidadeFilesRef = useRef<Record<string, File>>({});
  const pathsRef = useRef<Record<string, string>>({});
  // Regras + assinatura (só na entrega)
  const [regrasAceite, setRegrasAceite] = useState(false);
  const [assinatura, setAssinatura] = useState<Blob | null>(null);

  const [aSubmeter, setASubmeter] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Consentimento RGPD: registado automaticamente ao abrir (sem ecrã à parte).
  const consentidoRef = useRef(sessao.consentiu);
  const garantirConsentimento = async (): Promise<boolean> => {
    if (consentidoRef.current) return true;
    const r = await consentirPorToken(token);
    if (r.ok) { consentidoRef.current = true; return true; }
    setErro(r.error ?? t.err_generico);
    return false;
  };
  useEffect(() => {
    // Regista o consentimento no servidor ao abrir (sincroniza com o servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    garantirConsentimento();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aplicar = (c: {
    nome?: string | null; numero?: string | null; validade?: string | null; tipo?: string | null;
    carta_numero?: string | null; carta_categoria?: string | null; carta_pais?: string | null; carta_validade?: string | null;
  }) => {
    if (c.nome) setNome(c.nome);
    if (c.numero) setNumero(c.numero);
    if (c.validade) setValidade(c.validade);
    if (c.tipo && ["cc", "passaporte", "titulo_residencia", "aima"].includes(c.tipo)) setTipo(c.tipo);
    if (c.carta_numero) setCartaNumero(c.carta_numero);
    if (c.carta_categoria) setCartaCategoria(c.carta_categoria);
    if (c.carta_pais) setCartaPais(c.carta_pais.toUpperCase());
    if (c.carta_validade) setCartaValidade(c.carta_validade);
  };

  // Lê um grupo (identidade OU carta). O Gemini extrai só os campos presentes na
  // imagem; a identidade recorre ao Tesseract se a IA falhar (tem MRZ).
  const analisarGrupo = async (grupo: "identidade" | "carta") => {
    const slots = grupo === "identidade" ? SLOTS_IDENTIDADE : SLOTS_CARTA;
    const paths = slots.map((s) => pathsRef.current[s]).filter(Boolean);
    if (!paths.length) return;
    const setEstado = grupo === "identidade" ? setEstadoId : setEstadoCarta;
    setEstado("lendo");
    try {
      const r = await lerDocumentoIAporToken(token, paths);
      let ok = false;
      if (r.ok && r.dados) {
        if (grupo === "identidade") {
          aplicar({ nome: r.dados.nome, numero: r.dados.doc_id_numero, validade: r.dados.doc_id_validade, tipo: r.dados.doc_id_tipo });
          ok = !!(r.dados.nome || r.dados.doc_id_numero || r.dados.doc_id_validade);
        } else {
          aplicar({ carta_numero: r.dados.carta_numero, carta_categoria: r.dados.carta_categoria, carta_pais: r.dados.carta_pais, carta_validade: r.dados.carta_validade });
          ok = !!(r.dados.carta_numero || r.dados.carta_categoria || r.dados.carta_validade);
        }
      } else if (grupo === "identidade") {
        const files = Object.values(identidadeFilesRef.current);
        if (files.length) {
          const textos = await Promise.all(files.map((f) => ocrFicheiro(f)));
          const d = interpretarDocumento(textos.join("\n"));
          aplicar({ nome: d.nome, numero: d.numero, validade: d.validade, tipo: d.tipo });
          ok = !!(d.nome || d.numero);
        }
      }
      setEstado(ok ? "ok" : "falhou");
    } catch {
      setEstado("falhou");
    }
  };

  const carregarDoc = async (slot: string, file: File | undefined) => {
    if (!file) return;
    setErro(null);
    if (!(await garantirConsentimento())) return;
    setACarregar(slot);
    const r = await enviarDocPorToken(token, file);
    setACarregar(null);
    if (r.success && r.path) {
      setDocs((d) => ({ ...d, [slot]: r.path! }));
      if (SLOTS_IMAGEM.includes(slot) && file.type.startsWith("image/")) {
        pathsRef.current[slot] = r.path;
        if (SLOTS_IDENTIDADE.includes(slot)) {
          identidadeFilesRef.current[slot] = file;
          analisarGrupo("identidade");
        } else {
          analisarGrupo("carta");
        }
      }
    } else setErro(r.error ?? t.err_carregar);
  };

  const submeter = async () => {
    setErro(null);
    if (!docs.identidade) return setErro(t.err_identidade);
    if (!docs.carta_frente) return setErro(t.err_carta);
    if (sessao.regras && !regrasAceite) return setErro(t.err_regras);
    if (aCarregar) return setErro(t.err_espera);

    setASubmeter(true);
    let assinatura_path: string | null = null;
    if (assinatura) {
      const ra = await enviarAssinaturaPorToken(token, assinatura);
      if (!ra.success || !ra.path) { setErro(t.err_assinatura); setASubmeter(false); return; }
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
    if (!r.ok) return setErro(r.error ?? t.err_submeter);
    setConcluido(true);
  };

  if (concluido) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">✓</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-950">{t.enviado_titulo}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {t.obrigado}, {nome.split(" ")[0] || ""}.{" "}
            {registo ? t.review_registo : t.review_entrega}
          </p>
        </div>
      </main>
    );
  }

  const estadoTexto = (e: EstadoLeitura, doc: "id" | "carta") => {
    if (e === "lendo") return <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{doc === "id" ? t.lendo_id : t.lendo_carta}</p>;
    if (e === "ok") return <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{doc === "id" ? t.ok_id : t.ok_carta}</p>;
    return <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">{doc === "id" ? t.falhou_id : t.falhou_carta}</p>;
  };

  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-8 pb-28">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{registo ? t.titulo_registo : t.titulo_entrega}</h1>
        {!registo && <p className="text-sm text-slate-600">{sessao.veiculo}</p>}
        <p className="mt-1 text-xs text-slate-400">{t.aviso}</p>
      </div>

      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t.docs_titulo}</h2>
        <p className="text-xs text-slate-500">{t.docs_ajuda}</p>
        {DOC_SLOTS.map((s) => (
          <label key={s.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-emerald-400">
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => carregarDoc(s.key, e.target.files?.[0])} />
            <span>{rotulo(s)}</span>
            <span className={docs[s.key] ? "text-emerald-600" : "text-slate-400"}>
              {aCarregar === s.key ? t.a_carregar : docs[s.key] ? "✓" : t.foto_ficheiro}
            </span>
          </label>
        ))}
      </section>

      {/* Identidade — só aparece depois de ler (ou falhar) */}
      {estadoId !== "idle" && (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t.id_titulo}</h2>
          {estadoTexto(estadoId, "id")}
          {estadoId !== "lendo" && (
            <>
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.nome_completo}</span>
                <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                  <span>{t.tipo_doc}</span>
                  <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    {DOC_TIPOS.map((d) => <option key={d.valor} value={d.valor}>{rotulo(d)}</option>)}
                  </select>
                </label>
                <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                  <span>{t.num_doc}</span>
                  <input className={campo} value={numero} onChange={(e) => setNumero(e.target.value)} />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.validade_doc}</span>
                <input className={campo} type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
              </label>
            </>
          )}
        </section>
      )}

      {/* Carta — só aparece depois de ler (ou falhar) */}
      {estadoCarta !== "idle" && (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t.carta_titulo}</h2>
          {estadoTexto(estadoCarta, "carta")}
          {estadoCarta !== "lendo" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.num_carta}</span>
                <input className={campo} value={cartaNumero} onChange={(e) => setCartaNumero(e.target.value)} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.categoria}</span>
                <input className={campo} value={cartaCategoria} onChange={(e) => setCartaCategoria(e.target.value)} placeholder="A1, A, B…" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.pais_emissor}</span>
                <input className={campo} value={cartaPais} onChange={(e) => setCartaPais(e.target.value)} placeholder="PT, BR…" maxLength={2} />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-slate-700">
                <span>{t.validade}</span>
                <input className={campo} type="date" value={cartaValidade} onChange={(e) => setCartaValidade(e.target.value)} />
              </label>
            </div>
          )}
        </section>
      )}

      {!registo && sessao.regras && (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t.regras_titulo}</h2>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {sessao.regras.conteudo}
          </div>
          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={regrasAceite} onChange={(e) => setRegrasAceite(e.target.checked)} />
            <span>{t.regras_pre}<strong>{t.regras_strong}</strong> (v{sessao.regras.versao}).</span>
          </label>
        </section>
      )}

      {!registo && (
        <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t.assinatura_titulo}</h2>
          <p className="text-xs text-slate-500">{t.assinatura_ajuda}</p>
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
          {aSubmeter ? t.a_enviar : t.enviar}
        </button>
      </div>
    </main>
  );
}
