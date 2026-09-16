import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { dataBR, dataDeHojeEmLisboa } from "@/lib/datas";
import { documentoDoDetalhe } from "@/lib/documentoDespesa";
import { urlsDocumentosParaAdmin } from "@/lib/documentoDespesaServidor";
import { entradaOleo, lerDadosOleo } from "@/lib/manutencao/dados";
import {
  SELO_FORA_DO_INTERVALO,
  SELO_REPETIDA,
  TEXTO_KM_POR_CONFIRMAR,
  avaliarOleo,
  formatarKm,
  historicoManutencao,
  rotuloEstadoOleo,
  textoEstadoOleo,
  textoProximaTroca,
} from "@/lib/manutencao/oleo";
import { Badge, Cartao } from "@/components/ui";
import BadgeOleo from "../BadgeOleo";
import { BotaoOleoTrocado } from "../OleoTrocado";
import ApagarManutencao from "./ApagarManutencao";
import RegistarServico from "./RegistarServico";

/**
 * A página de uma mota: o km, o estado do óleo e tudo o que já se lhe fez.
 *
 * A manutenção vive só aqui — o modal de Motas ficou com o seguro e um link para
 * esta página. O cálculo é o do módulo puro (src/lib/manutencao/oleo.ts), o mesmo
 * da sub-aba Manutenção, para os dois ecrãs nunca dizerem coisas diferentes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MotaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string }>;
}) {
  await requireAdmin();
  const [{ id }, { de }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const [motoRes, dadosDaFrota] = await Promise.all([
    supabaseAdmin
      .from("moto")
      .select("id, matricula, modelo, estado_operacional")
      .eq("id", id)
      .maybeSingle(),
    // Se a manutenção não carregar, a página abre na mesma com a matrícula e o
    // caminho de volta — como em /admin/motas, onde só a sub-aba é que avisa.
    lerDadosOleo(id).catch((erro) => {
      console.error("MotaPage manutenção:", erro);
      return null;
    }),
  ]);
  if (motoRes.error) {
    console.error("MotaPage moto:", motoRes.error);
    throw new Error("Não foi possível carregar a mota.");
  }
  const moto = motoRes.data;
  if (!moto) notFound();

  const erroManutencao = dadosDaFrota === null;
  const dados = dadosDaFrota?.get(id);
  const entrada = entradaOleo(moto, dados, dataDeHojeEmLisboa());
  const oleo = avaliarOleo(entrada);
  // Da mais recente para a mais antiga: o que interessa ver primeiro é o último
  // serviço. A ordem do cálculo (por km e data) mantém-se, só invertida.
  const historico = historicoManutencao(entrada).reverse();

  // O documento de cada manutenção, pronto a abrir (assinado se for privado).
  const linhaDe = new Map((dados?.linhas ?? []).map((l) => [l.id, l]));
  const documentos = await urlsDocumentosParaAdmin(
    historico.map((h) => documentoDoDetalhe(linhaDe.get(h.manutencaoId)?.detalhe)),
  );

  const ultima = oleo.km.ultimaValida;
  const proxima = textoProximaTroca(oleo.proxima);
  // Quem veio da sub-aba Manutenção volta para lá, e não para a lista das motas.
  const voltar = de === "manutencao" ? "/admin/motas?aba=manutencao" : "/admin/motas";

  return (
    <div className="space-y-6">
      <div>
        <Link href={voltar} className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
          ← Motas
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          {moto.matricula ?? "Sem matrícula"}
        </h1>
        <p className="mt-1 text-slate-600">{moto.modelo}</p>
      </div>

      {erroManutencao ? (
        <Cartao>
          <p className="text-sm text-slate-600">
            Não foi possível carregar a manutenção — recarrega a página.
          </p>
        </Cartao>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Cartao>
              <p className="text-sm text-slate-500">Km atual</p>
              {ultima && !oleo.km.porConfirmar ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-slate-950">{formatarKm(ultima.km)} km</p>
                  <p className="text-xs text-slate-500">leitura de {dataBR(ultima.data)}</p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold text-amber-700">{TEXTO_KM_POR_CONFIRMAR}</p>
                  <p className="text-xs text-slate-500">
                    {ultima
                      ? `última leitura válida: ${formatarKm(ultima.km)} km a ${dataBR(ultima.data)}`
                      : "sem leituras de km"}
                  </p>
                </>
              )}
            </Cartao>

            <Cartao>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">Óleo do motor</p>
                  <p className="mt-1">
                    <BadgeOleo estado={oleo.estado} passou={oleo.passou}>
                      {rotuloEstadoOleo(oleo)}
                    </BadgeOleo>
                  </p>
                </div>
                <BotaoOleoTrocado
                  mota={{ id: moto.id, matricula: moto.matricula, modelo: moto.modelo, ultimaLeitura: ultima }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-700">{textoEstadoOleo(oleo)}</p>
              {proxima && <p className="text-sm text-slate-700">Próxima troca {proxima}</p>}
              {oleo.regra && (
                <p className="mt-2 text-xs text-slate-400">
                  {oleo.regra.nome}: a cada {formatarKm(oleo.regra.km)} km ou {oleo.regra.dias} dias
                  {oleo.regra.porConfirmar ? " (por confirmar com a oficina)" : ""}
                </p>
              )}
            </Cartao>
          </div>

          <Cartao>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">Histórico</h2>
              <RegistarServico
                mota={{ id: moto.id, matricula: moto.matricula, modelo: moto.modelo, ultimaLeitura: ultima }}
              />
            </div>
            {historico.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Sem manutenções registadas.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200">
                {historico.map((h, i) => (
                  <div
                    key={h.manutencaoId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{h.servico}</p>
                      <p className="text-xs text-slate-500">
                        {[
                          h.km != null
                            ? `${formatarKm(h.km)} km`
                            : h.kmRegistadoSuspeito != null
                              ? `${formatarKm(h.kmRegistadoSuspeito)} km (por confirmar)`
                              : null,
                          dataBR(h.data),
                          h.desdeAnterior,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {h.foraDoIntervalo && <Badge tom="warning">{SELO_FORA_DO_INTERVALO}</Badge>}
                      {h.repetida && <Badge tom="neutral">{SELO_REPETIDA}</Badge>}
                      {documentos[i] && (
                        <a
                          href={documentos[i]!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                        >
                          doc
                        </a>
                      )}
                      <ApagarManutencao id={h.manutencaoId} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}
