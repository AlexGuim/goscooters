"use client";

import { useState } from "react";
import type { Proprietario } from "@/types/db";
import { Botao, Badge, AcoesMenu, Modal, campo, etiqueta, type AcaoMenu } from "@/components/ui";
import {
  criarProprietario,
  atualizarProprietario,
  eliminarProprietario,
  convidarParceiro,
  revogarPortal,
  verPortalComo,
} from "@/actions/proprietarioActions";

export interface ProprietarioComContagem extends Proprietario {
  num_veiculos: number;
}

/** Mensagem pronta a enviar ao motorista com o IBAN e o procedimento. */
function instrucoesPagamento(d: Proprietario): string {
  return [
    "Instruções de pagamento — GoScooters",
    "",
    "O aluguer da tua mota é pago por transferência para:",
    `Titular: ${d.nome}`,
    d.iban ? `IBAN: ${d.iban}` : null,
    "",
    "• Paga sempre no teu dia (o dia em que recebeste a mota).",
    "• Cada pagamento dá direito a 1 semana de utilização.",
    "• Envia-nos o comprovativo por WhatsApp após a transferência.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export default function ProprietariosList({
  inicial,
}: {
  inicial: ProprietarioComContagem[];
}) {
  const [donos, setDonos] = useState(inicial);
  const [modal, setModal] = useState<ProprietarioComContagem | "novo" | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [aConvidar, setAConvidar] = useState<string | null>(null);

  const convidar = async (d: ProprietarioComContagem) => {
    const email = window.prompt("Email do parceiro para o acesso ao portal:", d.email ?? "");
    if (!email) return;
    const password = window.prompt(
      "Palavra-passe para o parceiro (mín. 6 caracteres).\n\nDeixa VAZIO para enviar um link por email.",
      "",
    );
    if (password === null) return; // cancelou
    setAConvidar(d.id);
    const r = await convidarParceiro(d.id, email, password || undefined);
    setAConvidar(null);
    if (r.success) {
      setDonos((atuais) =>
        atuais.map((x) => (x.id === d.id ? { ...x, portal_ativo: true, email } : x)),
      );
      alert(
        r.via === "password"
          ? "Acesso criado. Dá ao parceiro o email + palavra-passe; ele pode alterá-la no portal."
          : "Convite enviado — o parceiro recebe um email com o link de acesso.",
      );
    } else {
      alert(r.error);
    }
  };

  /** Entra na pré-visualização do portal deste parceiro (só leitura). */
  const verComo = async (d: ProprietarioComContagem) => {
    const r = await verPortalComo(d.id);
    if (!r.success) { alert(r.error ?? "Erro."); return; }
    window.location.assign("/portal");
  };

  const revogar = async (d: ProprietarioComContagem) => {
    if (!window.confirm(`Revogar o acesso de "${d.nome}" ao portal?`)) return;
    const r = await revogarPortal(d.id);
    if (r.success) {
      setDonos((atuais) =>
        atuais.map((x) => (x.id === d.id ? { ...x, portal_ativo: false } : x)),
      );
    } else {
      alert(r.error);
    }
  };

  const copiarPagamento = async (d: Proprietario) => {
    try {
      await navigator.clipboard.writeText(instrucoesPagamento(d));
      setCopiado(d.id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      alert("Não foi possível copiar. Usa o botão do WhatsApp.");
    }
  };

  const handleSaved = (d: ProprietarioComContagem) => {
    setDonos((atuais) => {
      const existe = atuais.some((x) => x.id === d.id);
      return existe ? atuais.map((x) => (x.id === d.id ? d : x)) : [...atuais, d];
    });
    setModal(null);
  };

  const handleEliminar = async (d: ProprietarioComContagem) => {
    if (!window.confirm(`Eliminar o proprietário "${d.nome}"?`)) return;
    const r = await eliminarProprietario(d.id);
    if (r.success) setDonos((atuais) => atuais.filter((x) => x.id !== d.id));
    else alert(r.error);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Botao tamanho="lg" onClick={() => setModal("novo")}>
          + Novo proprietário
        </Botao>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {donos.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">{d.nome}</p>
                <p className="text-sm text-slate-500">
                  {d.num_veiculos} {d.num_veiculos === 1 ? "veículo" : "veículos"}
                </p>
              </div>
              {d.eh_goscooters ? (
                <Badge tom="neutral">Frota própria</Badge>
              ) : (
                <Badge tom="accent">{d.comissao_valor != null ? `${d.comissao_valor}%` : "comissão ?"}</Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>{d.tipo_parceiro === "anunciante" ? "Anunciante" : "Gerido"}</span>
              {d.email && <span>{d.email}</span>}
              {d.telefone && <span>{d.telefone}</span>}
              {d.iban && <span className="font-mono">IBAN: {d.iban}</span>}
            </div>

            <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-3">
              <Botao variante="secondary" tamanho="sm" onClick={() => setModal(d)}>
                Editar
              </Botao>
              <AcoesMenu
                alinhar="left"
                acoes={[
                  d.portal_ativo
                    ? { rotulo: "Revogar portal", onClick: () => revogar(d), oculta: d.eh_goscooters }
                    : {
                        rotulo: aConvidar === d.id ? "A convidar…" : "Convidar ao portal",
                        onClick: () => convidar(d),
                        oculta: d.eh_goscooters,
                      },
                  {
                    // Ver o portal com os olhos dele — sem precisar da conta
                    // dele, e sem poder agir em nome dele (é só leitura).
                    rotulo: "Ver o portal como este parceiro",
                    onClick: () => verComo(d),
                    oculta: d.eh_goscooters,
                  },
                  {
                    rotulo: copiado === d.id ? "Copiado ✓" : "Copiar instruções",
                    onClick: () => copiarPagamento(d),
                    oculta: !d.iban,
                  },
                  {
                    rotulo: "Enviar por WhatsApp",
                    href: d.iban ? `https://wa.me/?text=${encodeURIComponent(instrucoesPagamento(d))}` : undefined,
                    externo: true,
                    oculta: !d.iban,
                  },
                  { rotulo: "Eliminar", onClick: () => handleEliminar(d), perigo: true, oculta: d.num_veiculos !== 0 },
                ] satisfies AcaoMenu[]}
              />
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <FormProprietario
          dono={modal === "novo" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function FormProprietario({
  dono,
  onClose,
  onSaved,
}: {
  dono: ProprietarioComContagem | null;
  onClose: () => void;
  onSaved: (d: ProprietarioComContagem) => void;
}) {
  const aEditar = Boolean(dono);
  const [ehGo, setEhGo] = useState(dono?.eh_goscooters ?? false);
  const [recebeDireto, setRecebeDireto] = useState(dono?.recebe_pagamento_direto ?? false);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);
    const comissaoBruta = String(dados.get("comissao_valor") ?? "").replace(",", ".");
    // numeric no Postgres → string (como os preços).
    const comissao = comissaoBruta ? String(Number(comissaoBruta)) : null;
    const campos = {
      nome: String(dados.get("nome") ?? "").trim(),
      email: String(dados.get("email") ?? "").trim() || null,
      telefone: String(dados.get("telefone") ?? "").trim() || null,
      nif: String(dados.get("nif") ?? "").trim() || null,
      iban: String(dados.get("iban") ?? "").trim() || null,
      comissao_valor: ehGo ? null : comissao,
      eh_goscooters: ehGo,
      recebe_pagamento_direto: ehGo ? false : recebeDireto,
      tipo_parceiro: String(dados.get("tipo_parceiro") ?? "gerido") as
        | "gerido"
        | "anunciante",
    };

    if (!campos.nome) {
      setErro("Nome é obrigatório.");
      setAGravar(false);
      return;
    }

    const r = aEditar
      ? await atualizarProprietario(dono!.id, campos)
      : await criarProprietario(campos);
    setAGravar(false);

    if (!r.success) {
      setErro(r.error ?? "Erro ao gravar.");
      return;
    }

    onSaved({
      ...(dono ?? ({ num_veiculos: 0 } as ProprietarioComContagem)),
      ...(campos as Partial<Proprietario>),
      id: aEditar ? dono!.id : (r as { id?: string }).id ?? "",
      comissao_modelo: "percentagem",
    } as ProprietarioComContagem);
  };

  return (
    <Modal onClose={onClose} titulo={aEditar ? "Editar proprietário" : "Novo proprietário"} maxWidth="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className={etiqueta}>
            <span>
              Nome <span className="text-red-600">*</span>
            </span>
            <input className={campo} name="nome" required defaultValue={dono?.nome} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Email</span>
              <input className={campo} type="email" name="email" defaultValue={dono?.email ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>Telefone</span>
              <input className={campo} name="telefone" defaultValue={dono?.telefone ?? ""} />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>NIF</span>
              <input className={campo} name="nif" defaultValue={dono?.nif ?? ""} />
            </label>
            <label className={etiqueta}>
              <span>IBAN (para transferências)</span>
              <input className={campo} name="iban" defaultValue={dono?.iban ?? ""} />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              className="h-4 w-4 accent-emerald-600"
              type="checkbox"
              checked={ehGo}
              onChange={(e) => setEhGo(e.target.checked)}
            />
            <span className="text-sm text-slate-700">
              Frota própria do GoScooters (não gera acerto nem comissão)
            </span>
          </label>

          {!ehGo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={etiqueta}>
                <span>Comissão (% da receita)</span>
                <input
                  className={campo}
                  name="comissao_valor"
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  defaultValue={dono?.comissao_valor ?? ""}
                  placeholder="25"
                />
              </label>
              <label className={etiqueta}>
                <span>Tipo de parceiro</span>
                <select
                  className={campo}
                  name="tipo_parceiro"
                  defaultValue={dono?.tipo_parceiro ?? "gerido"}
                >
                  <option value="gerido">Gerido (GoScooters gere)</option>
                  <option value="anunciante">Anunciante (só divulga)</option>
                </select>
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                <input
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                  type="checkbox"
                  checked={recebeDireto}
                  onChange={(e) => setRecebeDireto(e.target.checked)}
                />
                <span className="text-sm text-slate-700">
                  A renda é paga <strong>diretamente na conta do parceiro</strong>. No acerto,
                  o parceiro deve a comissão (e reembolsos) à GoScooters, em vez de receber o líquido.
                </span>
              </label>
            </div>
          )}

          <p className="text-xs text-slate-500">
            A comissão base aplica-se a todos os veículos deste parceiro. Um veículo
            pode ter uma comissão diferente (ex.: as motos pioneiras a 20%), definida
            na ficha do veículo.
          </p>

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
              {aGravar ? "A gravar..." : aEditar ? "Guardar" : "Criar"}
            </Botao>
          </div>
        </form>
    </Modal>
  );
}
