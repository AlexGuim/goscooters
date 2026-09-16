"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Moto } from "@/types/db";
import { Badge, Botao, campo, type BadgeTom } from "@/components/ui";
import { formatarPreco } from "@/lib/precos";
import { dataBR } from "@/lib/datas";
import { diasUteisAte, hojeEmLisboa, textoDiasUteis } from "@/lib/diasUteis";
import { ABERTAS, compararUrgencia, ehAntiga, situacaoDaCoima, type SituacaoCoima } from "@/lib/coimasLista";
import { abrirIdentificacao, type IdentificacaoCondutor } from "@/actions/infracaoActions";
import { ESTADO_INFRACAO_ROTULO, type InfracaoEnvioCanal, type InfracaoEstado } from "@/types/infracao";
import IdentificacaoCondutorModal from "./IdentificacaoCondutor";
import RegistarCoimaModal from "./RegistarCoimaModal";

export interface CoimaLinha {
  id: string;
  matricula: string | null;
  dono: string | null;
  condutor: string | null;
  data_infracao: string;
  valor_total: string;
  numero_auto: string | null;
  entidade: string | null;
  descricao: string | null;
  divida_gerada: boolean;
  /** URL assinado do auto (privado) — resolvido no servidor. */
  documento_ver: string | null;
  infracao: {
    estado: InfracaoEstado;
    prazo_identificacao: string | null;
    enviado_em: string | null;
    envio_canal: InfracaoEnvioCanal | null;
  } | null;
}

type Filtro = "abertas" | "urgentes" | "enviadas" | "todas";

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "abertas", rotulo: "Por tratar" },
  { valor: "urgentes", rotulo: "Prazo a acabar ou passado" },
  { valor: "enviadas", rotulo: "Enviadas" },
  { valor: "todas", rotulo: "Todas" },
];

const TOM: Record<SituacaoCoima, BadgeTom> = {
  em_atraso: "danger",
  a_acabar: "warning",
  sem_prazo: "neutral",
  em_curso: "info",
  enviada: "success",
  anterior: "neutral",
  nao_aplicavel: "neutral",
};

const urgente = (s: SituacaoCoima) => s === "em_atraso" || s === "a_acabar";

type Linha = CoimaLinha & { situacao: SituacaoCoima; dias: number | null };

function rotuloDaSituacao(l: Linha): string {
  if (l.situacao === "enviada") {
    const quando = l.infracao?.enviado_em ? ` em ${dataBR(hojeEmLisboa(new Date(l.infracao.enviado_em)))}` : "";
    return `Identificação enviada${quando}`;
  }
  if (l.situacao === "nao_aplicavel") return "Não leva identificação";
  if (l.situacao === "anterior") return "Anterior à identificação na plataforma";
  if (l.situacao === "sem_prazo") return "Sem data de notificação";
  const estado = ESTADO_INFRACAO_ROTULO[l.infracao?.estado ?? "por_identificar"];
  return l.dias != null ? `${estado} · ${textoDiasUteis(l.dias)}` : estado;
}

/**
 * A lista das coimas, por urgência: o prazo que já passou, o que está a acabar,
 * as que ainda não têm data de notificação, as em curso; depois as fechadas.
 * Cada linha abre a identificação do condutor.
 */
