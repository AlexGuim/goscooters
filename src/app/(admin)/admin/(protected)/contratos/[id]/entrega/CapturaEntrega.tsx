"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { enviarFotoPrivada, enviarVideoPrivado, enviarAssinaturaPrivada } from "@/lib/uploads";
import { submeterVistoriaEntrega, submeterVistoriaRecolha, type DanoPrevio, type MaterialLinha } from "@/actions/vistoriaActions";
import { lerDocumentoIA, urlAssinado } from "@/actions/fotoActions";
import { ocrFicheiro } from "@/lib/ocr";
import { interpretarDocumento } from "@/lib/documentos";
import { nomeInicial } from "@/lib/nomeMotorista";
import AssinaturaCanvas from "@/components/AssinaturaCanvas";
import { formatarPreco } from "@/lib/precos";
import { hrefJornada } from "@/lib/jornada";

interface ContratoInfo {
  id: string;
  numero: string;
  preco_periodo: string;
  caucao: string | null;
  motorista_nome: string;
  veiculo: string;
  km_atual: number | null;
}

const SLOTS = [
  { key: "frente", rotulo: "Frente" },
  { key: "traseira", rotulo: "Traseira" },
  { key: "lateral_esq", rotulo: "Lateral esquerda" },
  { key: "lateral_dir", rotulo: "Lateral direita" },
  { key: "painel", rotulo: "Painel (KM + combustível)" },
  { key: "extra", rotulo: "Extra / detalhe" },
];

const CHECK = [
  { key: "luzes", rotulo: "Luzes OK" },
  { key: "travoes", rotulo: "Travões OK" },
  { key: "pneus", rotulo: "Pneus OK" },
  { key: "espelhos", rotulo: "Espelhos OK" },
];

// Catálogo de materiais entregues com a mota (os documentos e o capacete
// passaram para aqui — deixaram de ser "estado"). qtd é a quantidade padrão.
const MATERIAIS: { key: string; rotulo: string; qtd: number }[] = [
  { key: "capacete", rotulo: "Capacete", qtd: 1 },
  { key: "colete", rotulo: "Colete refletor", qtd: 1 },
  { key: "suporte_telemovel", rotulo: "Suporte de telemóvel", qtd: 1 },
  { key: "chaves", rotulo: "Chaves", qtd: 2 },
  { key: "documentos", rotulo: "Livrete / documentos", qtd: 1 },
  { key: "bau", rotulo: "Baú / top case", qtd: 1 },
];

// Base sem largura: para inputs que vivem num flex (materiais) e não podem levar
// `w-full`, que colidiria com `flex-1`/`w-16` (mesma especificidade no Tailwind).
const campoBase = "rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const campo = `w-full ${campoBase}`;

interface MotoristaKycInfo {
  id: string;
  nome: string;
  nif: string | null;
  nif_valido: boolean | null;
  doc_id_tipo: string | null;
  doc_id_numero: string | null;
  doc_id_validade: string | null;
  doc_urls: string[] | null;
  carta_numero: string | null;
  carta_categoria: string | null;
  carta_pais: string | null;
  carta_validade: string | null;
  morada_linha1: string | null;
  codigo_postal: string | null;
  localidade: string | null;
}

const DOC_TIPOS = [
  { v: "cc", r: "Cartão de cidadão" },
  { v: "passaporte", r: "Passaporte" },
  { v: "titulo_residencia", r: "Título de residência" },
  { v: "aima", r: "AIMA" },
];

// Slots de documentos (frente/verso), como no link do motorista. O grupo dispara
// a leitura por IA (identidade / carta); o comprovativo é só ficheiro.
const DOC_SLOTS: { key: string; rotulo: string; grupo: "identidade" | "carta" | null }[] = [
  { key: "identidade", rotulo: "Documento (frente)", grupo: "identidade" },
  { key: "identidade_verso", rotulo: "Documento (verso)", grupo: "identidade" },
  { key: "carta_frente", rotulo: "Carta (frente)", grupo: "carta" },
  { key: "carta_verso", rotulo: "Carta (verso)", grupo: "carta" },
  { key: "comprovativo", rotulo: "Comprovativo de morada", grupo: null },
];

