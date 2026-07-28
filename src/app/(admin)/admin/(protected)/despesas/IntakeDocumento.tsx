"use client";

import { useRef, useState } from "react";
import type {
  DespesaCategoria,
  ImputarA,
  Moto,
  SeguroTipo,
  ManutencaoTipo,
} from "@/types/db";
import type { DocTipo } from "@/lib/gemini";
import { enviarDocumento } from "@/lib/uploads";
import { analisarDocumento, type IntakeResultado } from "@/actions/intakeActions";
import { gravarDespesaDeFatura } from "@/actions/faturaActions";
import { criarSeguro, criarManutencao } from "@/actions/frotaSaudeActions";
import {
  prepararComunicacao,
  type ComunicacaoPreparada,
  type ComunicacaoTipo,
} from "@/actions/comunicacaoActions";
import { dataBR } from "@/lib/datas";

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const TIPO_ROTULO: Record<DocTipo, string> = {
  fatura: "Fatura / despesa",
  apolice_seguro: "Apólice de seguro",
  manutencao: "Manutenção",
  portagem: "Portagem",
  coima: "Coima",
  documento_id: "Documento de identidade (KYC)",
  comprovativo_morada: "Comprovativo de morada (KYC)",
  outro: "Outro",
};
const CATEGORIAS: { v: DespesaCategoria; r: string }[] = [
  { v: "manutencao", r: "Manutenção" },
  { v: "portagem", r: "Portagem" },
  { v: "coima", r: "Coima" },
  { v: "seguro", r: "Seguro" },
  { v: "gps", r: "GPS" },
  { v: "outro", r: "Outro" },
];
const IMPUTAR: { v: ImputarA; r: string }[] = [
  { v: "goscooters", r: "GoScooters" },
  { v: "proprietario", r: "Proprietário (ressarce no acerto)" },
  { v: "motorista", r: "Motorista" },
];
const TIPO_SEGURO: { v: SeguroTipo; r: string }[] = [
  { v: "responsabilidade_civil", r: "Responsabilidade civil" },
  { v: "danos_proprios", r: "Danos próprios" },
  { v: "outro", r: "Outro" },
];
const TIPO_MANUT: { v: ManutencaoTipo; r: string }[] = [
  { v: "revisao", r: "Revisão" },
  { v: "oleo", r: "Óleo" },
  { v: "pneu_frente", r: "Pneu (frente)" },
  { v: "pneu_tras", r: "Pneu (trás)" },
  { v: "pneus", r: "Pneus (ambos)" },
  { v: "travoes", r: "Travões" },
  { v: "corrente", r: "Corrente" },
  { v: "inspecao", r: "Inspeção" },
  { v: "outro", r: "Outro" },
];

// Que "destino" (tabela) cada tipo alimenta.
type Destino = "despesa" | "seguro" | "manutencao" | "kyc";
function destinoDe(t: DocTipo): Destino {
  if (t === "apolice_seguro") return "seguro";
  if (t === "manutencao") return "manutencao";
  if (t === "documento_id" || t === "comprovativo_morada") return "kyc";
  return "despesa"; // fatura, portagem, coima, outro
}
const CATEGORIA_DE: Partial<Record<DocTipo, DespesaCategoria>> = {
  portagem: "portagem",
  coima: "coima",
  fatura: "outro",
  outro: "outro",
};

type Fase = "inicio" | "a-processar" | "rever" | "a-gravar" | "comunicar";

