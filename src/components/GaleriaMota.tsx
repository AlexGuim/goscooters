"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { preencher, type Dicionario } from "@/lib/i18n";

interface GaleriaMotaProps {
  fotos: string[];
  modelo: string;
  dic: Dicionario;
}

/**
 * Galeria com ampliação em ecrã inteiro.
 *
 * Decisões de acessibilidade: o lightbox é um dialog modal, fecha com Escape,
 * navega com as setas do teclado, devolve o foco ao elemento que o abriu e
 * bloqueia o scroll da página por baixo. Em telemóvel responde a deslizes.
 */
export default function GaleriaMota({ fotos, modelo, dic }: GaleriaMotaProps) {
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const abridorRef = useRef<HTMLElement | null>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const toqueX = useRef<number | null>(null);

  const total = fotos.length;

  const abrir = (i: number, origem: HTMLElement) => {
    abridorRef.current = origem;
    setIndice(i);
    setAberto(true);
  };

  const fechar = useCallback(() => {
    setAberto(false);
    // Devolver o foco a quem abriu evita que quem navega por teclado
    // fique perdido no topo da página.
    abridorRef.current?.focus();
  }, []);

  const anterior = useCallback(
    () => setIndice((i) => (i - 1 + total) % total),
    [total],
  );
  const seguinte = useCallback(() => setIndice((i) => (i + 1) % total), [total]);

  useEffect(() => {
    if (!aberto) return;

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowLeft") anterior();
      if (e.key === "ArrowRight") seguinte();
    };

    document.addEventListener("keydown", aoTeclar);

    // Impede a página de fazer scroll enquanto o lightbox está aberto.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fecharRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [aberto, fechar, anterior, seguinte]);

  if (total === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-[2rem] bg-slate-100 text-slate-500">
        {dic.detalhe.semImagem}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => abrir(0, e.currentTarget)}
        className="group relative block w-full overflow-hidden rounded-[2rem] bg-slate-100"
        aria-label={dic.galeria.abrir}
      >
        <Image
          className="h-80 w-full object-cover transition duration-300 group-hover:scale-105"
          src={fotos[0]}
          alt={modelo}
          width={1024}
          height={640}
          sizes="(max-width: 1024px) 100vw, 60vw"
          priority
        />
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {total > 1
            ? preencher(dic.galeria.verTodas, { n: total })
            : dic.galeria.abrir}
        </span>
      </button>

      {total > 1 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {fotos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={(e) => abrir(i, e.currentTarget)}
              className="overflow-hidden rounded-3xl bg-slate-100 ring-emerald-500 transition hover:opacity-80 focus:outline-none focus-visible:ring-2"
              aria-label={preencher(dic.galeria.contador, {
                atual: i + 1,
                total,
              })}
            >
              <Image
                className="h-24 w-full object-cover"
                src={url}
                alt={`${modelo} ${i + 1}`}
                width={200}
                height={150}
                sizes="200px"
              />
            </button>
          ))}
        </div>
      )}

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modelo}
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur"
          onClick={fechar}
          onTouchStart={(e) => {
            toqueX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (toqueX.current === null) return;
            const delta = e.changedTouches[0].clientX - toqueX.current;
            // 50px de margem para não confundir um toque com um deslize.
            if (delta > 50) anterior();
            if (delta < -50) seguinte();
            toqueX.current = null;
          }}
        >
          <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <p className="text-sm font-medium text-white/80">
              {preencher(dic.galeria.contador, { atual: indice + 1, total })}
            </p>
            <button
              ref={fecharRef}
              type="button"
              onClick={fechar}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              {dic.galeria.fechar}
            </button>
          </div>

          <div
            className="flex flex-1 items-center justify-center px-4 pb-6"
            // Clicar na imagem não deve fechar; só o fundo é que fecha.
            onClick={(e) => e.stopPropagation()}
          >
            {total > 1 && (
              <button
                type="button"
                onClick={anterior}
                aria-label={dic.galeria.anterior}
                className="mr-2 hidden h-12 w-12 flex-none items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 sm:flex"
              >
                ‹
              </button>
            )}

            <Image
              src={fotos[indice]}
              alt={`${modelo} ${indice + 1}`}
              width={1600}
              height={1200}
              sizes="100vw"
              className="max-h-[75vh] w-auto rounded-2xl object-contain"
            />

            {total > 1 && (
              <button
                type="button"
                onClick={seguinte}
                aria-label={dic.galeria.seguinte}
                className="ml-2 hidden h-12 w-12 flex-none items-center justify-center rounded-full bg-white/10 text-2xl text-white transition hover:bg-white/20 sm:flex"
              >
                ›
              </button>
            )}
          </div>

          {total > 1 && (
            <div
              className="flex justify-center gap-2 overflow-x-auto px-4 pb-6"
              onClick={(e) => e.stopPropagation()}
            >
              {fotos.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setIndice(i)}
                  aria-label={preencher(dic.galeria.contador, {
                    atual: i + 1,
                    total,
                  })}
                  aria-current={i === indice ? "true" : undefined}
                  className={`h-14 w-20 flex-none overflow-hidden rounded-xl transition ${
                    i === indice
                      ? "ring-2 ring-emerald-500"
                      : "opacity-50 hover:opacity-90"
                  }`}
                >
                  <Image
                    src={url}
                    alt=""
                    width={160}
                    height={112}
                    sizes="80px"
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
