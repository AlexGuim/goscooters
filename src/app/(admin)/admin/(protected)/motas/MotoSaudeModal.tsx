"use client";

import { useEffect, useState } from "react";
import type { Moto, Seguro, Manutencao, ManutencaoTipo, SeguroTipo, ImputarA } from "@/types/db";
import {
  saudeMoto,
  criarSeguro,
  apagarSeguro,
  criarManutencao,
  apagarManutencao,
} from "@/actions/frotaSaudeActions";
import { dataBR } from "@/lib/datas";
import { formatarPreco } from "@/lib/precos";
import { Modal, Botao, Badge, type BadgeTom } from "@/components/ui";

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-1 text-xs font-medium text-slate-600";

const TIPO_SEGURO: { v: SeguroTipo; r: string }[] = [
  { v: "responsabilidade_civil", r: "Responsabilidade civil" },
  { v: "danos_proprios", r: "Danos próprios" },
  { v: "outro", r: "Outro" },
];
const QUEM_PAGA: { v: ImputarA; r: string }[] = [
  { v: "goscooters", r: "GoScooters" },
  { v: "proprietario", r: "Proprietário" },
  { v: "motorista", r: "Motorista" },
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
const rotuloManut = (t: ManutencaoTipo) => TIPO_MANUT.find((x) => x.v === t)?.r ?? t;

const docDe = (detalhe: unknown): string | null =>
  (detalhe as { documento_url?: string } | null)?.documento_url ?? null;

const hoje = () => new Date().toISOString().slice(0, 10);
const diasEntre = (iso: string) =>
  Math.round((new Date(iso + "T00:00:00Z").getTime() - new Date(hoje() + "T00:00:00Z").getTime()) / 86400000);

/** Badge de validade do seguro pela data_fim. */
function BadgeSeguro({ dataFim }: { dataFim: string }) {
  const d = diasEntre(dataFim);
  if (d < 0) return <Badge tom="danger">expirado</Badge>;
  if (d <= 30) return <Badge tom="warning">expira em {d} dia{d === 1 ? "" : "s"}</Badge>;
  return <Badge tom="success">válido</Badge>;
}

/** Badge de "está a chegar" para manutenção, por km e/ou data. */
function BadgeManut({ m, kmAtual }: { m: Manutencao; kmAtual: number | null }) {
  const partes: string[] = [];
  let urgente = false;
  let aviso = false;
  if (m.proxima_km != null && kmAtual != null) {
    const falta = m.proxima_km - kmAtual;
    if (falta <= 0) urgente = true;
    else if (falta <= 500) aviso = true;
    partes.push(falta <= 0 ? `vencida (${-falta} km)` : `faltam ${falta} km`);
  }
  if (m.proxima_data) {
    const d = diasEntre(m.proxima_data);
    if (d < 0) urgente = true;
    else if (d <= 30) aviso = true;
    partes.push(d < 0 ? `atrasada ${-d} d` : `em ${d} d`);
  }
  if (!partes.length) return null;
  const tom: BadgeTom = urgente ? "danger" : aviso ? "warning" : "neutral";
  return <Badge tom={tom}>{partes.join(" · ")}</Badge>;
}

export default function MotoSaudeModal({ moto, onClose }: { moto: Moto; onClose: () => void }) {
  const [seguros, setSeguros] = useState<Seguro[] | null>(null);
  const [manut, setManut] = useState<Manutencao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  useEffect(() => {
    let vivo = true;
    saudeMoto(moto.id).then((r) => {
      if (!vivo) return;
      if (r.success) {
        setSeguros(r.seguros ?? []);
        setManut(r.manutencoes ?? []);
      } else setErro(r.error ?? "Erro ao carregar.");
    });
    return () => {
      vivo = false;
    };
  }, [moto.id]);

  const addSeguro = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget; // capturar antes do await (React anula currentTarget depois)
    const f = new FormData(form);
    const dataFim = String(f.get("data_fim") ?? "");
    if (!dataFim) return setErro("A data de fim do seguro é obrigatória.");
    setErro(null);
    setAGravar(true);
    const r = await criarSeguro({
      veiculo_id: moto.id,
      seguradora: String(f.get("seguradora") ?? "").trim() || null,
      apolice: String(f.get("apolice") ?? "").trim() || null,
      tipo: String(f.get("tipo") ?? "responsabilidade_civil") as SeguroTipo,
      data_inicio: String(f.get("data_inicio") ?? "") || null,
      data_fim: dataFim,
      premio: String(f.get("premio") ?? "").replace(",", ".").trim() || null,
      quem_paga: String(f.get("quem_paga") ?? "goscooters") as ImputarA,
    });
    setAGravar(false);
    if (!r.success || !r.seguro) return setErro(r.error ?? "Erro ao gravar.");
    setSeguros((s) => [r.seguro!, ...(s ?? [])].sort((a, b) => b.data_fim.localeCompare(a.data_fim)));
    form.reset();
  };

  const delSeguro = async (id: string) => {
    if (!window.confirm("Apagar esta apólice?")) return;
    const r = await apagarSeguro(id);
    if (r.success) setSeguros((s) => (s ?? []).filter((x) => x.id !== id));
    else setErro(r.error ?? "Erro ao apagar.");
  };

  const addManut = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget; // capturar antes do await (React anula currentTarget depois)
    const f = new FormData(form);
    setErro(null);
    setAGravar(true);
    const num = (n: string) => {
      const v = String(f.get(n) ?? "").trim();
      return v === "" ? null : Number(v.replace(",", "."));
    };
    const r = await criarManutencao({
      veiculo_id: moto.id,
      tipo: String(f.get("tipo") ?? "revisao") as ManutencaoTipo,
      data: String(f.get("data") ?? hoje()) || hoje(),
      km: num("km"),
      oficina: String(f.get("oficina") ?? "").trim() || null,
      custo: String(f.get("custo") ?? "").replace(",", ".").trim() || null,
      proxima_km: num("proxima_km"),
      proxima_data: String(f.get("proxima_data") ?? "") || null,
    });
    setAGravar(false);
    if (!r.success || !r.manutencao) return setErro(r.error ?? "Erro ao gravar.");
    setManut((m) => [r.manutencao!, ...(m ?? [])].sort((a, b) => b.data.localeCompare(a.data)));
    form.reset();
  };

  const delManut = async (id: string) => {
    if (!window.confirm("Apagar esta manutenção?")) return;
    const r = await apagarManutencao(id);
    if (r.success) setManut((m) => (m ?? []).filter((x) => x.id !== id));
    else setErro(r.error ?? "Erro ao apagar.");
  };

  return (
    <Modal
      onClose={onClose}
      titulo="Seguros e manutenção"
      subtitulo={`${moto.matricula ?? "?"} · ${moto.modelo}${moto.km_atual != null ? ` · ${moto.km_atual.toLocaleString("pt-PT")} km` : ""}`}
    >

        {erro && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">{erro}</p>}

        {/* ── SEGUROS ─────────────────────────────────────────────── */}
        <section className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seguros</h3>
          {seguros === null ? (
            <p className="text-sm text-slate-400">A carregar…</p>
          ) : seguros.length === 0 ? (
            <p className="text-sm text-slate-400">Sem apólices registadas.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {seguros.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{s.seguradora ?? "Seguradora ?"}</span>
                      {s.estado === "ativa" ? <BadgeSeguro dataFim={s.data_fim} /> : (
                        <Badge tom="neutral">{s.estado}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {s.apolice ? `${s.apolice} · ` : ""}até {dataBR(s.data_fim)}
                      {s.premio ? ` · ${formatarPreco(s.premio)}` : ""} · paga {QUEM_PAGA.find((q) => q.v === s.quem_paga)?.r}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {docDe(s.detalhe) && (
                      <a href={docDe(s.detalhe)!} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-500 hover:text-slate-800">doc</a>
                    )}
                    <button onClick={() => delSeguro(s.id)} className="px-2 text-slate-400 hover:text-red-600" aria-label="Apagar">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addSeguro} className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={etiqueta}><span>Seguradora</span><input className={campo} name="seguradora" placeholder="Fidelidade" /></label>
              <label className={etiqueta}><span>Nº apólice</span><input className={campo} name="apolice" /></label>
              <label className={etiqueta}><span>Tipo</span><select className={campo} name="tipo" defaultValue="responsabilidade_civil">{TIPO_SEGURO.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
              <label className={etiqueta}><span>Início</span><input className={campo} type="date" name="data_inicio" /></label>
              <label className={etiqueta}><span>Fim (validade) *</span><input className={campo} type="date" name="data_fim" required /></label>
              <label className={etiqueta}><span>Prémio (€)</span><input className={campo} name="premio" inputMode="decimal" placeholder="120" /></label>
              <label className={etiqueta}><span>Quem paga</span><select className={campo} name="quem_paga" defaultValue="goscooters">{QUEM_PAGA.map((q) => <option key={q.v} value={q.v}>{q.r}</option>)}</select></label>
            </div>
            <Botao type="submit" tamanho="sm" disabled={aGravar}>
              {aGravar ? "A gravar…" : "+ Adicionar apólice"}
            </Botao>
          </form>
        </section>

        {/* ── MANUTENÇÃO ──────────────────────────────────────────── */}
        <section className="mt-8 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Manutenção</h3>
          {manut === null ? (
            <p className="text-sm text-slate-400">A carregar…</p>
          ) : manut.length === 0 ? (
            <p className="text-sm text-slate-400">Sem intervenções registadas.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
              {manut.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{rotuloManut(m.tipo)}</span>
                      <BadgeManut m={m} kmAtual={moto.km_atual} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {dataBR(m.data)}
                      {m.km != null ? ` · ${m.km.toLocaleString("pt-PT")} km` : ""}
                      {m.oficina ? ` · ${m.oficina}` : ""}
                      {m.custo ? ` · ${formatarPreco(m.custo)}` : ""}
                      {m.proxima_km != null || m.proxima_data ? ` · próxima: ${m.proxima_km != null ? `${m.proxima_km.toLocaleString("pt-PT")} km` : ""}${m.proxima_km != null && m.proxima_data ? "/" : ""}${m.proxima_data ? dataBR(m.proxima_data) : ""}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {docDe(m.detalhe) && (
                      <a href={docDe(m.detalhe)!} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-500 hover:text-slate-800">doc</a>
                    )}
                    <button onClick={() => delManut(m.id)} className="px-2 text-slate-400 hover:text-red-600" aria-label="Apagar">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={addManut} className="space-y-2 rounded-2xl border border-dashed border-slate-300 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={etiqueta}><span>Tipo</span><select className={campo} name="tipo" defaultValue="revisao">{TIPO_MANUT.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}</select></label>
              <label className={etiqueta}><span>Data</span><input className={campo} type="date" name="data" defaultValue={hoje()} /></label>
              <label className={etiqueta}><span>Km</span><input className={campo} name="km" inputMode="numeric" defaultValue={moto.km_atual ?? ""} /></label>
              <label className={etiqueta}><span>Oficina</span><input className={campo} name="oficina" /></label>
              <label className={etiqueta}><span>Custo (€)</span><input className={campo} name="custo" inputMode="decimal" /></label>
              <label className={etiqueta}><span>Próxima em km</span><input className={campo} name="proxima_km" inputMode="numeric" placeholder="ex.: 18000" /></label>
              <label className={etiqueta}><span>Próxima data</span><input className={campo} type="date" name="proxima_data" /></label>
            </div>
            <Botao type="submit" tamanho="sm" disabled={aGravar}>
              {aGravar ? "A gravar…" : "+ Adicionar manutenção"}
            </Botao>
          </form>
        </section>
    </Modal>
  );
}
