"use client";

import { useState } from "react";
import Image from "next/image";
import type { Dicionario } from "@/lib/i18n";

interface VideoMotaProps {
  videoUrl: string;
  poster?: string | null;
  modelo: string;
  dic: Dicionario;
}

/**
 * Leitor de vídeo que só descarrega o ficheiro quando o cliente carrega em play.
 *
 * O público está muitas vezes em dados móveis e um vídeo pode ter dezenas de MB.
 * Enquanto ninguém clica, mostra-se apenas o poster (uma foto, leve) com um
 * botão — o <video> nem sequer existe no DOM, portanto não há transferência.
 */
export default function VideoMota({
  videoUrl,
  poster,
  modelo,
  dic,
}: VideoMotaProps) {
  const [ativo, setAtivo] = useState(false);

  if (ativo) {
    return (
      <div className="overflow-hidden rounded-[2rem] bg-slate-950">
        {/* autoPlay porque o utilizador acabou de pedir explicitamente para ver. */}
        <video
          className="h-auto max-h-[70vh] w-full"
          src={videoUrl}
          poster={poster ?? undefined}
          controls
          autoPlay
          playsInline
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAtivo(true)}
      className="group relative block w-full overflow-hidden rounded-[2rem] bg-slate-900"
      aria-label={dic.video.reproduzir}
    >
      {poster ? (
        <Image
          src={poster}
          alt={modelo}
          width={1024}
          height={640}
          sizes="(max-width: 1024px) 100vw, 60vw"
          className="h-80 w-full object-cover opacity-80 transition group-hover:opacity-100"
        />
      ) : (
        <div className="h-80 w-full bg-slate-800" />
      )}

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg transition group-hover:scale-110">
          {/* triângulo de play */}
          <span className="ml-1 h-0 w-0 border-y-[12px] border-l-[20px] border-y-transparent border-l-slate-950" />
        </span>
        <span className="rounded-full bg-slate-950/70 px-4 py-1.5 text-sm font-semibold text-white">
          {dic.video.reproduzir}
        </span>
      </span>
    </button>
  );
}