export default function CapturaEntrega({
  contrato,
  jaEntregue,
  regras,
  tipo = "entrega",
  materiaisEntregues,
  motorista,
}: {
  contrato: ContratoInfo;
  jaEntregue: boolean;
  regras: { versao: string; hash: string; conteudo: string } | null;
  tipo?: "entrega" | "recolha";
  // Na recolha: a lista de materiais que foi entregue, para conferir a devolução.
  materiaisEntregues?: MaterialLinha[];
  // Na entrega: o motorista e o seu KYC atual, para completar e validar os
  // documentos obrigatórios antes de ativar o contrato.
  motorista?: MotoristaKycInfo;
}) {
  const recolha = tipo === "recolha";
  const [km, setKm] = useState(contrato.km_atual != null ? String(contrato.km_atual) : "");
  const [combustivel, setCombustivel] = useState(100);
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  // Uploads em voo (por slot). É um Set, não uma string única: com vários
  // ficheiros a subir ao mesmo tempo, o primeiro a acabar não pode reabrir o
  // submeter enquanto outro ainda está a carregar.
  const [aCarregar, setACarregar] = useState<Set<string>>(new Set());
  const marcarUpload = (slot: string) => setACarregar((s) => new Set(s).add(slot));
  const desmarcarUpload = (slot: string) =>
    setACarregar((s) => {
      const n = new Set(s);
      n.delete(slot);
      return n;
    });
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoNome, setVideoNome] = useState<string | null>(null);
  const [danos, setDanos] = useState<DanoPrevio[]>([]);
  const [materiais, setMateriais] = useState<MaterialLinha[]>(() =>
    recolha
      ? (materiaisEntregues ?? []).map((m) => ({ ...m, devolvido: true }))
      : MATERIAIS.map((m) => ({ ...m, entregue: true })),
  );
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const custoIdRef = useRef(0);
  const [notas, setNotas] = useState("");
  const [assinatura, setAssinatura] = useState<Blob | null>(null);
  const [regrasAceite, setRegrasAceite] = useState(false);
  const [aSubmeter, setASubmeter] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // KYC do motorista (só na entrega): pré-preenchido com o que já existe. O nome
  // começa vazio quando ainda é o placeholder, para forçar a confirmação.
  const [nomeKyc, setNomeKyc] = useState(nomeInicial(motorista?.nome));
  const [nif, setNif] = useState(motorista?.nif ?? "");
  const [docTipo, setDocTipo] = useState(motorista?.doc_id_tipo ?? "cc");
  const [docNumero, setDocNumero] = useState(motorista?.doc_id_numero ?? "");
  const [docValidade, setDocValidade] = useState(motorista?.doc_id_validade ?? "");
  const [cartaNumero, setCartaNumero] = useState(motorista?.carta_numero ?? "");
  const [cartaValidade, setCartaValidade] = useState(motorista?.carta_validade ?? "");
  const [morada, setMorada] = useState(motorista?.morada_linha1 ?? "");
  const [codigoPostal, setCodigoPostal] = useState(motorista?.codigo_postal ?? "");
  const [localidade, setLocalidade] = useState(motorista?.localidade ?? "");
  const [docsKyc, setDocsKyc] = useState<Record<string, string>>({});
  // Espelho de docsKyc para o merge: uploads simultâneos leem sempre o valor mais
  // recente aqui (o estado da closure pode estar obsoleto entre awaits).
  const docsKycRef = useRef<Record<string, string>>({});
  // Ficheiros do grupo identidade, para o OCR do browser (plano B sem Gemini).
  const identidadeFilesRef = useRef<Record<string, File>>({});
  const [analisando, setAnalisando] = useState<string | null>(null);
  const temDocExistente = (motorista?.doc_urls?.length ?? 0) > 0;
  const temIdentidade = temDocExistente || !!docsKyc.identidade;
  const temCarta = temDocExistente || !!docsKyc.carta_frente;

  // OCR (Gemini) do grupo — auto-preenche os campos, como no link do motorista.
  const analisarGrupoKyc = async (grupo: "identidade" | "carta", docs: Record<string, string>) => {
    const slots = grupo === "identidade" ? ["identidade", "identidade_verso"] : ["carta_frente", "carta_verso"];
    const paths = slots.map((s) => docs[s]).filter(Boolean);
    if (!paths.length) return;
    setAnalisando(grupo);
    const r = await lerDocumentoIA(paths);
    if (r.ok && r.dados) {
      const c = r.dados;
      if (grupo === "identidade") {
        if (c.nome) setNomeKyc((prev) => prev || c.nome!);
        if (c.nif) setNif(c.nif.replace(/\D/g, ""));
        if (c.doc_id_numero) setDocNumero(c.doc_id_numero);
        if (c.doc_id_validade) setDocValidade(c.doc_id_validade);
        if (c.doc_id_tipo && ["cc", "passaporte", "titulo_residencia", "aima"].includes(c.doc_id_tipo)) setDocTipo(c.doc_id_tipo);
      } else {
        if (c.carta_numero) setCartaNumero(c.carta_numero);
        if (c.carta_validade) setCartaValidade(c.carta_validade);
      }
      // Morada — quando o documento a mostra (título de residência, comprovativo,
      // IDs estrangeiros). Só preenche se ainda estiver vazia (não pisa o manual).
      if (c.morada_linha1) setMorada((prev) => prev || c.morada_linha1!);
      if (c.codigo_postal) setCodigoPostal((prev) => prev || c.codigo_postal!);
      if (c.localidade) setLocalidade((prev) => prev || c.localidade!);
    } else if (r.semIA && grupo === "identidade") {
      // Plano B (sem Gemini): OCR da MRZ no browser — só o documento de identidade.
      const files = Object.values(identidadeFilesRef.current);
      if (files.length) {
        try {
          const textos = await Promise.all(files.map((f) => ocrFicheiro(f)));
          const d = interpretarDocumento(textos.join("\n"));
          if (d.nome) setNomeKyc((prev) => prev || d.nome!);
          if (d.numero) setDocNumero(d.numero);
          if (d.validade) setDocValidade(d.validade);
          if (d.tipo) setDocTipo(d.tipo);
        } catch (e) {
          console.error("OCR (entrega) falhou:", e);
        }
      }
    }
    setAnalisando(null);
  };

  const carregarDocKyc = async (slot: string, grupo: "identidade" | "carta" | null, file: File | undefined) => {
    if (!file) return;
    setErro(null);
    marcarUpload(slot);
    const r = await enviarFotoPrivada(file);
    desmarcarUpload(slot);
    if (!r.success || !r.path) return setErro(r.error ?? "Erro ao carregar o ficheiro.");
    // Merge a partir do ref (fonte de verdade) para não perder uploads simultâneos.
    const novos = { ...docsKycRef.current, [slot]: r.path };
    docsKycRef.current = novos;
    setDocsKyc(novos);
    if (grupo === "identidade") identidadeFilesRef.current[slot] = file; // guarda p/ OCR
    if (grupo && file.type.startsWith("image/")) analisarGrupoKyc(grupo, novos);
  };

  const abrirDoc = async (path: string) => {
    const r = await urlAssinado(path);
    if (r.success && r.url) window.open(r.url, "_blank", "noopener");
    else setErro(r.error ?? "Não consegui abrir o ficheiro.");
  };

  if (jaEntregue) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
        <p className="text-slate-700">Este contrato já tem uma vistoria de {recolha ? "recolha" : "entrega"}.</p>
        <Link href={hrefJornada.vistoria(contrato.id)} className="mt-4 inline-block text-sm font-semibold text-emerald-600 hover:text-emerald-700">
          Ver vistoria →
        </Link>
      </div>
    );
  }

  const capturarFoto = async (slot: string, file: File | undefined) => {
    if (!file) return;
    setErro(null);
    setPreviews((p) => ({ ...p, [slot]: URL.createObjectURL(file) }));
    marcarUpload(slot);
    const r = await enviarFotoPrivada(file);
    desmarcarUpload(slot);
    if (r.success && r.path) setFotos((f) => ({ ...f, [slot]: r.path! }));
    else setErro(r.error ?? "Erro ao carregar a foto.");
  };

  const capturarVideo = async (file: File | undefined) => {
    if (!file) return;
    setErro(null);
    marcarUpload("video");
    setVideoNome(file.name);
    const r = await enviarVideoPrivado(file);
    desmarcarUpload("video");
    if (r.success && r.path) setVideoPath(r.path);
    else { setErro(r.error ?? "Erro ao carregar o vídeo."); setVideoNome(null); }
  };

  const submeter = async () => {
    setErro(null);
    // Gate dos documentos obrigatórios (só na entrega): não se finaliza sem eles.
    if (!recolha) {
      const faltam: string[] = [];
      if (!nif.replace(/\D/g, "")) faltam.push("NIF");
      if (!docNumero.trim()) faltam.push("nº do documento");
      if (!cartaNumero.trim()) faltam.push("nº da carta");
      if (!morada.trim()) faltam.push("morada");
      if (!temIdentidade) faltam.push("ficheiro do documento");
      if (!temCarta) faltam.push("ficheiro da carta");
      if (faltam.length) return setErro(`Faltam dados obrigatórios do motorista: ${faltam.join(", ")}.`);
    }
    if (!km) return setErro("Indica a quilometragem.");
    if (!fotos.frente || !fotos.painel) return setErro("Tira pelo menos a foto da Frente e do Painel.");
    if (!recolha && regras && !regrasAceite) return setErro("O motorista tem de aceitar as regras do aluguer.");
    if (aCarregar.size) return setErro("Espera que os ficheiros acabem de carregar.");

    setASubmeter(true);
    let assinatura_path: string | null = null;
    if (assinatura) {
      const ra = await enviarAssinaturaPrivada(assinatura);
      if (!ra.success || !ra.path) { setErro("Erro ao enviar a assinatura."); setASubmeter(false); return; }
      assinatura_path = ra.path;
    }
    const base = {
      contrato_id: contrato.id,
      km: Number(km),
      nivel_combustivel: combustivel,
      video_path: videoPath,
      foto_paths: SLOTS.map((s) => fotos[s.key]).filter(Boolean) as string[],
      assinatura_path,
      checklist_itens: checklist,
      danos,
      materiais,
      notas: notas || null,
    };
    // Só os ficheiros carregados AGORA: é o servidor que os junta ao que a
    // ficha tem nesse momento. Mandar a lista inteira a partir do que este ecrã
    // viu ao abrir apagava o que entrou entretanto (link do motorista, intake).
    const novosDocs = Object.values(docsKyc).filter(Boolean);
    const docPaths = novosDocs.length ? novosDocs : undefined;
    const r = recolha
      ? await submeterVistoriaRecolha(base)
      : await submeterVistoriaEntrega({
          ...base,
          regras_versao: regras?.versao ?? null,
          regras_hash: regras?.hash ?? null,
          regras_aceite: regrasAceite,
          nome: nomeKyc,
          nif,
          doc_id_tipo: docTipo,
          doc_id_numero: docNumero,
          doc_id_validade: docValidade || null,
          doc_paths: docPaths,
          carta_numero: cartaNumero,
          carta_validade: cartaValidade || null,
          morada_linha1: morada,
          codigo_postal: codigoPostal || null,
          localidade: localidade || null,
        });
    setASubmeter(false);
    if (!r.success) return setErro(r.error ?? "Erro ao submeter.");
    // Entrega feita: segue para a vistoria com o cartão "enviar contrato ao
    // motorista" — o passo seguinte, em vez de voltar à lista e ficar sem pista.
    // A recolha conclui o contrato — que a lista "abertos" já não mostra.
    window.location.assign(recolha ? "/admin/contratos?f=concluido" : hrefJornada.vistoria(contrato.id, true));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <div>
        <Link href="/admin/contratos" className="text-sm font-medium text-emerald-600 hover:text-emerald-700">← Contratos</Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{recolha ? "Devolução da mota" : "Entrega da mota"}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {contrato.numero} · {contrato.motorista_nome} · {contrato.veiculo}
        </p>
        <p className="text-xs text-slate-500">
          €{contrato.preco_periodo} / período{contrato.caucao ? ` · caução ${formatarPreco(contrato.caucao)}` : ""}
        </p>
      </div>

      {/* Documentos do motorista (KYC) — só na entrega */}
      {!recolha && (
        <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Documentos do motorista</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              ✨ IA preenche
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Obrigatórios para finalizar: documento (com ficheiro), NIF, carta (com ficheiro), morada.
            Carrega frente e verso; a IA lê e preenche os campos automaticamente.
          </p>
          {temDocExistente && (
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-800">✓ Já há {motorista!.doc_urls!.length} ficheiro(s) na ficha:</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {motorista!.doc_urls!.map((p, i) => (
                  <button key={i} type="button" onClick={() => abrirDoc(p)} className="rounded-xl border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100">
                    Abrir {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          {analisando && <p className="text-xs font-semibold text-emerald-700">A ler os documentos com IA…</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DOC_SLOTS.map((s) => (
              <label key={s.key} className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-2 text-center text-xs font-semibold text-slate-500 transition hover:border-emerald-400">
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => carregarDocKyc(s.key, s.grupo, e.target.files?.[0])} />
                <span className={docsKyc[s.key] ? "text-emerald-700" : ""}>
                  {aCarregar.has(s.key) ? "a carregar…" : docsKyc[s.key] ? `✓ ${s.rotulo}` : s.rotulo}
                </span>
              </label>
            ))}
          </div>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Nome completo</span>
            <input className={campo} value={nomeKyc} onChange={(e) => setNomeKyc(e.target.value)} placeholder="Como está no documento" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>NIF</span><input className={campo} value={nif} onChange={(e) => setNif(e.target.value)} inputMode="numeric" /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Tipo de documento</span><select className={campo} value={docTipo} onChange={(e) => setDocTipo(e.target.value)}>{DOC_TIPOS.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Nº do documento</span><input className={campo} value={docNumero} onChange={(e) => setDocNumero(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Validade do documento</span><input type="date" className={campo} value={docValidade} onChange={(e) => setDocValidade(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Nº da carta</span><input className={campo} value={cartaNumero} onChange={(e) => setCartaNumero(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Validade da carta</span><input type="date" className={campo} value={cartaValidade} onChange={(e) => setCartaValidade(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700 sm:col-span-2"><span>Morada</span><input className={campo} value={morada} onChange={(e) => setMorada(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Código postal</span><input className={campo} value={codigoPostal} onChange={(e) => setCodigoPostal(e.target.value)} /></label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700"><span>Localidade</span><input className={campo} value={localidade} onChange={(e) => setLocalidade(e.target.value)} /></label>
          </div>
        </section>
      )}

      {/* KM + combustível */}
      <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Quilómetros</span>
            <input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="ex.: 141658" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            <span>Combustível: {combustivel}%</span>
            <input type="range" min={0} max={100} step={5} value={combustivel} onChange={(e) => setCombustivel(Number(e.target.value))} className="w-full accent-emerald-600" />
          </label>
        </div>
      </section>

      {/* Fotos guiadas */}
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Fotos do estado</h2>
        <p className="text-xs text-slate-500">Tira na ordem. A Frente e o Painel são obrigatórias.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SLOTS.map((s) => (
            <label key={s.key} className="relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-center transition hover:border-emerald-400">
              {previews[s.key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previews[s.key]} alt={s.rotulo} className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => capturarFoto(s.key, e.target.files?.[0])} />
              <span className={`relative z-10 rounded-full px-2 py-0.5 text-[11px] font-semibold ${previews[s.key] ? "bg-white/90 text-slate-700" : "text-slate-500"}`}>
                {aCarregar.has(s.key) ? "a carregar…" : fotos[s.key] ? `✓ ${s.rotulo}` : s.rotulo}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Vídeo */}
      <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Vídeo 360 (narrado)</h2>
        <p className="text-xs text-slate-500">Volta à mota a dizer o estado. É a prova para a devolução.</p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 py-4 text-sm font-semibold text-slate-600 transition hover:border-emerald-400">
          <input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => capturarVideo(e.target.files?.[0])} />
          {aCarregar.has("video") ? "a carregar vídeo…" : videoPath ? `✓ ${videoNome}` : "Gravar / escolher vídeo"}
        </label>
      </section>

      {/* Danos pré-existentes */}
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{recolha ? "Danos na devolução" : "Danos pré-existentes"}</h2>
          <button type="button" onClick={() => setDanos((d) => [...d, { zona: "", nota: "" }])} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">+ Adicionar</button>
        </div>
        <p className="text-xs text-slate-500">
          {recolha
            ? "Regista o que encontras agora. Compara-se com a entrega no ecrã de vistoria; a cobrança do dano faz-se lá."
            : "O que registares aqui na entrega nunca será cobrado na devolução."}
        </p>
        {danos.length === 0 && <p className="text-sm text-slate-400">Sem danos registados.</p>}
        {danos.map((d, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${campo} max-w-[10rem]`} placeholder="Zona" value={d.zona} onChange={(e) => setDanos((arr) => arr.map((x, j) => (j === i ? { ...x, zona: e.target.value } : x)))} />
            <input className={campo} placeholder="Descrição do dano" value={d.nota} onChange={(e) => setDanos((arr) => arr.map((x, j) => (j === i ? { ...x, nota: e.target.value } : x)))} />
            <button type="button" onClick={() => setDanos((arr) => arr.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600">×</button>
          </div>
        ))}
      </section>

      {/* Materiais entregues */}
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {recolha ? "Materiais a devolver" : "Materiais entregues"}
          </h2>
          {!recolha && (
            <button
              type="button"
              onClick={() => setMateriais((m) => [...m, { key: `custom_${custoIdRef.current++}`, rotulo: "", qtd: 1, entregue: true }])}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              + Adicionar
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {recolha
            ? "Confirma o que o motorista devolveu. O que não voltar fica assinalado na vistoria."
            : "Marca o que entregas com a mota. Confere-se na devolução."}
        </p>
        {materiais.length === 0 && (
          <p className="text-sm text-slate-400">
            {recolha ? "A entrega não registou materiais." : "Sem materiais."}
          </p>
        )}
        {recolha
          ? materiais.map((m, i) => (
              <label key={m.key} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={!!m.devolvido}
                  onChange={(e) => setMateriais((arr) => arr.map((x, j) => (j === i ? { ...x, devolvido: e.target.checked } : x)))}
                />
                <span className="flex-1">{m.rotulo || "—"}</span>
                <span className="text-xs text-slate-400">×{m.qtd}</span>
              </label>
            ))
          : materiais.map((m, i) => (
              <div key={m.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-600"
                  checked={!!m.entregue}
                  onChange={(e) => setMateriais((arr) => arr.map((x, j) => (j === i ? { ...x, entregue: e.target.checked } : x)))}
                />
                <input
                  className={`${campoBase} min-w-0 flex-1`}
                  placeholder="Material"
                  value={m.rotulo}
                  onChange={(e) => setMateriais((arr) => arr.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)))}
                />
                <input
                  className={`${campoBase} w-20 shrink-0 text-center`}
                  inputMode="numeric"
                  value={m.qtd}
                  onChange={(e) => setMateriais((arr) => arr.map((x, j) => (j === i ? { ...x, qtd: Math.max(1, Number(e.target.value) || 1) } : x)))}
                />
                <button type="button" onClick={() => setMateriais((arr) => arr.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600">×</button>
              </div>
            ))}
      </section>

      {/* Checklist */}
      <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Verificações</h2>
        <div className="grid grid-cols-2 gap-2">
          {CHECK.map((c) => (
            <label key={c.key} className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!checklist[c.key]} onChange={(e) => setChecklist((m) => ({ ...m, [c.key]: e.target.checked }))} />
              {c.rotulo}
            </label>
          ))}
        </div>
        <textarea className={`${campo} h-16`} placeholder="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
      </section>

      {/* Regras do aluguer (só na entrega) */}
      {!recolha && (regras ? (
        <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Regras do aluguer (v{regras.versao})
          </h2>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {regras.conteudo}
          </div>
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={regrasAceite} onChange={(e) => setRegrasAceite(e.target.checked)} />
            <span>O motorista leu e <strong>aceita as regras</strong> (v{regras.versao}).</span>
          </label>
        </section>
      ) : (
        <section className="rounded-3xl bg-amber-50 p-4 text-sm text-amber-800">
          Ainda não publicaste as regras do aluguer — vai a <strong>Regras</strong> no menu para as criar.
        </section>
      ))}

      {/* Assinatura */}
      <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Assinatura do motorista</h2>
        <p className="text-xs text-slate-500">{recolha ? "«Devolvi a mota neste estado.»" : "«Recebi a mota neste estado.»"}</p>
        <AssinaturaCanvas onChange={setAssinatura} />
      </section>

      {erro && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      <div className="sticky bottom-4">
        <button
          onClick={submeter}
          disabled={aSubmeter || aCarregar.size > 0}
          className="w-full rounded-2xl bg-emerald-500 px-6 py-4 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-emerald-600 disabled:opacity-50"
        >
          {aSubmeter ? "A submeter…" : recolha ? "Submeter devolução e concluir" : "Submeter entrega e ativar contrato"}
        </button>
      </div>
    </div>
  );
}
