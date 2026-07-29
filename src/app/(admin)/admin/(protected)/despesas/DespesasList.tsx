"use client";

import { useMemo, useRef, useState } from "react";
import type {
  Despesa,
  DespesaCategoria,
  EstadoPagamentoDespesa,
  ImputarA,
  Moto,
  Proprietario,
} from "@/types/db";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { Botao, Badge, AcoesMenu, Modal, campo, etiqueta } from "@/components/ui";
import {
  criarDespesa,
  atualizarDespesa,
  eliminarDespesa,
} from "@/actions/despesaActions";
import { registarCoima, resolverCondutor } from "@/actions/coimaActions";
import GrupoColapsavel from "@/components/GrupoColapsavel";
import { CAT_ROTULO, CAT_COR, ESTADO_PAG_TOM, IMPUTAR_ROTULO } from "@/lib/despesasMeta";

export interface DespesaComNomes extends Despesa {
  veiculo_matricula: string | null;
  proprietario_nome: string | null;
}

const CATEGORIAS: { valor: DespesaCategoria; rotulo: string }[] = [
  { valor: "manutencao", rotulo: "Manutenção" },
  { valor: "portagem", rotulo: "Portagem" },
  { valor: "coima", rotulo: "Coima" },
  { valor: "seguro", rotulo: "Seguro" },
  { valor: "gps", rotulo: "GPS" },
  { valor: "outro", rotulo: "Outro" },
];
// Quem costuma suportar cada tipo de custo (default; sempre editável).
const IMPUTAR_PADRAO: Record<DespesaCategoria, ImputarA> = {
  manutencao: "proprietario",
  seguro: "proprietario",
  gps: "proprietario",
  portagem: "motorista",
  coima: "motorista",
  comissao: "goscooters",
  outro: "goscooters",
};

const hoje = () => new Date().toISOString().slice(0, 10);

