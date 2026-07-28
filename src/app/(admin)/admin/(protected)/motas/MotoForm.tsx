"use client";

import { useRef, useState } from "react";
import type {
  Moto,
  MotoEstado,
  Proprietario,
  TipoVeiculo,
  EstadoOperacional,
} from "@/types/db";
import { createMoto, updateMoto } from "@/actions/motoActions";
import { deleteFotoMoto } from "@/actions/fotoActions";
import { enviarFoto, enviarVideo } from "@/lib/uploads";
import { Botao, Modal, campo, etiqueta } from "@/components/ui";

interface MotoFormProps {
  /** Mota a editar; ausente significa criar uma nova. */
  moto?: Moto;
  /** Proprietários disponíveis para o seletor de dono. */
  proprietarios: Proprietario[];
  onClose: () => void;
  onSaved: (moto: Moto) => void;
}

const ESTADO_OP: { valor: EstadoOperacional; rotulo: string }[] = [
  { valor: "disponivel", rotulo: "Disponível" },
  { valor: "ocupado", rotulo: "Ocupado (alugado)" },
  { valor: "manutencao", rotulo: "Em manutenção" },
  { valor: "inativo", rotulo: "Inativo" },
];

// Um só estado no formulário (o operacional) — o estado de catálogo (site) é
// DERIVADO dele, para nunca divergirem (o mesmo casamento do seletor da lista).
function catalogoDe(op: EstadoOperacional): MotoEstado {
  return op === "ocupado" ? "alugada" : op === "manutencao" ? "manutencao" : "disponivel";
}

