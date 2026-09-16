"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Botao, Modal, campo, etiqueta, painelEncaixe } from "@/components/ui";
import { dataBR } from "@/lib/datas";
import { diasUteisAte, hojeEmLisboa, somarDiasUteis, textoDiasUteis } from "@/lib/diasUteis";
import { enviarDocumentoPrivado } from "@/lib/uploads";
import {
  abrirIdentificacao,
  definirCondutor,
  definirEntidade,
  enviarF306PorEmail,
  gerarF306,
  guardarDadosDoAuto,
  lerAutoDoDocumento,
  marcarNaoAplicavel,
  reabrirIdentificacao,
  registarCondutor,
  registarEnvioManual,
  registarF306Assinado,
  type IdentificacaoCondutor,
  type RespostaIdentificacao,
} from "@/actions/infracaoActions";
import {
  CANAL_ENVIO_ROTULO,
  DIAS_UTEIS_PARA_IDENTIFICAR,
  ESTADO_INFRACAO_ROTULO,
  type FaltaF306,
  type InfracaoEnvioCanal,
  type InfracaoSignatario,
} from "@/types/infracao";
import type { DocIdTipo } from "@/types/db";

/** Cor do prazo: vermelho nos últimos 3 dias úteis (e depois), âmbar até 7. */
export function corDoPrazo(dias: number): string {
  return dias <= 3 ? "text-red-700" : dias <= 7 ? "text-amber-700" : "text-slate-600";
}

/** Os canais de um auto de outra entidade (EMEL, câmara): sem a ANSR no nome. */
const CANAL_OUTRA_ENTIDADE: Record<InfracaoEnvioCanal, string> = {
  email: "Email",
  portal: "Portal da entidade",
  correio_registado: "Correio registado",
  presencial: "Entregue em mão",
};

type Condutor = NonNullable<IdentificacaoCondutor["condutor"]>;

/** Quem aponta o outro motorista para a data: o sujeito da frase do aviso. */
const QUEM_INDICA: Record<Condutor["origem"], (contrato: string | null) => string> = {
  coima: () => "a coima indica",
  contrato: (numero) => `o contrato${numero ? ` ${numero}` : ""} indica`,
  cobrancas: () => "as cobranças de renda dessa semana indicam",
};

function origemDoCondutor(c: Condutor): string {
  if (c.contrato_numero) return `Contrato ${c.contrato_numero}`;
  return c.origem === "cobrancas" ? "Pelas cobranças dessa semana" : "Associado à coima";
}

/**
 * Identificação do condutor de uma coima — o F306 da ANSR, do auto ao envio.
 * Usada em Coimas e em Despesas. Os passos seguem o estado da linha `infracao`;
 * cada ação devolve o estado novo, lido outra vez no servidor.
 */
