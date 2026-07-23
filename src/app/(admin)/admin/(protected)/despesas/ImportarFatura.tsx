"use client";

import { useRef, useState } from "react";
import type { DespesaCategoria, ImputarA, Moto } from "@/types/db";
import { enviarDocumento } from "@/lib/uploads";
import { ocrFicheiro } from "@/lib/ocr";
import {
  lerFatura,
  interpretarTextoFatura,
  gravarDespesaDeFatura,
  type LerFaturaResultado,
} from "@/actions/faturaActions";
import type { FaturaCampos } from "@/lib/faturas";

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1.5 text-sm font-medium text-slate-700";

const CATEGORIAS: { valor: DespesaCategoria; rotulo: string }[] = [
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "portagem", rotulo: "Portagem" },
  { valor: "coima", rotulo: "Coima" },
  { valor: "seguro", rotulo: "Seguro" },
  { valor: "gps", rotulo: "GPS" },
  { valor: "outro", rotulo: "Outro" },
];
const IMPUTAR: { valor: ImputarA; rotulo: string }[] = [
  { valor: "goscooters", rotulo: "GoScooters" },
  { valor: "proprietario", rotulo: "Proprietário (ressarce no acerto)" },
  { valor: "motorista", rotulo: "Motorista" },
];

type Fase = "inicio" | "a-processar" | "rever" | "a-gravar";