export default function MotoForm({
  moto,
  proprietarios,
  onClose,
  onSaved,
}: MotoFormProps) {
  const aEditar = Boolean(moto);
  const inputFicheiro = useRef<HTMLInputElement>(null);

  const [fotos, setFotos] = useState<string[]>(moto?.foto_urls ?? []);
  const [aCarregarFoto, setACarregarFoto] = useState(false);
  const [video, setVideo] = useState<string | null>(moto?.video_url ?? null);
  const [aCarregarVideo, setACarregarVideo] = useState(false);
  const inputVideo = useRef<HTMLInputElement>(null);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleUpload = async (ficheiros: FileList | null) => {
    if (!ficheiros?.length) return;

    setErro(null);
    setACarregarFoto(true);

    for (const ficheiro of Array.from(ficheiros)) {
      const resultado = await enviarFoto(ficheiro);

      if (resultado.success && resultado.url) {
        setFotos((atuais) => [...atuais, resultado.url!]);
      } else {
        setErro(resultado.error ?? "Erro ao carregar a imagem.");
        break;
      }
    }

    setACarregarFoto(false);
    if (inputFicheiro.current) inputFicheiro.current.value = "";
  };

  const handleRemoverFoto = async (url: string) => {
    setFotos((atuais) => atuais.filter((f) => f !== url));
    // Apaga do storage sem bloquear a interface; se falhar, fica um ficheiro
    // órfão — chato mas inofensivo, e melhor do que travar o utilizador.
    void deleteFotoMoto(url);
  };

  const handleUploadVideo = async (ficheiros: FileList | null) => {
    const ficheiro = ficheiros?.[0];
    if (!ficheiro) return;

    setErro(null);
    setACarregarVideo(true);

    const resultado = await enviarVideo(ficheiro);

    if (resultado.success && resultado.url) {
      // Substituir o vídeo apaga o anterior — só há um por mota.
      if (video) void deleteFotoMoto(video);
      setVideo(resultado.url);
    } else {
      setErro(resultado.error ?? "Erro ao carregar o vídeo.");
    }

    setACarregarVideo(false);
    if (inputVideo.current) inputVideo.current.value = "";
  };

  const handleRemoverVideo = () => {
    if (video) void deleteFotoMoto(video);
    setVideo(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);

    // Campo vazio significa "período não oferecido", por isso vira null e não 0.
    const preco = (nome: string): string | null => {
      const bruto = String(dados.get(nome) ?? "").trim().replace(",", ".");
      return bruto === "" ? null : bruto;
    };

    const precoDia = preco("preco_dia");
    const precoSemana = preco("preco_semana");
    const precoMes = preco("preco_mes");

    const numero = (nome: string): number | null => {
      const bruto = String(dados.get(nome) ?? "").trim().replace(",", ".");
      return bruto === "" ? null : Number(bruto);
    };

    const ativo = dados.get("ativo") === "on";
    const estadoOperacional = String(
      dados.get("estado_operacional") ?? "disponivel",
    ) as EstadoOperacional;

    const valores = {
      modelo: String(dados.get("modelo") ?? "").trim(),
      marca: String(dados.get("marca") ?? "").trim() || null,
      cilindrada: numero("cilindrada"),
      matricula: String(dados.get("matricula") ?? "").trim() || null,
      ano: numero("ano"),
      cor: String(dados.get("cor") ?? "").trim() || null,
      tipo_veiculo: String(dados.get("tipo_veiculo") ?? "moto") as TipoVeiculo,
      proprietario_id: String(dados.get("proprietario_id") ?? "") || null,
      km_atual: numero("km_atual"),
      comissao_valor_override: preco("comissao_valor_override"),
      preco_dia: precoDia,
      preco_semana: precoSemana,
      preco_mes: precoMes,
      estado: catalogoDe(estadoOperacional),
      estado_operacional: estadoOperacional,
      disponivel_em: String(dados.get("disponivel_em") ?? "") || null,
      descricao: String(dados.get("descricao") ?? "").trim() || null,
      ativo,
      foto_urls: fotos.length > 0 ? fotos : null,
      video_url: video,
    };

    if (!valores.modelo) {
      setErro("O modelo é obrigatório.");
      setAGravar(false);
      return;
    }

    const precos = [precoDia, precoSemana, precoMes].filter(Boolean) as string[];

    // Preço só é obrigatório para publicar no catálogo. Um veículo interno da
    // frota (não visível) pode não ter preço definido.
    if (ativo && precos.length === 0) {
      setErro("Para publicar no catálogo, define pelo menos um preço.");
      setAGravar(false);
      return;
    }

    if (precos.some((p) => Number.isNaN(Number(p)) || Number(p) <= 0)) {
      setErro("Os preços preenchidos têm de ser números maiores que zero.");
      setAGravar(false);
      return;
    }

    const resultado = aEditar
      ? await updateMoto(moto!.id, valores)
      : await createMoto(valores);

    setAGravar(false);

    if (!resultado.success) {
      setErro(resultado.error ?? "Erro ao gravar.");
      return;
    }

    onSaved({
      ...(moto ?? ({} as Moto)),
      ...valores,
      id: aEditar ? moto!.id : (resultado as { id?: string }).id ?? "",
      created_at: moto?.created_at ?? new Date().toISOString(),
    });
  };

  return (
    <Modal onClose={onClose} titulo={aEditar ? "Editar mota" : "Nova mota"} maxWidth="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className={etiqueta}>
            <span>
              Modelo <span className="text-red-600">*</span>
            </span>
            <input
              className={campo}
              name="modelo"
              defaultValue={moto?.modelo ?? ""}
              placeholder="Honda PCX 125"
              required
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Marca</span>
              <input
                className={campo}
                name="marca"
                defaultValue={moto?.marca ?? ""}
                placeholder="Honda"
              />
            </label>
            <label className={etiqueta}>
              <span>Matrícula</span>
              <input
                className={campo}
                name="matricula"
                defaultValue={moto?.matricula ?? ""}
                placeholder="00-AB-00"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-4">
            <label className={etiqueta}>
              <span>Tipo</span>
              <select
                className={campo}
                name="tipo_veiculo"
                defaultValue={moto?.tipo_veiculo ?? "moto"}
              >
                <option value="moto">Moto</option>
                <option value="carro">Carro</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Cilindrada (cc)</span>
              <input
                className={campo}
                name="cilindrada"
                type="number"
                min="0"
                defaultValue={moto?.cilindrada ?? ""}
                placeholder="125"
              />
            </label>
            <label className={etiqueta}>
              <span>Ano</span>
              <input
                className={campo}
                name="ano"
                type="number"
                min="1990"
                defaultValue={moto?.ano ?? ""}
                placeholder="2024"
              />
            </label>
            <label className={etiqueta}>
              <span>Cor</span>
              <input
                className={campo}
                name="cor"
                defaultValue={moto?.cor ?? ""}
                placeholder="Preta"
              />
            </label>
          </div>

          {/* ── Frota: dono, estado e quilometragem ─────────────────── */}
          <div className="grid gap-5 sm:grid-cols-3">
            <label className={etiqueta}>
              <span>Proprietário</span>
              <select
                className={campo}
                name="proprietario_id"
                defaultValue={moto?.proprietario_id ?? ""}
              >
                <option value="">— sem dono —</option>
                {proprietarios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.eh_goscooters ? " (própria)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              <span>Estado</span>
              <select
                className={campo}
                name="estado_operacional"
                defaultValue={moto?.estado_operacional ?? "disponivel"}
              >
                {ESTADO_OP.map((e) => (
                  <option key={e.valor} value={e.valor}>
                    {e.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              <span>Km atual</span>
              <input
                className={campo}
                name="km_atual"
                type="number"
                min="0"
                defaultValue={moto?.km_atual ?? ""}
                placeholder="12000"
              />
            </label>
          </div>

          <label className={etiqueta}>
            <span>Comissão deste veículo (%)</span>
            <input
              className={campo}
              name="comissao_valor_override"
              type="number"
              step="0.1"
              min="0"
              max="100"
              defaultValue={moto?.comissao_valor_override ?? ""}
              placeholder="Deixa vazio para usar a % base do proprietário"
            />
          </label>

          {/* ── Preços ──────────────────────────────────────────────────
              Deixar em branco = período não oferecido. É a ausência de preço
              que decide o que o cliente vê, sem interruptores separados. */}
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <span className="text-sm font-medium text-slate-700">
                Preços <span className="text-red-600">*</span>
              </span>
              <p className="mt-1 text-xs text-slate-500">
                Preenche apenas os períodos que queres oferecer nesta mota. Os que
                deixares em branco não aparecem no site. Pelo menos um é obrigatório.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  { nome: "preco_dia", rotulo: "Diária (€)", exemplo: "15" },
                  { nome: "preco_semana", rotulo: "Semanal (€)", exemplo: "70" },
                  { nome: "preco_mes", rotulo: "Mensal (€)", exemplo: "220" },
                ] as const
              ).map((p) => (
                <label key={p.nome} className={etiqueta}>
                  <span className="text-xs">{p.rotulo}</span>
                  <input
                    className={campo}
                    name={p.nome}
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={moto?.[p.nome] ?? ""}
                    placeholder={p.exemplo}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className={etiqueta}>
            <span>Disponível a partir de</span>
            <input
              className={campo}
              name="disponivel_em"
              type="date"
              defaultValue={moto?.disponivel_em ?? ""}
            />
          </label>

          <label className={etiqueta}>
            <span>Descrição</span>
            <textarea
              className={`${campo} h-24`}
              name="descricao"
              defaultValue={moto?.descricao ?? ""}
              placeholder="Mota urbana confortável para entregas e corridas na cidade."
            />
          </label>

          {/* ── Fotografias ─────────────────────────────────────────── */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-slate-700">Fotografias</span>

            {fotos.length > 0 && (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {fotos.map((url, i) => (
                  <div
                    key={url}
                    className="group relative overflow-hidden rounded-2xl bg-slate-100"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Foto ${i + 1}`}
                      className="h-24 w-full object-cover"
                    />
                    {i === 0 && (
                      <span className="absolute left-1 top-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Capa
                      </span>
                    )}
                    <button
                      className="absolute right-1 top-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-red-600 opacity-0 transition group-hover:opacity-100"
                      onClick={() => handleRemoverFoto(url)}
                      type="button"
                      aria-label="Remover fotografia"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={inputFicheiro}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              disabled={aCarregarFoto}
              onChange={(e) => handleUpload(e.target.files)}
            />
            <p className="text-xs text-slate-500">
              {aCarregarFoto
                ? "A carregar..."
                : "JPG, PNG, WebP ou AVIF, até 5 MB cada. A primeira imagem é a capa no catálogo."}
            </p>
          </div>

          {/* ── Vídeo (opcional, um por mota) ────────────────────────── */}
          <div className="space-y-3">
            <span className="text-sm font-medium text-slate-700">
              Vídeo (opcional)
            </span>

            {video && (
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <video
                  src={video}
                  className="h-16 w-24 flex-none rounded-xl bg-slate-950 object-cover"
                  muted
                  preload="metadata"
                />
                <span className="flex-1 text-sm text-slate-700">Vídeo atual</span>
                <button
                  type="button"
                  onClick={handleRemoverVideo}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                >
                  Remover
                </button>
              </div>
            )}

            <input
              ref={inputVideo}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              disabled={aCarregarVideo}
              onChange={(e) => handleUploadVideo(e.target.files)}
            />
            <p className="text-xs text-slate-500">
              {aCarregarVideo
                ? "A carregar vídeo..."
                : "MP4, WebM ou MOV, até 50 MB. Um clip curto (10-20s) da mota a arrancar é o ideal."}
            </p>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              className="h-4 w-4 accent-emerald-600"
              type="checkbox"
              name="ativo"
              defaultChecked={moto?.ativo ?? true}
            />
            <span className="text-sm text-slate-700">
              Visível no catálogo público
            </span>
          </label>

          {erro && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{erro}</p>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse">
            <Botao
              type="submit"
              tamanho="lg"
              className="flex-1"
              disabled={aGravar || aCarregarFoto || aCarregarVideo}
            >
              {aGravar ? "A gravar..." : aEditar ? "Guardar alterações" : "Criar mota"}
            </Botao>
            <Botao type="button" variante="secondary" tamanho="lg" className="flex-1" onClick={onClose}>
              Cancelar
            </Botao>
          </div>
        </form>
    </Modal>
  );
}
