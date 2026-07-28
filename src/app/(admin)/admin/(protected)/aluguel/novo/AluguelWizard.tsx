"use client";

import Link from "next/link";
import { useState } from "react";
import { criarMotorista, procurarMotoristaPorTelefone } from "@/actions/motoristaActions";
import { criarContrato } from "@/actions/contratoActions";
import { criarSessaoRegisto } from "@/actions/entregaActions";
import { Botao, classesBotao, campo, etiqueta } from "@/components/ui";

type MotoristaOpt = { id: string; nome: string; telefone: string | null };
type MotoOpt = { id: string; matricula: string | null; modelo: string; proprietario_id: string | null; estado_operacional: string };

const PASSOS = ["Motorista", "Contrato", "Entrega"] as const;

export default function AluguelWizard({
  motoristas,
  motos,
}: {
  motoristas: MotoristaOpt[];
  motos: MotoOpt[];
}) {
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [motoristaId, setMotoristaId] = useState<string | null>(null);
  const [motoristaNome, setMotoristaNome] = useState("");
  const [contratoId, setContratoId] = useState<string | null>(null);
  const [contratoNumero, setContratoNumero] = useState("");

  return (
    <div className="space-y-6">
      {/* Barra de passos */}
      <ol className="flex items-center gap-2">
        {PASSOS.map((nome, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const feito = n < passo;
          const atual = n === passo;
          return (
            <li key={nome} className="flex flex-1 items-center gap-2">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  atual ? "bg-emerald-600 text-white" : feito ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                }`}
              >
                {feito ? "✓" : n}
              </span>
              <span className={`text-sm font-semibold ${atual ? "text-slate-950" : "text-slate-500"}`}>{nome}</span>
              {i < PASSOS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
            </li>
          );
        })}
      </ol>

      {passo === 1 && (
        <PassoMotorista
          motoristas={motoristas}
          onPronto={(id, nome) => {
            setMotoristaId(id);
            setMotoristaNome(nome);
            setPasso(2);
          }}
        />
      )}

      {passo === 2 && motoristaId && (
        <PassoContrato
          motoristaId={motoristaId}
          motoristaNome={motoristaNome}
          motos={motos}
          onVoltar={() => setPasso(1)}
          onPronto={(id, numero) => {
            setContratoId(id);
            setContratoNumero(numero);
            setPasso(3);
          }}
        />
      )}

      {passo === 3 && contratoId && (
        <PassoEntrega contratoId={contratoId} contratoNumero={contratoNumero} motoristaNome={motoristaNome} />
      )}
    </div>
  );
}

// ── Passo 1 — Motorista ──────────────────────────────────────────────────────
function PassoMotorista({
  motoristas,
  onPronto,
}: {
  motoristas: MotoristaOpt[];
  onPronto: (id: string, nome: string) => void;
}) {
  const [modo, setModo] = useState<"existente" | "preencher" | "link">("existente");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  // existente
  const [selId, setSelId] = useState("");
  // preencher / link
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [idioma, setIdioma] = useState("pt");
  // link result
  const [link, setLink] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  const escolherExistente = () => {
    const m = motoristas.find((x) => x.id === selId);
    if (!m) return setErro("Escolhe um motorista.");
    onPronto(m.id, m.nome);
  };

  const preencher = async () => {
    setErro(null);
    if (!nome.trim() || !telefone.trim()) return setErro("Nome e telefone são obrigatórios.");
    setAGravar(true);
    const r = await criarMotorista({ nome, telefone, email: email || undefined });
    setAGravar(false);
    if (r.success && r.id) return onPronto(r.id, nome.trim());
    if (r.jaExistiaId) {
      // Já existe pelo telefone — reutiliza-o e avança.
      const p = await procurarMotoristaPorTelefone(telefone);
      const existente = p.motorista;
      if (existente) return onPronto(existente.id, existente.nome);
    }
    setErro(r.error ?? "Erro ao criar o motorista.");
  };

  const enviarLink = async () => {
    setErro(null);
    if (!telefone.trim()) return setErro("Telefone é obrigatório para enviar o link.");
    setAGravar(true);
    const r = await criarSessaoRegisto({ nome: nome || null, telefone, idioma });
    setAGravar(false);
    if (r.success) {
      setLink(r.link ?? null);
      setWhatsapp(r.whatsapp ?? null);
    } else setErro(r.error ?? "Erro ao criar o link.");
  };

  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1">
        {(
          [
            ["existente", "Já existe"],
            ["preencher", "Preencher já"],
            ["link", "Enviar link"],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            onClick={() => { setModo(v); setErro(null); }}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
              modo === v ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      {modo === "existente" && (
        <div className="space-y-3">
          <label className={etiqueta}>
            <span>Motorista</span>
            <select className={campo} value={selId} onChange={(e) => setSelId(e.target.value)}>
              <option value="">Escolhe…</option>
              {motoristas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}{m.telefone ? ` · ${m.telefone}` : ""}
                </option>
              ))}
            </select>
          </label>
          <Botao tamanho="lg" onClick={escolherExistente}>Avançar →</Botao>
        </div>
      )}

      {modo === "preencher" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={etiqueta}><span>Nome</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
            <label className={etiqueta}><span>Telefone</span><input className={campo} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+351…" /></label>
            <label className={etiqueta}><span>Email (opcional)</span><input className={campo} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          <p className="text-xs text-slate-500">O KYC completo (documentos, NIF, morada) recolhe-se no passo 3 (entrega).</p>
          <Botao tamanho="lg" onClick={preencher} disabled={aGravar}>
            {aGravar ? "A criar…" : "Criar e avançar →"}
          </Botao>
        </div>
      )}

      {modo === "link" && (
        <div className="space-y-3">
          {!link ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={etiqueta}><span>Nome (opcional)</span><input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} /></label>
                <label className={etiqueta}><span>Telefone</span><input className={campo} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+351…" /></label>
                <label className={etiqueta}>
                  <span>Língua do formulário</span>
                  <select className={campo} value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                    <option value="pt">Português</option>
                    <option value="en">Inglês</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-slate-500">
                Cria o motorista e abre um pré-contrato. O motorista preenche os dados por link; finalizas o contrato
                depois em Contratos → Em preenchimento.
              </p>
              <Botao tamanho="lg" onClick={enviarLink} disabled={aGravar}>
                {aGravar ? "A criar…" : "Criar link"}
              </Botao>
            </>
          ) : (
            <div className="space-y-3 rounded-2xl bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Link criado — envia ao motorista:</p>
              <input readOnly value={link} className={`${campo} bg-white`} onFocus={(e) => e.currentTarget.select()} />
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noreferrer" className={classesBotao("volt", "md")}>
                  Enviar por WhatsApp
                </a>
              )}
              <p className="text-xs text-emerald-800">
                O pré-contrato ficou em Contratos → Em preenchimento. Podes fechar este ecrã.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Passo 2 — Contrato ───────────────────────────────────────────────────────
function PassoContrato({
  motoristaId,
  motoristaNome,
  motos,
  onVoltar,
  onPronto,
}: {
  motoristaId: string;
  motoristaNome: string;
  motos: MotoOpt[];
  onVoltar: () => void;
  onPronto: (id: string, numero: string) => void;
}) {
  const [veiculoId, setVeiculoId] = useState("");
  const [preco, setPreco] = useState("");
  const [caucao, setCaucao] = useState("");
  const [dataInicio, setDataInicio] = useState(new Date().toISOString().slice(0, 10));
  const [periodicidade, setPeriodicidade] = useState("semanal");
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  const disponiveis = motos.filter((m) => m.estado_operacional === "disponivel");

  const criar = async () => {
    setErro(null);
    if (!veiculoId) return setErro("Escolhe a mota.");
    if (!preco || Number(preco) <= 0) return setErro("Indica um preço válido.");
    if (!dataInicio) return setErro("Indica a data de início.");
    const mota = motos.find((m) => m.id === veiculoId);
    setAGravar(true);
    const r = await criarContrato({
      motorista_id: motoristaId,
      veiculo_id: veiculoId,
      proprietario_id: mota?.proprietario_id ?? null,
      periodicidade: periodicidade as "semanal" | "quinzenal" | "mensal" | "diaria",
      preco_periodo: preco,
      caucao: caucao || null,
      data_inicio: dataInicio,
      estado: "rascunho",
    });
    setAGravar(false);
    if (r.success && r.id) onPronto(r.id, r.numero ?? "");
    else setErro(r.error ?? "Erro ao criar o contrato.");
  };

  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-600">
        Contrato para <strong className="text-slate-950">{motoristaNome}</strong>.{" "}
        {disponiveis.length === 0 && <span className="text-amber-700">Sem motas disponíveis — verifica a frota.</span>}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={etiqueta}>
          <span>Mota <span className="text-red-600">*</span></span>
          <select className={campo} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
            <option value="">Escolhe a mota…</option>
            {disponiveis.map((m) => (
              <option key={m.id} value={m.id}>{m.matricula ?? "sem matrícula"} · {m.modelo}</option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          <span>Periodicidade</span>
          <select className={campo} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
            <option value="semanal">Semanal</option>
            <option value="quinzenal">Quinzenal</option>
            <option value="mensal">Mensal</option>
            <option value="diaria">Diária</option>
          </select>
        </label>
        <label className={etiqueta}><span>Preço por período (€) <span className="text-red-600">*</span></span><input className={campo} value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" placeholder="60" /></label>
        <label className={etiqueta}><span>Caução (€)</span><input className={campo} value={caucao} onChange={(e) => setCaucao(e.target.value)} inputMode="decimal" placeholder="0" /></label>
        <label className={etiqueta}>
          <span>Início <span className="text-red-600">*</span></span>
          <input type="date" className={campo} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        O 1.º pagamento é fixado no dia da entrega da mota (passo 3). A caução também é cobrada na entrega.
      </p>
      {erro && <p className="text-sm text-red-700">{erro}</p>}
      <div className="flex gap-3">
        <Botao variante="secondary" tamanho="lg" onClick={onVoltar}>← Voltar</Botao>
        <Botao tamanho="lg" onClick={criar} disabled={aGravar}>
          {aGravar ? "A criar…" : "Criar contrato e avançar →"}
        </Botao>
      </div>
    </div>
  );
}

// ── Passo 3 — Entrega ────────────────────────────────────────────────────────
function PassoEntrega({
  contratoId,
  contratoNumero,
  motoristaNome,
}: {
  contratoId: string;
  contratoNumero: string;
  motoristaNome: string;
}) {
  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <div className="rounded-2xl bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-800">
          Contrato {contratoNumero} criado para {motoristaNome}. Falta a entrega da mota.
        </p>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-950">Para finalizar a entrega, são obrigatórios:</p>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          <li>• Documento de identidade (com ficheiro/foto)</li>
          <li>• NIF</li>
          <li>• Carta de condução (com ficheiro/foto)</li>
          <li>• Morada</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Ao concluir a entrega, o contrato fica ativo, a mota ocupada e a 1.ª cobrança gerada.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={`/admin/contratos/${contratoId}/entrega`} className={classesBotao("primary", "lg")}>
          Ir para a entrega →
        </Link>
        <Link href="/admin/contratos" className={classesBotao("secondary", "lg")}>
          Ver contratos
        </Link>
      </div>
    </div>
  );
}