export default function ImportarFatura({
  motos,
}: {
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<Fase>("inicio");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ fase: string; pct: number } | null>(null);
  const [avisoMatch, setAvisoMatch] = useState<string | null>(null);
  const [veiculoAssociadoId, setVeiculoAssociadoId] = useState<string | null>(null);

  // Dados extraídos + estado do formulário de revisão.
  const [campos, setCampos] = useState<FaturaCampos | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [matriculaLida, setMatriculaLida] = useState<string | null>(null);
  const [veiculoId, setVeiculoId] = useState("");
  const [categoria, setCategoria] = useState<DespesaCategoria>("manutencao");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [dataDespesa, setDataDespesa] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [imputarA, setImputarA] = useState<ImputarA>("proprietario");
  const [km, setKm] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [referencia, setReferencia] = useState("");

  const reset = () => {
    setFase("inicio");
    setCampos(null);
    setDocUrl(null);
    setMatriculaLida(null);
    setVeiculoId("");
    setErro(null);
    setAvisoMatch(null);
    setVeiculoAssociadoId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const preencher = (res: LerFaturaResultado) => {
    const { campos: c, veiculo, imputar_a_sugerido, documento_url } = res;
    setAvisoMatch(res.aviso);
    setVeiculoAssociadoId(veiculo?.id ?? null);
    setCampos(c);
    setDocUrl(documento_url);
    setMatriculaLida(c.matricula);
    setVeiculoId(veiculo?.id ?? "");
    setCategoria(c.categoria);
    setDescricao(c.descricao ?? "");
    setValor(c.valor ?? "");
    setDataDespesa(c.data ?? "");
    setDataVencimento(c.data_vencimento ?? "");
    setImputarA(imputar_a_sugerido);
    setKm(c.km != null ? String(c.km) : "");
    setFornecedor(c.fornecedor ?? "");
    setReferencia(c.referencia ?? "");
    setFase("rever");
  };

  const aoEscolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const ficheiro = e.target.files?.[0];
    if (!ficheiro) return;
    setErro(null);
    setOk(null);
    setProgresso(null);
    setFase("a-processar");

    const env = await enviarDocumento(ficheiro);
    if (!env.success || !env.path || !env.url) {
      setErro(env.error ?? "Erro ao carregar o ficheiro.");
      setFase("inicio");
      return;
    }

    // 1) Tenta ler o texto do PDF no servidor (instantâneo, se houver camada de texto).
    const r = await lerFatura(env.path, env.url);
    if (r.success && r.resultado) {
      preencher(r.resultado);
      return;
    }
    if (!r.semTexto) {
      setErro(r.error ?? "Não consegui ler a fatura.");
      setFase("inicio");
      return;
    }

    // 2) Sem texto (fatura digitalizada ou foto) → OCR no browser.
    try {
      setProgresso({ fase: "A preparar", pct: 0 });
      const texto = await ocrFicheiro(ficheiro, (fase, pct) => setProgresso({ fase, pct }));
      const r2 = await interpretarTextoFatura(texto, env.url);
      setProgresso(null);
      if (!r2.success || !r2.resultado) {
        setErro(r2.error ?? "O OCR não reconheceu texto suficiente. Tenta uma imagem mais nítida.");
        setFase("inicio");
        return;
      }
      preencher(r2.resultado);
    } catch (err) {
      console.error("OCR error:", err);
      setProgresso(null);
      setErro("Erro no OCR. Tenta uma imagem mais nítida ou preenche à mão.");
      setFase("inicio");
    }
  };

  const gravar = async () => {
    setErro(null);
    setFase("a-gravar");
    const r = await gravarDespesaDeFatura({
      veiculo_id: veiculoId || null,
      categoria,
      descricao: descricao || null,
      valor: valor || "0",
      data_despesa: dataDespesa,
      data_vencimento: dataVencimento || null,
      imputar_a: imputarA,
      proprietario_id: null, // herdado do veículo no servidor
      fornecedor: fornecedor || null,
      referencia_externa: referencia || null,
      km: km ? Number(km) : null,
      documento_url: docUrl,
      detalhe: campos,
    });
    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      setFase("rever");
      return;
    }
    setOk("Despesa criada a partir da fatura." + (r.avisoKm ? ` ${r.avisoKm}` : ""));
    reset();
    // Recarrega para a nova despesa aparecer na lista abaixo.
    window.location.reload();
  };

  const semVeiculo = !!matriculaLida && !veiculoId;

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Importar de fatura</h2>
          <p className="mt-1 text-xs text-slate-500">
            Carrega a fatura (PDF ou foto). Eu leio a matrícula, o valor, a data
            e a KM — por OCR, se for digitalizada; tu confirmas antes de gravar.
          </p>
        </div>
        {!aberto && (
          <button
            onClick={() => setAberto(true)}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Importar fatura
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
              {fase === "a-processar" && progresso ? (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${progresso.pct}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    OCR no teu browser — {progresso.fase.toLowerCase()} ({progresso.pct}%). Pode demorar alguns segundos.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  {fase === "a-processar"
                    ? "A carregar a fatura…"
                    : "PDF ou foto até 15 MB. Faturas digitalizadas são lidas por OCR no teu browser."}
                </p>
              )}
            </div>
          )}

          {erro && <p className="text-sm text-red-700">{erro}</p>}

          {(fase === "rever" || fase === "a-gravar") && campos && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-700">
                  Confere os dados lidos e corrige o que for preciso
                </p>
                {docUrl && (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-emerald-700 underline"
                  >
                    ver ficheiro
                  </a>
                )}
              </div>

              {semVeiculo && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Li a matrícula <strong>{matriculaLida}</strong>, mas não corresponde a
                  nenhum veículo da frota. Escolhe o veículo à mão.
                </p>
              )}
              {avisoMatch && !semVeiculo && veiculoId === veiculoAssociadoId && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {avisoMatch}
                </p>
              )}
              {campos.itens.length > 1 && (
                <p className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  {campos.itens.length} itens lidos na fatura: {campos.itens.map((i) => i.descricao).join(" · ")}.
                  Fica uma só despesa com o total; o detalhe é guardado.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={etiqueta}>
                  <span>Veículo</span>
                  <select className={campo} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                    <option value="">— sem veículo —</option>
                    {motos.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.matricula ?? "?"} · {m.modelo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={etiqueta}>
                  <span>Categoria</span>
                  <select
                    className={campo}
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value as DespesaCategoria)}
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.valor} value={c.valor}>{c.rotulo}</option>
                    ))}
                  </select>
                </label>
                <label className={`${etiqueta} sm:col-span-2`}>
                  <span>Descrição</span>
                  <input className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
                </label>
                <label className={etiqueta}>
                  <span>Valor (€)</span>
                  <input className={campo} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
                </label>
                <label className={etiqueta}>
                  <span>Quem suporta o custo</span>
                  <select
                    className={campo}
                    value={imputarA}
                    onChange={(e) => setImputarA(e.target.value as ImputarA)}
                  >
                    {IMPUTAR.map((i) => (
                      <option key={i.valor} value={i.valor}>{i.rotulo}</option>
                    ))}
                  </select>
                </label>
                <label className={etiqueta}>
                  <span>Data</span>
                  <input className={campo} type="date" value={dataDespesa} onChange={(e) => setDataDespesa(e.target.value)} />
                </label>
                <label className={etiqueta}>
                  <span>Vencimento</span>
                  <input className={campo} type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
                </label>
                <label className={etiqueta}>
                  <span>KM (atualiza a moto)</span>
                  <input className={campo} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
                </label>
                <label className={etiqueta}>
                  <span>Fornecedor</span>
                  <input className={campo} value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
                </label>
                <label className={`${etiqueta} sm:col-span-2`}>
                  <span>Referência</span>
                  <input className={campo} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
                </label>
              </div>

              {campos.proxima_troca && (
                <p className="text-xs text-slate-500">
                  Nota lida na fatura — próxima troca de óleo: <strong>{campos.proxima_troca}</strong>.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={gravar}
                  disabled={fase === "a-gravar" || !dataDespesa}
                  className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {fase === "a-gravar" ? "A gravar…" : "Gravar despesa"}
                </button>
                <button
                  onClick={reset}
                  className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