export default function IntakeDocumento({
  motos,
}: {
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<Fase>("inicio");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [res, setRes] = useState<IntakeResultado | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [comunicacao, setComunicacao] = useState<ComunicacaoPreparada | null>(null);
  const [textoMsg, setTextoMsg] = useState("");

  // Campos editáveis (pré-preenchidos pela IA).
  const [tipo, setTipo] = useState<DocTipo>("fatura");
  const [veiculoId, setVeiculoId] = useState("");
  const [categoria, setCategoria] = useState<DespesaCategoria>("outro");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [imputarA, setImputarA] = useState<ImputarA>("goscooters");
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [motoristaNome, setMotoristaNome] = useState<string | null>(null);
  const [km, setKm] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [referencia, setReferencia] = useState("");
  // Seguro
  const [seguradora, setSeguradora] = useState("");
  const [apolice, setApolice] = useState("");
  const [seguroTipo, setSeguroTipo] = useState<SeguroTipo>("responsabilidade_civil");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [quemPaga, setQuemPaga] = useState<ImputarA>("proprietario");
  // Manutenção
  const [manutTipo, setManutTipo] = useState<ManutencaoTipo>("revisao");
  const [oficina, setOficina] = useState("");
  const [proximaKm, setProximaKm] = useState("");
  const [proximaData, setProximaData] = useState("");

  const reset = () => {
    setFase("inicio");
    setRes(null);
    setDocUrl(null);
    setErro(null);
    setMotoristaId(null);
    setMotoristaNome(null);
    setComunicacao(null);
    setTextoMsg("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const preencher = (r: IntakeResultado) => {
    const d = r.doc;
    setRes(r);
    setDocUrl(r.documento_url);
    setTipo(d.tipo);
    setVeiculoId(r.veiculo?.id ?? "");
    setCategoria(CATEGORIA_DE[d.tipo] ?? "outro");
    setDescricao(d.descricao ?? "");
    setValor(d.valor ?? "");
    setData(d.data ?? "");
    setDataVencimento(d.data_vencimento ?? "");
    setImputarA(r.imputar_a_sugerido);
    setMotoristaId(r.motorista?.id ?? null);
    setMotoristaNome(r.motorista?.nome ?? null);
    setKm(d.km != null ? String(d.km) : "");
    setFornecedor(d.fornecedor ?? "");
    setReferencia(d.referencia ?? "");
    setSeguradora(d.fornecedor ?? "");
    setApolice(d.seguro_apolice ?? "");
    setDataFim(d.data_fim ?? "");
    setQuemPaga(r.imputar_a_sugerido === "goscooters" ? "goscooters" : "proprietario");
    setManutTipo((d.manutencao_tipo as ManutencaoTipo) ?? "revisao");
    setProximaKm(d.proxima_km != null ? String(d.proxima_km) : "");
    setProximaData(d.proxima_data ?? "");
    setDataInicio("");
    setOficina("");
    setFase("rever");
  };

  const aoEscolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const ficheiro = e.target.files?.[0];
    if (!ficheiro) return;
    setErro(null);
    setOk(null);
    setFase("a-processar");
    const env = await enviarDocumento(ficheiro);
    if (!env.success || !env.path || !env.url) {
      setErro(env.error ?? "Erro ao carregar o ficheiro.");
      setFase("inicio");
      return;
    }
    const r = await analisarDocumento(env.path, env.url);
    if (!r.success || !r.resultado) {
      setErro(r.error ?? "Não consegui ler o documento.");
      setFase("inicio");
      return;
    }
    preencher(r.resultado);
  };

  const destino = destinoDe(tipo);
  const ehPortagemCoima = tipo === "portagem" || tipo === "coima";

  const confirmar = async () => {
    setErro(null);
    // Validações mínimas por destino.
    if (destino !== "kyc" && !data && destino === "despesa") return setErro("Indica a data.");
    if ((destino === "seguro" || destino === "manutencao") && !veiculoId)
      return setErro("Escolhe o veículo.");
    if (destino === "seguro" && !dataFim) return setErro("Indica a validade (fim) da apólice.");

    setFase("a-gravar");
    const detalheDoc = { ...(res?.doc ?? {}), documento_url: docUrl };
    let msgOk = "";
    try {
      if (destino === "despesa") {
        const r = await gravarDespesaDeFatura({
          veiculo_id: veiculoId || null,
          categoria,
          descricao: descricao || null,
          valor: valor || "0",
          data_despesa: data,
          data_vencimento: dataVencimento || null,
          imputar_a: imputarA,
          proprietario_id: null,
          motorista_id: ehPortagemCoima ? motoristaId : null,
          fornecedor: fornecedor || null,
          referencia_externa: referencia || null,
          km: km ? Number(km) : null,
          documento_url: docUrl,
          detalhe: detalheDoc,
        });
        if (!r.success) throw new Error(r.error);
        msgOk = `Despesa registada (${TIPO_ROTULO[tipo]}).` + (r.avisoKm ? ` ${r.avisoKm}` : "");
      } else if (destino === "seguro") {
        let despesaId: string | null = null;
        if (valor) {
          const rd = await gravarDespesaDeFatura({
            veiculo_id: veiculoId, categoria: "seguro", descricao: descricao || "Prémio de seguro",
            valor, data_despesa: data || dataFim, data_vencimento: dataVencimento || null,
            imputar_a: quemPaga, proprietario_id: null, fornecedor: seguradora || null,
            referencia_externa: apolice || referencia || null, km: null, documento_url: docUrl, detalhe: detalheDoc,
          });
          if (!rd.success) throw new Error(rd.error);
          despesaId = rd.id ?? null;
        }
        const rs = await criarSeguro({
          veiculo_id: veiculoId, data_fim: dataFim, seguradora: seguradora || null, apolice: apolice || null,
          tipo: seguroTipo, data_inicio: dataInicio || null, premio: valor || null, quem_paga: quemPaga,
          despesa_id: despesaId, origem: "ingestao", detalhe: { documento_url: docUrl },
        });
        if (!rs.success) throw new Error(rs.error);
        msgOk = "Apólice de seguro registada" + (despesaId ? " (com despesa do prémio)." : ".");
      } else if (destino === "manutencao") {
        let despesaId: string | null = null;
        if (valor) {
          const rd = await gravarDespesaDeFatura({
            veiculo_id: veiculoId, categoria: "manutencao", descricao: descricao || null, valor,
            data_despesa: data || new Date().toISOString().slice(0, 10), data_vencimento: dataVencimento || null, imputar_a: imputarA,
            proprietario_id: null, fornecedor: fornecedor || null, referencia_externa: referencia || null,
            km: km ? Number(km) : null, documento_url: docUrl, detalhe: detalheDoc,
          });
          if (!rd.success) throw new Error(rd.error);
          despesaId = rd.id ?? null;
        }
        const rm = await criarManutencao({
          veiculo_id: veiculoId, tipo: manutTipo, data: data || new Date().toISOString().slice(0, 10),
          km: km ? Number(km) : null, oficina: oficina || null, custo: valor || null,
          proxima_km: proximaKm ? Number(proximaKm) : null, proxima_data: proximaData || null,
          despesa_id: despesaId, origem: "ingestao", detalhe: { documento_url: docUrl },
        });
        if (!rm.success) throw new Error(rm.error);
        msgOk = "Manutenção registada" + (despesaId ? " (com despesa)." : ".");
      }

      // Procedimento padrão: propor comunicação ao motorista (coima/portagem/carta verde).
      const tipoComunic: ComunicacaoTipo | null =
        tipo === "coima" ? "coima" : tipo === "portagem" ? "portagem" : tipo === "apolice_seguro" ? "seguro" : null;
      if (tipoComunic) {
        const rc = await prepararComunicacao({
          tipo: tipoComunic,
          veiculo_id: veiculoId,
          motorista_id: tipoComunic === "seguro" ? null : motoristaId,
          matricula: motos.find((m) => m.id === veiculoId)?.matricula ?? null,
          valor: valor || null,
          data: data ? dataBR(data) : null,
          documento_url: docUrl,
        });
        if (rc.success && rc.dados) {
          setComunicacao(rc.dados);
          setTextoMsg(rc.dados.texto);
          setOk(msgOk);
          setFase("comunicar");
          return;
        }
        // Sem motorista/telefone para comunicar: informa e segue em frente.
        setOk(`${msgOk} (Comunicação não preparada: ${rc.error ?? "sem motorista"}.)`);
        reset();
        window.location.reload();
        return;
      }

      setOk(msgOk);
      reset();
      window.location.reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao gravar.");
      setFase("rever");
    }
  };

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Carregar documento (IA)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Carrega qualquer documento (fatura, apólice de seguro, oficina, portagem, coima). A IA lê,
            classifica e pré-preenche — tu confirmas com um clique.
          </p>
        </div>
        {!aberto && (
          <button
            onClick={() => setAberto(true)}
            className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Carregar documento
          </button>
        )}
      </div>

      {ok && <p className="mt-3 text-sm text-emerald-700">{ok}</p>}

      {aberto && (
        <div className="mt-4 space-y-4">
          {(fase === "inicio" || fase === "a-processar") && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={aoEscolher}
                disabled={fase === "a-processar"}
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-2xl file:border-0 file:bg-emerald-600 file:px-5 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700 disabled:opacity-50"
              />
              <p className="mt-3 text-xs text-slate-500">
                {fase === "a-processar" ? "A IA está a ler o documento…" : "PDF ou foto até ~18 MB."}
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-red-700">{erro}</p>}

          {(fase === "rever" || fase === "a-gravar") && res && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {TIPO_ROTULO[tipo]}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      res.doc.confianca === "alta"
                        ? "bg-emerald-100 text-emerald-700"
                        : res.doc.confianca === "media"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    confiança {res.doc.confianca}
                  </span>
                </div>
                {docUrl && (
                  <a href={docUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-700 underline">
                    ver ficheiro
                  </a>
                )}
              </div>

              {res.aviso && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{res.aviso}</p>}
              {res.duplicado && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                  ⚠ Já existe uma despesa com o mesmo fornecedor, referência e valor — pode ser duplicado.
                </p>
              )}

              {/* Corrigir a classificação, se a IA errou. */}
              <label className={etiqueta}>
                <span>Tipo de documento</span>
                <select className={campo} value={tipo} onChange={(e) => setTipo(e.target.value as DocTipo)}>
                  {(Object.keys(TIPO_ROTULO) as DocTipo[]).map((t) => (
                    <option key={t} value={t}>{TIPO_ROTULO[t]}</option>
                  ))}
                </select>
              </label>

              {destino === "kyc" ? (
                <p className="rounded-xl bg-slate-100 px-3 py-3 text-sm text-slate-600">
                  Isto parece um documento de identidade / comprovativo do motorista. O KYC regista-se no
                  fluxo de entrega do contrato (não aqui). Podes ver o ficheiro acima.
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={etiqueta}>
                      <span>Veículo{destino !== "despesa" ? " *" : ""}</span>
                      <select className={campo} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                        <option value="">— sem veículo —</option>
                        {motos.map((m) => (
                          <option key={m.id} value={m.id}>{m.matricula ?? "?"} · {m.modelo}</option>
                        ))}
                      </select>
                    </label>
                    <label className={etiqueta}>
                      <span>{destino === "seguro" ? "Prémio (€)" : "Valor (€)"}</span>
                      <input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                    </label>
                    <label className={etiqueta}>
                      <span>Data</span>
                      <input className={campo} type="date" value={data} onChange={(e) => setData(e.target.value)} />
                    </label>
                    <label className={etiqueta}>
                      <span>Fornecedor / entidade</span>
                      <input className={campo} value={fornecedor} onChange={(e) => { setFornecedor(e.target.value); if (destino === "seguro") setSeguradora(e.target.value); }} />
                    </label>
                  </div>

                  {ehPortagemCoima && (
                    <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                      {motoristaNome ? (
                        <>Motorista com a moto nesta data: <strong>{motoristaNome}</strong> — custo imputado ao motorista.</>
                      ) : (
                        <span className="text-amber-700">Não identifiquei o motorista desta data no histórico. Confere o veículo/data.</span>
                      )}
                    </div>
                  )}

                  {destino === "despesa" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}>
                        <span>Categoria</span>
                        <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value as DespesaCategoria)}>
                          {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.r}</option>)}
                        </select>
                      </label>
                      <label className={etiqueta}>
                        <span>Quem suporta o custo</span>
                        <select className={campo} value={imputarA} onChange={(e) => setImputarA(e.target.value as ImputarA)}>
                          {IMPUTAR.map((i) => <option key={i.v} value={i.v}>{i.r}</option>)}
                        </select>
                      </label>
                      <label className={`${etiqueta} sm:col-span-2`}>
                        <span>Descrição</span>
                        <input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                      </label>
                      <label className={etiqueta}>
                        <span>Vencimento</span>
                        <input className={campo} type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
                      </label>
                      <label className={etiqueta}>
                        <span>KM (atualiza a moto)</span>
                        <input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
                      </label>
                      <label className={`${etiqueta} sm:col-span-2`}>
                        <span>Referência</span>
                        <input className={campo} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                      </label>
                    </div>
                  )}

                  {destino === "seguro" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}><span>Nº apólice</span><input className={campo} value={apolice} onChange={(e) => setApolice(e.target.value)} /></label>
                      <label className={etiqueta}><span>Tipo de seguro</span><select className={campo} value={seguroTipo} onChange={(e) => setSeguroTipo(e.target.value as SeguroTipo)}>{TIPO_SEGURO.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
                      <label className={etiqueta}><span>Início</span><input className={campo} type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
                      <label className={etiqueta}><span>Fim (validade) *</span><input className={campo} type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
                      <label className={etiqueta}><span>Quem paga</span><select className={campo} value={quemPaga} onChange={(e) => setQuemPaga(e.target.value as ImputarA)}>{IMPUTAR.map((i) => <option key={i.v} value={i.v}>{i.r}</option>)}</select></label>
                    </div>
                  )}

                  {destino === "manutencao" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className={etiqueta}><span>Tipo</span><select className={campo} value={manutTipo} onChange={(e) => setManutTipo(e.target.value as ManutencaoTipo)}>{TIPO_MANUT.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
                      <label className={etiqueta}><span>Oficina</span><input className={campo} value={oficina} onChange={(e) => setOficina(e.target.value)} /></label>
                      <label className={etiqueta}><span>KM na intervenção</span><input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></label>
                      <label className={etiqueta}><span>Próxima em km</span><input className={campo} inputMode="numeric" value={proximaKm} onChange={(e) => setProximaKm(e.target.value)} /></label>
                      <label className={etiqueta}><span>Próxima data</span><input className={campo} type="date" value={proximaData} onChange={(e) => setProximaData(e.target.value)} /></label>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={confirmar} disabled={fase === "a-gravar"} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                      {fase === "a-gravar" ? "A gravar…" : "Confirmar e registar"}
                    </button>
                    <button onClick={reset} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white">
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {fase === "comunicar" && comunicacao && (() => {
            const digits = comunicacao.motorista.telefone_e164?.replace(/\D/g, "") ?? "";
            const waLink = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(textoMsg)}` : null;
            return (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-semibold text-slate-800">Avisar o motorista</p>
                <p className="text-xs text-slate-600">
                  Mensagem para <strong>{comunicacao.motorista.nome}</strong> ({comunicacao.idioma})
                  {comunicacao.fallback ? " · template" : " · redigida pela IA"}. Revê e envia.
                </p>
                <textarea className={`${campo} h-32`} value={textoMsg} onChange={(e) => setTextoMsg(e.target.value)} />
                <div className="flex flex-wrap gap-3">
                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Abrir WhatsApp
                    </a>
                  )}
                  <button
                    onClick={() => {
                      reset();
                      window.location.reload();
                    }}
                    className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