export default function IdentificacaoCondutorModal({
  inicial,
  motoristas,
  onClose,
  onMudou,
}: {
  inicial: IdentificacaoCondutor;
  motoristas: { id: string; nome: string }[];
  onClose: () => void;
  onMudou: (dados: IdentificacaoCondutor) => void;
}) {
  const [dados, setDados] = useState(inicial);
  const i = dados.infracao;
  const [numeroAuto, setNumeroAuto] = useState(inicial.infracao?.numero_auto ?? "");
  const [dataInfracao, setDataInfracao] = useState(inicial.data_infracao_registada ?? "");
  const [dataNotificacao, setDataNotificacao] = useState(inicial.infracao?.data_notificacao ?? "");
  const [signatario, setSignatario] = useState<InfracaoSignatario>(
    inicial.infracao?.signatario ?? (inicial.arguido?.coletiva ? "representante_legal" : "arguido"),
  );
  const [escolher, setEscolher] = useState(!inicial.condutor);
  const [escolhido, setEscolhido] = useState("");
  const [novoCondutor, setNovoCondutor] = useState(false);
  const [nota, setNota] = useState("");
  const [canal, setCanal] = useState<InfracaoEnvioCanal>("correio_registado");
  const [dataEnvio, setDataEnvio] = useState(hojeEmLisboa());
  const [referencia, setReferencia] = useState("");
  const [comprovativo, setComprovativo] = useState<File | null>(null);
  const [aCorrer, setACorrer] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const hoje = hojeEmLisboa();
  const ehAnsr = dados.regime === "ansr";
  const enviada = i?.estado === "enviada";
  const naoAplicavel = i?.estado === "nao_aplicavel";
  const fechada = enviada || naoAplicavel;
  const bloqueiam = dados.faltam.filter((f) => f.obrigatorio);
  const autoValido = ehAnsr ? /^\d{9}$/.test(numeroAuto.replace(/[\s.-]/g, "")) : numeroAuto.trim().length > 0;
  const prazo = /^\d{4}-\d{2}-\d{2}$/.test(dataNotificacao)
    ? somarDiasUteis(dataNotificacao, DIAS_UTEIS_PARA_IDENTIFICAR)
    : null;
  const diasAtePrazo = prazo ? diasUteisAte(hoje, prazo) : null;
  const dadosDoAuto = {
    numero_auto: numeroAuto,
    data_notificacao: dataNotificacao,
    signatario,
    data_infracao: dataInfracao || null,
  };
  const rotuloCanal = ehAnsr ? CANAL_ENVIO_ROTULO : CANAL_OUTRA_ENTIDADE;

  /** Corre uma ação e mostra o estado novo. Devolve a resposta (null se rebentou). */
  const correr = async (
    qual: string,
    acao: () => Promise<RespostaIdentificacao>,
  ): Promise<RespostaIdentificacao | null> => {
    setErro(null);
    setAviso(null);
    setACorrer(qual);
    try {
      const r = await acao();
      if (!r.ok) {
        setErro(r.error);
        // A recusa pode trazer o estado de agora (ex.: com a data nova, outro condutor).
        if (r.dados) {
          setDados(r.dados);
          onMudou(r.dados);
          if (!r.dados.condutor) setEscolher(true);
        }
        return r;
      }
      setDados(r.dados);
      onMudou(r.dados);
      // Ficou sem condutor: a escolha tem de estar à mão.
      if (!r.dados.condutor) setEscolher(true);
      if (r.aviso) setAviso(r.aviso);
      return r;
    } catch (err) {
      console.error(err);
      setErro("Erro inesperado. Tenta novamente.");
      return null;
    } finally {
      setACorrer(null);
    }
  };

  /** Volta a ler tudo. Os campos vazios ganham o que o servidor tiver; o que já está escrito fica. */
  const atualizar = async () => {
    const semCondutor = !dados.condutor;
    const r = await correr("atualizar", () => abrirIdentificacao(dados.despesa_id));
    if (!r?.ok) return;
    const inf = r.dados.infracao;
    setNumeroAuto((v) => v || (inf?.numero_auto ?? ""));
    setDataNotificacao((v) => v || (inf?.data_notificacao ?? ""));
    setDataInfracao((v) => v || (r.dados.data_infracao_registada ?? ""));
    if (semCondutor && r.dados.condutor && !novoCondutor) setEscolher(false);
  };

  const lerDoDocumento = () =>
    correr("ler", async () => {
      const r = await lerAutoDoDocumento(dados.despesa_id);
      if (r.ok && r.lido) {
        if (r.lido.numero) setNumeroAuto(r.lido.numero);
        if (r.lido.dataNotificacao) setDataNotificacao(r.lido.dataNotificacao);
      }
      return r;
    });

  const mudarEntidade = () => {
    if (ehAnsr) {
      const entidade = window.prompt(
        "Quem instrui este processo? (ex.: EMEL, Câmara Municipal de …)",
        dados.entidade !== "ANSR" ? dados.entidade : "",
      );
      if (entidade?.trim()) correr("entidade", () => definirEntidade(dados.despesa_id, { regime: "outro", entidade }));
    } else if (window.confirm("Este auto é da ANSR (levantado pela PSP, GNR ou pela própria ANSR)?")) {
      correr("entidade", () => definirEntidade(dados.despesa_id, { regime: "ansr" }));
    }
  };

  const usarMotorista = async () => {
    const r = await correr("condutor", () => definirCondutor(dados.despesa_id, escolhido));
    if (r?.ok) {
      setEscolher(false);
      setEscolhido("");
    }
  };

  const registarNovo = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const texto = (k: string) => String(f.get(k) ?? "").trim();
    const r = await correr("registar", () =>
      registarCondutor(dados.despesa_id, {
        nome: texto("nome"),
        telefone: texto("telefone"),
        nif: texto("nif") || null,
        pais_iso: texto("pais_iso") || null,
        doc_id_tipo: (texto("doc_id_tipo") || null) as DocIdTipo | null,
        doc_id_numero: texto("doc_id_numero") || null,
        doc_id_emissao: texto("doc_id_emissao") || null,
        doc_id_validade: texto("doc_id_validade") || null,
        doc_id_emissor: texto("doc_id_emissor") || null,
        carta_numero: texto("carta_numero") || null,
        carta_pais: texto("carta_pais") || null,
        morada_linha1: texto("morada_linha1") || null,
        codigo_postal: texto("codigo_postal") || null,
        localidade: texto("localidade") || null,
      }),
    );
    if (r?.ok) {
      setEscolher(false);
      setNovoCondutor(false);
    }
  };

  const gerar = () => {
    if (i?.f306_assinado_path && !window.confirm("Gerar outra vez? O F306 assinado deixa de valer e tens de o assinar de novo.")) {
      return;
    }
    correr("gerar", () => gerarF306(dados.despesa_id, dadosDoAuto));
  };

  const carregarAssinado = (e: ChangeEvent<HTMLInputElement>) => {
    const ficheiro = e.target.files?.[0];
    e.target.value = "";
    if (!ficheiro) return;
    if (ficheiro.type !== "application/pdf") {
      setErro("Carrega o PDF assinado que a app Autenticação.gov gravou.");
      return;
    }
    correr("assinado", async () => {
      const up = await enviarDocumentoPrivado(ficheiro, "infracoes/f306");
      if (!up.success || !up.path) return { ok: false, error: up.error ?? "Erro ao carregar o ficheiro." };
      return registarF306Assinado(dados.despesa_id, up.path);
    });
  };

  const enviarEmail = () => {
    if (!window.confirm("Enviar o F306 assinado para mail@ansr.pt?")) return;
    correr("email", () =>
      enviarF306PorEmail(dados.despesa_id, {
        nota,
        signatario,
        numero_auto: numeroAuto,
        data_infracao: dataInfracao || null,
      }),
    );
  };

  const registarManual = () =>
    correr("manual", async () => {
      let comprovativoPath: string | null = null;
      if (comprovativo) {
        const up = await enviarDocumentoPrivado(comprovativo, "infracoes/f306");
        if (!up.success || !up.path) return { ok: false, error: up.error ?? "Erro ao carregar o comprovativo." };
        comprovativoPath = up.path;
      }
      return registarEnvioManual(dados.despesa_id, {
        canal,
        data: dataEnvio,
        referencia,
        comprovativo_path: comprovativoPath,
      });
    });

  const naoIdentificar = () => {
    const motivo = window.prompt(
      "Porque é que esta coima não leva identificação de condutor?\n(ex.: o dono conduzia; já foi tratada fora da plataforma)",
    );
    if (motivo?.trim()) correr("nao_aplicavel", () => marcarNaoAplicavel(dados.despesa_id, motivo));
  };

  const link = (href: string | null, texto: string) =>
    href ? (
      <a className="font-medium text-emerald-700 underline" href={href} target="_blank" rel="noreferrer">
        {texto}
      </a>
    ) : (
      <span>{texto}</span>
    );

  const assinadaParaEnviar = ehAnsr && i?.estado === "assinada" && !dados.f306_desatualizado;
  // O envio segue o que está no ecrã; o servidor só aceita depois de guardado.
  const faltaCertidao = signatario === "representante_legal" && !nota.trim();
  const autoNoEcra = ehAnsr ? numeroAuto.replace(/[\s.-]/g, "") : numeroAuto.trim();
  const porGuardar =
    Boolean(i) &&
    (autoNoEcra !== (i?.numero_auto ?? "") ||
      (dataInfracao !== "" && dataInfracao !== (dados.data_infracao_registada ?? "")) ||
      dataNotificacao !== (i?.data_notificacao ?? "") ||
      signatario !== i?.signatario);
  const alternativa = fechada ? null : dados.alternativa;
  const condutorPorConfirmar = !fechada && dados.condutor_por_confirmar;
  const duvidaNoCondutor = Boolean(alternativa) || condutorPorConfirmar;
  // Outro condutor escolhido na lista (ou a registar) e ainda não usado: nada segue com o de antes.
  const condutorPorGuardar = !fechada && escolher && (Boolean(escolhido) || novoCondutor);

  return (
    <Modal
      onClose={onClose}
      titulo="Identificar condutor"
      subtitulo={`${ehAnsr ? "F306 da ANSR" : dados.entidade} · ${dados.matricula ?? "sem mota"} · infração de ${dataBR(dados.data_infracao)}`}
    >
      <div className="space-y-6">
        {i && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {ESTADO_INFRACAO_ROTULO[i.estado]}
            </span>
            {i.prazo_identificacao && !fechada && (
              <span className={corDoPrazo(diasUteisAte(hoje, i.prazo_identificacao))}>
                Prazo {dataBR(i.prazo_identificacao)} · {textoDiasUteis(diasUteisAte(hoje, i.prazo_identificacao))}
              </span>
            )}
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Quem é quem</h3>
            <Botao variante="ghost" tamanho="sm" disabled={Boolean(aCorrer)} onClick={atualizar}>
              {aCorrer === "atualizar" ? "A atualizar…" : "Atualizar dados"}
            </Botao>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Ficha
              titulo="Arguido · titular da mota"
              nome={dados.arguido?.nome}
              detalhe={[
                dados.arguido?.parceiro ?? null,
                dados.arguido ? (dados.arguido.coletiva ? "Pessoa coletiva" : "Pessoa singular") : null,
                dados.arguido?.nif ? `NIF ${dados.arguido.nif}` : null,
              ]}
              faltam={dados.faltam.filter((f) => f.quem === "arguido")}
              semFicha="A mota não tem proprietário."
              href="/admin/proprietarios"
            />
            <div className="space-y-2">
              <Ficha
                titulo="Condutor · quem tinha a mota"
                nome={dados.condutor?.nome}
                detalhe={[
                  dados.condutor ? origemDoCondutor(dados.condutor) : null,
                  dados.condutor?.nif ? `NIF ${dados.condutor.nif}` : null,
                ]}
                faltam={dados.faltam.filter((f) => f.quem === "condutor")}
                semFicha="Não encontrei quem tinha a mota nesta data — nem nos contratos, nem nas cobranças."
                href={dados.condutor ? `/admin/motoristas?m=${dados.condutor.id}` : null}
              />
              {!fechada && dados.condutor && !escolher && (
                <button
                  type="button"
                  className="text-sm font-medium text-emerald-700 underline"
                  onClick={() => setEscolher(true)}
                >
                  Não foi este — trocar o condutor
                </button>
              )}
            </div>
          </div>

          {alternativa && dados.condutor && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p>
                Na data da infração ({dataBR(dados.data_infracao)}),{" "}
                {QUEM_INDICA[alternativa.origem](alternativa.contrato_numero)} <strong>{alternativa.nome}</strong>, e
                não {dados.condutor.nome}. Quem conduzia?
              </p>
              <div className="flex flex-wrap gap-3">
                <Botao
                  variante="secondary"
                  tamanho="sm"
                  disabled={Boolean(aCorrer)}
                  onClick={() => correr("condutor", () => definirCondutor(dados.despesa_id, alternativa.id))}
                >
                  {alternativa.nome}
                </Botao>
                <Botao
                  variante="secondary"
                  tamanho="sm"
                  disabled={Boolean(aCorrer)}
                  onClick={() => {
                    const atual = dados.condutor;
                    if (atual) correr("condutor", () => definirCondutor(dados.despesa_id, atual.id));
                  }}
                >
                  {dados.condutor.nome}
                </Botao>
              </div>
              <p className="text-xs">O F306 só se gera depois de confirmares.</p>
            </div>
          )}

          {!alternativa && condutorPorConfirmar && dados.condutor && (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p>
                Nos contratos e nas cobranças de {dataBR(dados.data_infracao)}, nada indica que{" "}
                <strong>{dados.condutor.nome}</strong> tinha a mota. Confirma que era ele ou troca o condutor.
              </p>
              <Botao
                variante="secondary"
                tamanho="sm"
                disabled={Boolean(aCorrer)}
                onClick={() => {
                  const atual = dados.condutor;
                  if (atual) correr("condutor", () => definirCondutor(dados.despesa_id, atual.id));
                }}
              >
                Confirmar {dados.condutor.nome}
              </Botao>
            </div>
          )}

          {!fechada && escolher && (
            <div className={`${painelEncaixe} space-y-3`}>
              <p className="text-sm font-medium text-slate-800">Quem conduzia a mota?</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className={`${etiqueta} min-w-[14rem] flex-1`}>
                  <span>Motorista já registado</span>
                  <select className={campo} value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
                    <option value="">— escolher —</option>
                    {motoristas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <Botao variante="secondary" disabled={!escolhido || Boolean(aCorrer)} onClick={usarMotorista}>
                  {aCorrer === "condutor" ? "A associar…" : "Usar este"}
                </Botao>
              </div>

              {!novoCondutor ? (
                <button
                  type="button"
                  className="text-sm font-medium text-emerald-700 underline"
                  onClick={() => setNovoCondutor(true)}
                >
                  Não está na lista — registar o condutor
                </button>
              ) : (
                <form onSubmit={registarNovo} className="space-y-3 border-t border-slate-200 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={etiqueta}>
                      <span>Nome completo *</span>
                      <input className={campo} name="nome" required />
                    </label>
                    <label className={etiqueta}>
                      <span>Telefone *</span>
                      <input className={campo} name="telefone" inputMode="tel" required />
                    </label>
                    <label className={etiqueta}>
                      <span>NIF</span>
                      <input className={campo} name="nif" inputMode="numeric" />
                    </label>
                    <label className={etiqueta}>
                      <span>Nacionalidade (PT, BR, IN…)</span>
                      <input className={campo} name="pais_iso" maxLength={2} />
                    </label>
                    <label className={etiqueta}>
                      <span>Documento</span>
                      <select className={campo} name="doc_id_tipo" defaultValue="">
                        <option value="">— tipo —</option>
                        <option value="passaporte">Passaporte</option>
                        <option value="titulo_residencia">Título de residência</option>
                        <option value="cc">Cartão de Cidadão</option>
                        <option value="aima">Documento AIMA</option>
                      </select>
                    </label>
                    <label className={etiqueta}>
                      <span>N.º do documento</span>
                      <input className={campo} name="doc_id_numero" />
                    </label>
                    <label className={etiqueta}>
                      <span>Emissão do documento</span>
                      <input className={campo} name="doc_id_emissao" type="date" max={hoje} />
                    </label>
                    <label className={etiqueta}>
                      <span>Validade do documento</span>
                      <input className={campo} name="doc_id_validade" type="date" />
                    </label>
                    <label className={`${etiqueta} sm:col-span-2`}>
                      <span>Emissor do documento</span>
                      <input className={campo} name="doc_id_emissor" placeholder="Autoridade do passaporte, AIMA, SEF…" />
                    </label>
                    <label className={etiqueta}>
                      <span>N.º da carta de condução</span>
                      <input className={campo} name="carta_numero" />
                    </label>
                    <label className={etiqueta}>
                      <span>País da carta (PT, BR, IN…)</span>
                      <input className={campo} name="carta_pais" maxLength={2} />
                    </label>
                    <label className={etiqueta}>
                      <span>Morada</span>
                      <input className={campo} name="morada_linha1" />
                    </label>
                    <label className={etiqueta}>
                      <span>Código postal</span>
                      <input className={campo} name="codigo_postal" />
                    </label>
                    <label className={etiqueta}>
                      <span>Localidade</span>
                      <input className={campo} name="localidade" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Botao type="submit" disabled={Boolean(aCorrer)}>
                      {aCorrer === "registar" ? "A registar…" : "Registar e usar"}
                    </Botao>
                    <Botao type="button" variante="ghost" onClick={() => setNovoCondutor(false)}>
                      Cancelar
                    </Botao>
                  </div>
                  <p className="text-xs text-slate-500">
                    Fica registado em Motoristas. O que faltar para o F306 aparece na ficha do condutor, acima, e
                    completa-se lá.
                  </p>
                </form>
              )}

              {dados.condutor && (
                <button
                  type="button"
                  className="text-xs text-slate-500 underline"
                  onClick={() => {
                    setEscolher(false);
                    setNovoCondutor(false);
                    setEscolhido("");
                  }}
                >
                  Manter {dados.condutor.nome}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">1. O auto</h3>
            {dados.tem_documento && !fechada && (
              <Botao variante="ghost" tamanho="sm" disabled={Boolean(aCorrer)} onClick={lerDoDocumento}>
                {aCorrer === "ler" ? "A ler o documento…" : "Ler do documento"}
              </Botao>
            )}
          </div>
          <p className="text-sm text-slate-600">
            Instrui o processo: <strong>{dados.entidade}</strong>
            {!fechada && (
              <>
                {" · "}
                <button
                  type="button"
                  className="font-medium text-emerald-700 underline"
                  disabled={Boolean(aCorrer)}
                  onClick={mudarEntidade}
                >
                  {ehAnsr ? "Não é da ANSR" : "É da ANSR"}
                </button>
              </>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>N.º do auto{ehAnsr ? " (9 dígitos)" : ""}</span>
              <input
                className={campo}
                inputMode={ehAnsr ? "numeric" : "text"}
                value={numeroAuto}
                onChange={(e) => setNumeroAuto(e.target.value)}
                disabled={fechada}
              />
            </label>
            <label className={etiqueta}>
              <span>Data da infração</span>
              <input
                className={campo}
                type="date"
                max={hoje}
                value={dataInfracao}
                onChange={(e) => setDataInfracao(e.target.value)}
                disabled={fechada}
              />
            </label>
            <label className={etiqueta}>
              <span>Data da notificação</span>
              <input
                className={campo}
                type="date"
                min={dataInfracao || dados.data_infracao}
                max={hoje}
                value={dataNotificacao}
                onChange={(e) => setDataNotificacao(e.target.value)}
                disabled={fechada}
              />
            </label>
          </div>
          {!dados.data_infracao_registada && !dataInfracao && !fechada && (
            <p className="text-xs text-amber-700">
              Sem a data da infração, usa-se a do auto ({dataBR(dados.data_do_auto)}) para encontrar o condutor —
              indica-a para ter a certeza de que é o motorista certo.
            </p>
          )}
          {i?.auto_lido_em && !fechada && (
            <p className="text-xs text-slate-500">Lido do documento — confirma os dados antes de continuar.</p>
          )}
          {ehAnsr && (
            <label className={etiqueta}>
              <span>Quem assina o F306</span>
              <select
                className={campo}
                value={signatario}
                onChange={(e) => setSignatario(e.target.value as InfracaoSignatario)}
                disabled={fechada}
              >
                <option value="arguido">O titular da mota (arguido)</option>
                <option value="representante_legal">O representante legal da empresa</option>
                <option value="mandatario">Um mandatário, com procuração</option>
              </select>
            </label>
          )}
          {prazo && diasAtePrazo != null && !fechada && (
            <p className={`text-sm ${corDoPrazo(diasAtePrazo)}`}>
              Prazo para identificar: <strong>{dataBR(prazo)}</strong> · {textoDiasUteis(diasAtePrazo)}
            </p>
          )}
          <p className="text-xs text-slate-500">
            {DIAS_UTEIS_PARA_IDENTIFICAR} dias úteis a contar da notificação (art. 171.º do Código da Estrada). Na
            dúvida, usa a data da carta: o prazo fica mais curto, nunca mais longo. A conta não desconta feriados
            municipais.
            {ehAnsr &&
              signatario === "representante_legal" &&
              " Na nota do email, indica o código de acesso à certidão permanente da empresa."}
            {ehAnsr &&
              signatario === "mandatario" &&
              " O F306 tem de seguir com a procuração: envia-o pelo portal ou por correio e regista aqui o envio."}
          </p>
          {!ehAnsr && !fechada && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Autos de {dados.entidade}: o F306 da ANSR não serve. Identifica o condutor pelo formulário e canal dessa
              entidade e depois regista aqui o envio, em «Já foi enviado por outro canal».
            </div>
          )}
          {!fechada && (
            <div className="flex flex-wrap gap-3">
              <Botao
                variante="secondary"
                disabled={Boolean(aCorrer)}
                onClick={() => correr("guardar", () => guardarDadosDoAuto(dados.despesa_id, dadosDoAuto))}
              >
                {aCorrer === "guardar" ? "A guardar…" : "Guardar"}
              </Botao>
              {ehAnsr && (
                <Botao
                  disabled={
                    Boolean(aCorrer) ||
                    bloqueiam.length > 0 ||
                    !autoValido ||
                    !prazo ||
                    duvidaNoCondutor ||
                    condutorPorGuardar
                  }
                  onClick={gerar}
                >
                  {aCorrer === "gerar" ? "A gerar…" : i?.f306_path ? "Gerar outra vez" : "Gerar F306"}
                </Botao>
              )}
            </div>
          )}
          {ehAnsr && bloqueiam.length > 0 && !fechada && (
            <p className="text-xs text-amber-700">
              Para gerar o F306, completa as fichas acima e carrega em «Atualizar dados».
            </p>
          )}
        </section>

        {ehAnsr && i?.f306_path && !naoAplicavel && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">2. Assinar</h3>
            {dados.f306_desatualizado && !enviada ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                O condutor ou o titular mudou depois de gerado o F306: gera-o outra vez antes de o assinar.
              </div>
            ) : (
              <>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                  <li>{link(dados.links.f306, "Abre o F306 preenchido")}, confirma os dados e guarda o PDF.</li>
                  <li>
                    Na app <strong>Autenticação.gov</strong>, em Assinatura, escolhe o PDF e assina com o Cartão de
                    Cidadão ou a Chave Móvel Digital. Um titular só com passaporte imprime, assina à mão e envia o
                    original por correio registado.
                  </li>
                  <li>Carrega aqui o PDF assinado digitalmente, ou regista o envio por correio mais abaixo.</li>
                </ol>
                {!enviada && (
                  <label className={etiqueta}>
                    <span>PDF assinado digitalmente</span>
                    <input
                      className={campo}
                      type="file"
                      accept="application/pdf"
                      disabled={Boolean(aCorrer) || condutorPorGuardar}
                      onChange={carregarAssinado}
                    />
                  </label>
                )}
                {aCorrer === "assinado" && <p className="text-sm text-slate-500">A verificar a assinatura…</p>}
              </>
            )}
            {dados.links.assinado && <p className="text-sm">{link(dados.links.assinado, "Ver o F306 assinado")}</p>}
          </section>
        )}

        {assinadaParaEnviar && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">3. Enviar à ANSR</h3>
            {signatario === "mandatario" ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Com mandatário, o F306 segue com a procuração — pelo portal ou por correio. Depois regista o envio em
                «Já foi enviado por outro canal».
              </div>
            ) : (
              <>
                <label className={etiqueta}>
                  <span>
                    Nota no email{signatario === "representante_legal" ? " — código da certidão permanente *" : " (opcional)"}
                  </span>
                  <textarea
                    className={campo}
                    rows={2}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Ex.: código de acesso à certidão permanente"
                  />
                </label>
                <Botao
                  disabled={Boolean(aCorrer) || faltaCertidao || porGuardar || duvidaNoCondutor || condutorPorGuardar}
                  onClick={enviarEmail}
                >
                  {aCorrer === "email" ? "A enviar…" : "Enviar para mail@ansr.pt"}
                </Botao>
                <p className={`text-xs ${porGuardar || condutorPorGuardar ? "text-amber-700" : "text-slate-500"}`}>
                  {condutorPorGuardar
                    ? "Escolheste outro condutor acima: usa-o ou fecha a escolha antes de enviar."
                    : porGuardar
                      ? "Há alterações por guardar acima: carrega em «Guardar» antes de enviar."
                      : "Segue com o PDF assinado em anexo e com cópia para o teu email."}
                </p>
              </>
            )}
          </section>
        )}

        {i && !fechada && (
          <details className={painelEncaixe} open={!ehAnsr}>
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Já foi enviado por outro canal
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={etiqueta}>
                  <span>Canal</span>
                  <select
                    className={campo}
                    value={canal}
                    onChange={(e) => setCanal(e.target.value as InfracaoEnvioCanal)}
                  >
                    {(Object.keys(rotuloCanal) as InfracaoEnvioCanal[]).map((c) => (
                      <option key={c} value={c}>
                        {rotuloCanal[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={etiqueta}>
                  <span>Data do envio</span>
                  <input
                    className={campo}
                    type="date"
                    max={hoje}
                    value={dataEnvio}
                    onChange={(e) => setDataEnvio(e.target.value)}
                  />
                </label>
              </div>
              <label className={etiqueta}>
                <span>Referência</span>
                <input
                  className={campo}
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="N.º do registo dos CTT ou do correio estrangeiro, do pedido no portal…"
                />
              </label>
              <label className={etiqueta}>
                <span>Comprovativo (opcional)</span>
                <input
                  className={campo}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setComprovativo(e.target.files?.[0] ?? null)}
                />
              </label>
              <Botao variante="secondary" disabled={Boolean(aCorrer)} onClick={registarManual}>
                {aCorrer === "manual" ? "A registar…" : "Registar envio"}
              </Botao>
            </div>
          </details>
        )}

        {enviada && i && (
          <div className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p>
              Enviada{i.envio_canal ? ` por ${rotuloCanal[i.envio_canal]}` : ""}
              {i.enviado_em ? ` em ${dataBR(hojeEmLisboa(new Date(i.enviado_em)))}` : ""}
              {i.envio_referencia ? ` · ref. ${i.envio_referencia}` : ""}.
            </p>
            {dados.links.comprovativo && <p>{link(dados.links.comprovativo, "Ver o comprovativo")}</p>}
          </div>
        )}

        {naoAplicavel && i && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <span>Não leva identificação{i.observacoes ? `: ${i.observacoes}` : "."}</span>
            <Botao
              variante="secondary"
              tamanho="sm"
              disabled={Boolean(aCorrer)}
              onClick={() => correr("reabrir", () => reabrirIdentificacao(dados.despesa_id))}
            >
              Reabrir
            </Botao>
          </div>
        )}

        {aviso && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">{aviso}</p>
          </div>
        )}
        {erro && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {!fechada ? (
            <Botao variante="ghost" tamanho="sm" disabled={Boolean(aCorrer)} onClick={naoIdentificar}>
              Não é para identificar
            </Botao>
          ) : (
            <span />
          )}
          <Botao variante="secondary" onClick={onClose}>
            Fechar
          </Botao>
        </div>
      </div>
    </Modal>
  );
}

function Ficha({
  titulo,
  nome,
  detalhe,
  faltam,
  semFicha,
  href,
}: {
  titulo: string;
  nome: string | null | undefined;
  detalhe: (string | null)[];
  faltam: FaltaF306[];
  semFicha: string;
  href: string | null;
}) {
  const obrigatorios = faltam.filter((f) => f.obrigatorio).map((f) => f.campo);
  const opcionais = faltam.filter((f) => !f.obrigatorio).map((f) => f.campo);
  const linhas = detalhe.filter(Boolean);
  return (
    <div className="space-y-1 rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      {nome ? (
        <>
          <p className="font-medium text-slate-950">{nome}</p>
          {linhas.length > 0 && <p className="text-sm text-slate-600">{linhas.join(" · ")}</p>}
          {obrigatorios.length > 0 && <p className="text-sm text-amber-700">Falta: {obrigatorios.join(", ")}</p>}
          {opcionais.length > 0 && <p className="text-xs text-slate-500">Convém ter: {opcionais.join(", ")}</p>}
          {faltam.length > 0 && href && (
            <a className="text-sm font-medium text-emerald-700 underline" href={href} target="_blank" rel="noreferrer">
              Completar a ficha
            </a>
          )}
        </>
      ) : (
        <p className="text-sm text-amber-700">{semFicha}</p>
      )}
    </div>
  );
}