export default function CoimasList({
  inicial,
  motos,
  motoristas,
}: {
  inicial: CoimaLinha[];
  motos: Pick<Moto, "id" | "matricula" | "modelo" | "proprietario_id">[];
  /** Todos os motoristas, incluindo os bloqueados (marcados), para escolher o condutor. */
  motoristas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  // O que mudou nesta sessão por cima do que veio do servidor: um router.refresh()
  // traz as linhas novas sem deitar fora estas alterações.
  const [alteracoes, setAlteracoes] = useState<Record<string, Partial<CoimaLinha>>>({});
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [busca, setBusca] = useState("");
  const [f306, setF306] = useState<IdentificacaoCondutor | null>(null);
  const [aAbrir, setAAbrir] = useState<string | null>(null);
  const [registar, setRegistar] = useState(false);
  const hoje = hojeEmLisboa();

  const linhas: Linha[] = useMemo(
    () =>
      inicial.map((base) => {
        const l = { ...base, ...alteracoes[base.id] };
        const aberta = l.infracao?.estado !== "enviada" && l.infracao?.estado !== "nao_aplicavel";
        const dias = aberta && l.infracao?.prazo_identificacao ? diasUteisAte(hoje, l.infracao.prazo_identificacao) : null;
        const antiga = !l.infracao && ehAntiga(l.data_infracao, hoje);
        return { ...l, dias, situacao: situacaoDaCoima(l.infracao?.estado, dias, antiga) };
      }),
    [inicial, alteracoes, hoje],
  );

  const contagem: Record<Filtro, number> = useMemo(
    () => ({
      abertas: linhas.filter((l) => ABERTAS.includes(l.situacao)).length,
      urgentes: linhas.filter((l) => urgente(l.situacao)).length,
      enviadas: linhas.filter((l) => l.situacao === "enviada").length,
      todas: linhas.length,
    }),
    [linhas],
  );

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) =>
        filtro === "todas"
          ? true
          : filtro === "abertas"
            ? ABERTAS.includes(l.situacao)
            : filtro === "urgentes"
              ? urgente(l.situacao)
              : l.situacao === "enviada",
      )
      .filter(
        (l) =>
          !q ||
          [l.matricula, l.condutor, l.dono, l.numero_auto, l.entidade, l.descricao].some((v) =>
            v?.toLowerCase().includes(q),
          ),
      )
      .sort(compararUrgencia);
  }, [linhas, filtro, busca]);

  /** Leva à linha da lista o estado que a identificação devolve (também o que se grava ao abrir). */
  const aoMudar = (x: IdentificacaoCondutor) =>
    setAlteracoes((atuais) => ({
      ...atuais,
      [x.despesa_id]: {
        ...atuais[x.despesa_id],
        condutor: x.condutor?.nome ?? null,
        ...(x.infracao?.numero_auto ? { numero_auto: x.infracao.numero_auto } : {}),
        infracao: x.infracao
          ? {
              estado: x.infracao.estado,
              prazo_identificacao: x.infracao.prazo_identificacao,
              enviado_em: x.infracao.enviado_em,
              envio_canal: x.infracao.envio_canal,
            }
          : null,
      },
    }));

  const abrir = async (id: string) => {
    // Uma de cada vez: a abertura pode ler o auto com a IA e demorar uns segundos.
    if (aAbrir) return;
    setAAbrir(id);
    try {
      const r = await abrirIdentificacao(id);
      if (r.ok) {
        setF306(r.dados);
        aoMudar(r.dados);
      } else {
        alert(r.error);
      }
    } catch (err) {
      console.error(err);
      alert("Erro inesperado ao abrir a coima. Tenta novamente.");
    } finally {
      setAAbrir(null);
    }
  };

  const aoRegistar = (id: string) => {
    setRegistar(false);
    router.refresh();
    void abrir(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                filtro === f.valor ? "bg-slate-900 text-white" : "bg-white text-slate-700 shadow-sm hover:bg-slate-50"
              }`}
            >
              {f.rotulo} <span className="tabular-nums opacity-70">{contagem[f.valor]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className={`${campo} w-64`}
            placeholder="Procurar matrícula, condutor, auto…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Botao tamanho="lg" onClick={() => setRegistar(true)}>
            + Registar coima
          </Botao>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
          <p className="text-slate-600">
            {linhas.length ? "Nenhuma coima neste filtro." : "Ainda não há coimas registadas."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm">
          {visiveis.map((l) => {
            const aberta = ABERTAS.includes(l.situacao);
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-950">{l.matricula ?? "sem mota"}</span>
                    <Badge tom={TOM[l.situacao]}>{rotuloDaSituacao(l)}</Badge>
                  </div>
                  <p className="text-sm text-slate-600">
                    Infração de {dataBR(l.data_infracao)}
                    {l.numero_auto ? ` · auto ${l.numero_auto}` : ""}
                    {l.entidade ? ` · ${l.entidade}` : ""}
                    {l.descricao && l.descricao !== "Coima" ? ` · ${l.descricao}` : ""}
                  </p>
                  <p className="text-sm">
                    {l.condutor ? (
                      <span className="text-slate-700">
                        Condutor: <strong>{l.condutor}</strong>
                      </span>
                    ) : (
                      <span className="text-amber-700">Condutor por identificar</span>
                    )}
                    {l.dono ? <span className="text-slate-500"> · titular: {l.dono}</span> : null}
                    {l.divida_gerada ? <span className="text-slate-500"> · dívida ao motorista gerada</span> : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold tabular-nums text-slate-950">{formatarPreco(l.valor_total)}</span>
                  {l.documento_ver && (
                    <a
                      className="text-sm font-medium text-emerald-700 underline"
                      href={l.documento_ver}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver o auto
                    </a>
                  )}
                  <Botao
                    variante={aberta ? "primary" : "secondary"}
                    tamanho="sm"
                    disabled={Boolean(aAbrir)}
                    onClick={() => abrir(l.id)}
                  >
                    {aAbrir === l.id ? "A abrir…" : aberta ? "Identificar condutor" : "Ver processo"}
                  </Botao>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aAbrir && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-40 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          A preparar a identificação do condutor…
        </div>
      )}

      {f306 && (
        <IdentificacaoCondutorModal
          key={f306.despesa_id}
          inicial={f306}
          motoristas={motoristas}
          onClose={() => setF306(null)}
          onMudou={aoMudar}
        />
      )}

      {registar && <RegistarCoimaModal motos={motos} onClose={() => setRegistar(false)} onRegistada={aoRegistar} />}
    </div>
  );
}
