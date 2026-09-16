"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Moto, Seguro, SeguroTipo, ImputarA } from "@/types/db";
import { saudeMoto, criarSeguro, apagarSeguro, type ComDocumento } from "@/actions/frotaSaudeActions";
import { dataBR } from "@/lib/datas";
import { formatarPreco } from "@/lib/precos";
import { Modal, Botao, Badge } from "@/components/ui";

/**
 * Seguros da mota: apólices, validade e quem paga.
 *
 * A manutenção saiu daqui para a página da mota (/admin/motas/[id]), onde está o
 * km, o estado do óleo e o histórico. Vivia nos dois sítios com contas diferentes;
 * agora há um link e um só sítio.
 */

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

// O documento pronto a abrir, resolvido no servidor (saudeMoto): o URL público, ou
// um URL assinado quando é privado. Nunca o `detalhe.documento_url` cru.
const docDe = (linha: ComDocumento<unknown>): string | null => linha.documento_ver ?? null;

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

export default function MotoSaudeModal({ moto, onClose }: { moto: Moto; onClose: () => void }) {
  const [seguros, setSeguros] = useState<ComDocumento<Seguro>[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  useEffect(() => {
    let vivo = true;
    saudeMoto(moto.id).then((r) => {
      if (!vivo) return;
      if (r.success) setSeguros(r.seguros ?? []);
      else setErro(r.error ?? "Erro ao carregar.");
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

  return (
    <Modal
      onClose={onClose}
      titulo="Seguro"
      // O km vive na página da mota, e só lá é que passa pelo cálculo que põe de
      // lado as leituras que não batem certo. Aqui saía o km_atual cru e os dois
      // ecrãs, ligados pelo «Ver manutenção», diziam números diferentes.
      subtitulo={`${moto.matricula ?? "?"} · ${moto.modelo}`}
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
                    {docDe(s) && (
                      <a href={docDe(s)!} target="_blank" rel="noreferrer" className="text-xs font-semibold text-slate-500 hover:text-slate-800">doc</a>
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

        {/* A manutenção mudou-se para a página da mota, com o km e o histórico. */}
        <p className="mt-8 border-t border-slate-100 pt-4 text-sm">
          <Link
            href={`/admin/motas/${moto.id}`}
            className="font-semibold text-emerald-700 hover:text-emerald-800"
          >
            Ver manutenção →
          </Link>
        </p>
    </Modal>
  );
}
