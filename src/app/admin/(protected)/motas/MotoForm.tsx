"use client";

import { useRef, useState } from "react";
import type { Moto, MotoEstado } from "@/types/db";
import { createMoto, updateMoto } from "@/actions/motoActions";
import { uploadFotoMoto, deleteFotoMoto } from "@/actions/fotoActions";

interface MotoFormProps {
  /** Mota a editar; ausente significa criar uma nova. */
  moto?: Moto;
  onClose: () => void;
  onSaved: (moto: Moto) => void;
}

const campo =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm outline-none focus:border-emerald-500";
const etiqueta = "block space-y-2 text-sm font-medium text-slate-700";

export default function MotoForm({ moto, onClose, onSaved }: MotoFormProps) {
  const aEditar = Boolean(moto);
  const inputFicheiro = useRef<HTMLInputElement>(null);

  const [fotos, setFotos] = useState<string[]>(moto?.foto_urls ?? []);
  const [aCarregarFoto, setACarregarFoto] = useState(false);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleUpload = async (ficheiros: FileList | null) => {
    if (!ficheiros?.length) return;

    setErro(null);
    setACarregarFoto(true);

    for (const ficheiro of Array.from(ficheiros)) {
      const formData = new FormData();
      formData.append("foto", ficheiro);

      const resultado = await uploadFotoMoto(formData);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    setAGravar(true);

    const dados = new FormData(e.currentTarget);
    const precoBruto = String(dados.get("preco_mes") ?? "").replace(",", ".");

    const valores = {
      modelo: String(dados.get("modelo") ?? "").trim(),
      cilindrada: dados.get("cilindrada")
        ? Number(dados.get("cilindrada"))
        : null,
      matricula: String(dados.get("matricula") ?? "").trim() || null,
      preco_mes: precoBruto,
      estado: String(dados.get("estado") ?? "disponivel") as MotoEstado,
      disponivel_em: String(dados.get("disponivel_em") ?? "") || null,
      descricao: String(dados.get("descricao") ?? "").trim() || null,
      ativo: dados.get("ativo") === "on",
      foto_urls: fotos.length > 0 ? fotos : null,
    };

    if (!valores.modelo) {
      setErro("O modelo é obrigatório.");
      setAGravar(false);
      return;
    }

    if (!precoBruto || Number.isNaN(Number(precoBruto))) {
      setErro("Indica um preço mensal válido.");
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
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-3xl bg-white p-6 shadow-lg sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold text-slate-950">
            {aEditar ? "Editar mota" : "Nova mota"}
          </h2>
          <button
            className="rounded-full px-3 py-1 text-2xl leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            aria-label="Fechar"
            type="button"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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

          <div className="grid gap-5 sm:grid-cols-3">
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
              <span>
                Preço / mês (€) <span className="text-red-600">*</span>
              </span>
              <input
                className={campo}
                name="preco_mes"
                type="number"
                step="0.01"
                min="0"
                defaultValue={moto?.preco_mes ?? ""}
                placeholder="220"
                required
              />
            </label>
            <label className={etiqueta}>
              <span>Matrícula</span>
              <input
                className={campo}
                name="matricula"
                defaultValue={moto?.matricula ?? ""}
                placeholder="12-AB-34"
              />
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className={etiqueta}>
              <span>Estado</span>
              <select
                className={campo}
                name="estado"
                defaultValue={moto?.estado ?? "disponivel"}
              >
                <option value="disponivel">Disponível</option>
                <option value="alugada">Alugada</option>
                <option value="manutencao">Manutenção</option>
              </select>
            </label>
            <label className={etiqueta}>
              <span>Disponível a partir de</span>
              <input
                className={campo}
                name="disponivel_em"
                type="date"
                defaultValue={moto?.disponivel_em ?? ""}
              />
            </label>
          </div>

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
            <button
              className="flex-1 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              type="submit"
              disabled={aGravar || aCarregarFoto}
            >
              {aGravar ? "A gravar..." : aEditar ? "Guardar alterações" : "Criar mota"}
            </button>
            <button
              className="flex-1 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50"
              type="button"
              onClick={onClose}
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