export default function DespesasList({
  inicial,
  motos,
  proprietarios,
}: {
  inicial: DespesaComNomes[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
}) {
  const [despesas, setDespesas] = useState(inicial);
  const [filtroCat, setFiltroCat] = useState<DespesaCategoria | "">("");
  const [filtroVeiculo, setFiltroVeiculo] = useState("");
  const [filtroDono, setFiltroDono] = useState("");
  const [modal, setModal] = useState<DespesaComNomes | "novo" | null>(null);

  const filtradas = despesas.filter(
    (d) =>
      (!filtroCat || d.categoria === filtroCat) &&
      (!filtroVeiculo || d.veiculo_id === filtroVeiculo) &&
      (!filtroDono ||
        (filtroDono === "__sem__" ? !d.proprietario_id : d.proprietario_id === filtroDono)),
  );

  const total = useMemo(
    () => filtradas.reduce((s, d) => s + Number(d.valor_total), 0),
    [filtradas],
  );

  // Agrupadas por proprietário do veículo (secção colapsável por dono).
  const grupos = useMemo(() => {
    const m = new Map<string, { nome: string; itens: DespesaComNomes[] }>();
    for (const d of filtradas) {
      const nome = d.proprietario_nome ?? "GoScooters / estrutura";
      if (!m.has(nome)) m.set(nome, { nome, itens: [] });
      m.get(nome)!.itens.push(d);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  }, [filtradas]);

  const handleSaved = (d: DespesaComNomes) => {
    setDespesas((atuais) => {
      const existe = atuais.some((x) => x.id === d.id);
      return existe ? atuais.map((x) => (x.id === d.id ? d : x)) : [d, ...atuais];
    });
    setModal(null);
  };

  const handleEliminar = async (d: DespesaComNomes) => {
    if (!window.confirm("Eliminar esta despesa?")) return;
    const r = await eliminarDespesa(d.id);
    if (r.success) setDespesas((atuais) => atuais.filter((x) => x.id !== d.id));
    else alert(r.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroCat}
            onChange={(e) => setFiltroCat(e.target.value as DespesaCategoria | "")}
          >
            <option value="">Todas as categorias</option>
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>{c.rotulo}</option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroVeiculo}
            onChange={(e) => setFiltroVeiculo(e.target.value)}
          >
            <option value="">Todos os veículos</option>
            {motos.map((m) => (
              <option key={m.id} value={m.id}>{m.matricula ?? m.modelo}</option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500"
            value={filtroDono}
            onChange={(e) => setFiltroDono(e.target.value)}
          >
            <option value="">Todos os proprietários</option>
            {proprietarios.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
            <option value="__sem__">— sem proprietário —</option>
          </select>
          <span className="text-sm text-slate-600">
            {filtradas.length} · total {formatarPreco(total)}
          </span>
        </div>
        <Botao tamanho="lg" onClick={() => setModal("novo")}>
          + Nova despesa
        </Botao>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">Nenhuma despesa neste filtro.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => {
            const totalG = g.itens.reduce((s, d) => s + Number(d.valor_total), 0);
            return (
            <GrupoColapsavel
              key={g.nome}
              titulo={g.nome}
              resumo={`${g.itens.length} · ${formatarPreco(totalG)}`}
            >
          <div className="divide-y divide-slate-100">
            {g.itens.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CAT_COR[d.categoria]}`}>
                      {CAT_ROTULO[d.categoria]}
                    </span>
                    <span className="text-sm font-medium text-slate-950">
                      {d.veiculo_matricula ?? "estrutura"}
                    </span>
                    {d.estado_pagamento !== "paga" && (
                      <Badge tom={ESTADO_PAG_TOM[d.estado_pagamento]}>{d.estado_pagamento}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-500">
                    {dataBR(d.data_despesa)}
                    {d.descricao ? ` · ${d.descricao}` : ""}
                    {` · suporta: ${IMPUTAR_ROTULO[d.imputar_a]}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-slate-950">{formatarPreco(d.valor_total)}</span>
                  <Botao variante="secondary" tamanho="sm" onClick={() => setModal(d)}>
                    Editar
                  </Botao>
                  <AcoesMenu
                    acoes={[
                      {
                        rotulo: "Ver documento",
                        href: (d.detalhe as { documento_url?: string } | null)?.documento_url,
                        externo: true,
                        oculta: !(d.detalhe as { documento_url?: string } | null)?.documento_url,
                      },
                      { rotulo: "Eliminar", onClick: () => handleEliminar(d), perigo: true },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
            </GrupoColapsavel>
            );
          })}
        </div>
      )}

      {modal && (
        <FormDespesa
          despesa={modal === "novo" ? null : modal}
          motos={motos}
          proprietarios={proprietarios}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function FormDespesa({
  despesa,
  motos,
  proprietarios,
  onClose,
  onSaved,
}: {
  despesa: DespesaComNomes | null;
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  proprietarios: Pick<Proprietario, "id" | "nome">[];
  onClose: () => void;
  onSaved: (d: DespesaComNomes) => void;
}) {
  const aEditar = Boolean(despesa);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<DespesaCategoria>(despesa?.categoria ?? "manutencao");
  const [imputarA, setImputarA] = useState<ImputarA>(
    despesa?.imputar_a ?? IMPUTAR_PADRAO["manutencao"],
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [condutor, setCondutor] = useState<{ ok: boolean; nome?: string; contrato?: string; error?: string } | null>(null);
  const [aResolver, setAResolver] = useState(false);

  // Ao mudar a categoria, ajusta o "quem suporta" para o default dessa categoria.
  const trocarCategoria = (c: DespesaCategoria) => {
    setCategoria(c);
    setImputarA(IMPUTAR_PADRAO[c]);
    setCondutor(null);
  };

  // Coima: descobre quem conduzia na data da infração (para o admin confirmar).
  const sugerirCondutor = async () => {
    const form = formRef.current;
    if (!form) return;
    const veiculoId = (form.elements.namedItem("veiculo_id") as HTMLSelectElement | null)?.value || "";
    const dataInfr =
      (form.elements.namedItem("data_infracao") as HTMLInputElement | null)?.value ||
      (form.elements.namedItem("data_despesa") as HTMLInputElement | null)?.value || "";
    if (!veiculoId) return setCondutor({ ok: false, error: "Escolhe primeiro o veículo." });
    if (!dataInfr) return setCondutor({ ok: false, error: "Indica a data da infração." });
    setAResolver(true);
    const r = await resolverCondutor(veiculoId, dataInfr);
    setAResolver(false);
    setCondutor(r.ok ? { ok: true, nome: r.motorista_nome, contrato: r.contrato_numero } : { ok: false, error: r.error });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setErro(null);
    setAGravar(true);

    const veiculoId = String(dados.get("veiculo_id") ?? "") || null;

    // Coima nova → procedimento automático (imputa ao motorista, gera dívida,
    // notifica). Editar uma coima existente segue o fluxo normal de despesa.
    if (!aEditar && categoria === "coima") {
      try {
        const r = await registarCoima({
          veiculo_id: veiculoId,
          valor: String(dados.get("valor") ?? "").replace(",", "."),
          iva: String(dados.get("iva") ?? "").replace(",", ".") || null,
          descricao: String(dados.get("descricao") ?? "").trim() || null,
          data_despesa: String(dados.get("data_despesa") ?? ""),
          data_infracao: String(dados.get("data_infracao") ?? "") || null,
          pontos: dados.get("pontos") ? Number(dados.get("pontos")) : null,
          fornecedor: String(dados.get("fornecedor") ?? "").trim() || null,
          referencia_externa: String(dados.get("referencia_externa") ?? "").trim() || null,
          data_vencimento: String(dados.get("data_vencimento") ?? "") || null,
          gerar_divida: dados.get("gerar_divida") === "on",
          notificar: dados.get("notificar") === "on",
        });
        setAGravar(false);
        if (!r.success) return setErro(r.error ?? "Erro ao gravar a coima.");

        const resumo: string[] = [];
        if (r.motorista_nome) resumo.push(`Condutor: ${r.motorista_nome}${r.contrato_numero ? ` (${r.contrato_numero})` : ""}`);
        if (r.divida_gerada) resumo.push(`Dívida ao motorista: ${formatarPreco(r.valor_divida ?? "0")}`);
        if (r.notificado && r.notificado !== "nenhum") resumo.push(`Motorista notificado (${r.notificado})`);
        if (r.aviso) resumo.push(r.aviso);
        if (resumo.length) alert(resumo.join("\n"));

        const dono = veiculoId ? motos.find((m) => m.id === veiculoId)?.proprietario_id ?? null : null;
        const valorN = Number(String(dados.get("valor") ?? "").replace(",", "."));
        const ivaN = Number(String(dados.get("iva") ?? "").replace(",", ".")) || 0;
        onSaved({
          ...({ created_at: new Date().toISOString() } as DespesaComNomes),
          id: r.id ?? "",
          veiculo_id: veiculoId,
          categoria: "coima",
          descricao: String(dados.get("descricao") ?? "").trim() || "Coima",
          valor: String(valorN),
          iva: ivaN ? String(ivaN) : null,
          valor_total: String(valorN + ivaN),
          data_despesa: String(dados.get("data_despesa") ?? ""),
          imputar_a: "motorista",
          estado_pagamento: "pendente",
          proprietario_id: dono,
          veiculo_matricula: veiculoId ? motos.find((m) => m.id === veiculoId)?.matricula ?? "—" : null,
          proprietario_nome: proprietarios.find((p) => p.id === dono)?.nome ?? null,
        } as DespesaComNomes);
      } catch (err) {
        console.error(err);
        setErro("Erro inesperado. Tenta novamente.");
        setAGravar(false);
      }
      return;
    }

    const base = {
      veiculo_id: veiculoId,
      categoria: String(dados.get("categoria") ?? "outro") as DespesaCategoria,
      descricao: String(dados.get("descricao") ?? "").trim() || null,
      valor: String(dados.get("valor") ?? "").replace(",", "."),
      iva: String(dados.get("iva") ?? "").replace(",", ".") || null,
      data_despesa: String(dados.get("data_despesa") ?? ""),
      data_vencimento: String(dados.get("data_vencimento") ?? "") || null,
      estado_pagamento: String(dados.get("estado_pagamento") ?? "pendente") as EstadoPagamentoDespesa,
      imputar_a: String(dados.get("imputar_a") ?? "goscooters") as ImputarA,
      fornecedor: String(dados.get("fornecedor") ?? "").trim() || null,
      referencia_externa: String(dados.get("referencia_externa") ?? "").trim() || null,
      recorrente: dados.get("recorrente") === "on",
    };

    if (!base.valor || Number.isNaN(Number(base.valor)) || Number(base.valor) < 0) {
      setErro("Indica um valor válido.");
      setAGravar(false);
      return;
    }

    try {
      const r = aEditar
        ? await atualizarDespesa(despesa!.id, base)
        : await criarDespesa(base);
      setAGravar(false);
      if (!r.success) {
        setErro(r.error ?? "Erro ao gravar.");
        return;
      }
      const dono = veiculoId
        ? motos.find((m) => m.id === veiculoId)?.proprietario_id ?? null
        : null;
      onSaved({
        ...(despesa ?? ({ created_at: new Date().toISOString() } as DespesaComNomes)),
        ...(base as Partial<Despesa>),
        valor_total: String(Number(base.valor) + Number(base.iva ?? 0)),
        proprietario_id: dono,
        id: aEditar ? despesa!.id : (r as { id?: string }).id ?? "",
        veiculo_matricula: veiculoId ? motos.find((m) => m.id === veiculoId)?.matricula ?? "—" : null,
        proprietario_nome: proprietarios.find((p) => p.id === dono)?.nome ?? null,
      } as DespesaComNomes);
    } catch (err) {
      console.error(err);
      setErro("Erro inesperado. Tenta novamente.");
      setAGravar(false);
    }
  };

  return (
    <Modal onClose={onClose} titulo={aEditar ? "Editar despesa" : "Nova despesa"} maxWidth="max-w-lg">
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Categoria</span>
              <select
                className={campo}
                name="categoria"
                value={categoria}
                onChange={(e) => trocarCategoria(e.target.value as DespesaCategoria)}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>{c.rotulo}</option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              <span>Veículo</span>
              <select className={campo} name="veiculo_id" defaultValue={despesa?.veiculo_id ?? ""}>
                <option value="">— custo de estrutura —</option>
                {motos.map((m) => (
                  <option key={m.id} value={m.id}>{m.matricula ?? m.modelo}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>Valor (€) <span className="text-red-600">*</span></span>
              <input className={campo} name="valor" type="number" step="0.01" min="0" defaultValue={despesa?.valor ?? ""} required />
            </label>
            <label className={etiqueta}>
              <span>IVA (€)</span>
              <input className={campo} name="iva" type="number" step="0.01" min="0" defaultValue={despesa?.iva ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>Data <span className="text-red-600">*</span></span>
              <input className={campo} name="data_despesa" type="date" defaultValue={despesa?.data_despesa ?? hoje()} required />
            </label>
          </div>

          <label className={etiqueta}>
            <span>Descrição</span>
            <input className={campo} name="descricao" defaultValue={despesa?.descricao ?? ""} placeholder="Ex.: mudança de óleo e travões" />
          </label>

          {!aEditar && categoria === "coima" && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Coima — procedimento automático
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={etiqueta}>
                  <span>Data da infração</span>
                  <input className={campo} name="data_infracao" type="date" />
                </label>
                <label className={etiqueta}>
                  <span>Pontos (se aplicável)</span>
                  <input className={campo} name="pontos" type="number" min="0" step="1" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Botao type="button" variante="secondary" tamanho="sm" onClick={sugerirCondutor} disabled={aResolver}>
                  {aResolver ? "A procurar…" : "Sugerir condutor"}
                </Botao>
                {condutor &&
                  (condutor.ok ? (
                    <span className="text-sm text-emerald-700">
                      Condutor: <strong>{condutor.nome}</strong>
                      {condutor.contrato ? ` · ${condutor.contrato}` : ""}
                    </span>
                  ) : (
                    <span className="text-sm text-red-700">{condutor.error}</span>
                  ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white p-3">
                  <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="gerar_divida" defaultChecked />
                  <span className="text-sm text-slate-700">Gerar dívida ao motorista</span>
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-white p-3">
                  <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="notificar" />
                  <span className="text-sm text-slate-700">Notificar o motorista</span>
                </label>
              </div>
              <p className="text-xs text-slate-500">
                A coima é imputada ao motorista (reembolso — não entra na comissão). Se gerares a
                dívida, ela aparece nas Cobranças e liquida-se como qualquer outra.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Quem suporta o custo</span>
              <select
                className={campo}
                name="imputar_a"
                value={imputarA}
                onChange={(e) => setImputarA(e.target.value as ImputarA)}
              >
                <option value="goscooters">GoScooters</option>
                <option value="proprietario">Proprietário</option>
                <option value="motorista">Motorista</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Estado do pagamento</span>
              <select className={campo} name="estado_pagamento" defaultValue={despesa?.estado_pagamento ?? "pendente"}>
                <option value="pendente">Pendente</option>
                <option value="parcial">Parcial</option>
                <option value="paga">Paga</option>
                <option value="isenta">Isenta</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Fornecedor</span>
              <input className={campo} name="fornecedor" defaultValue={despesa?.fornecedor ?? ""} placeholder="Oficina, Via Verde..." />
            </label>
            <label className={etiqueta}>
              <span>Referência (nº fatura/auto)</span>
              <input className={campo} name="referencia_externa" defaultValue={despesa?.referencia_externa ?? ""} />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <input className="h-4 w-4 accent-emerald-600" type="checkbox" name="recorrente" defaultChecked={despesa?.recorrente ?? false} />
            <span className="text-sm text-slate-700">Despesa recorrente (ex.: GPS, seguro mensal)</span>
          </label>

          {erro && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Botao type="button" variante="secondary" tamanho="lg" className="flex-1" onClick={onClose}>
              Cancelar
            </Botao>
            <Botao type="submit" tamanho="lg" className="flex-1" disabled={aGravar}>
              {aGravar ? "A gravar..." : aEditar ? "Guardar" : "Criar despesa"}
            </Botao>
          </div>
        </form>
    </Modal>
  );
}
