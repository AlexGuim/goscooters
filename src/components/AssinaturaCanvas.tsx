"use client";

import { useEffect, useRef } from "react";

/**
 * Assinatura desenhada no ecrã. Chama `onChange(blob)` sempre que o traço muda
 * (blob PNG), ou `onChange(null)` quando é limpo. Funciona com rato e toque
 * (Pointer Events), sem dependências.
 */
export default function AssinaturaCanvas({
  onChange,
}: {
  onChange: (blob: Blob | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aDesenhar = useRef(false);
  const temTraco = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
    }
  }, []);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const emitir = () => {
    canvasRef.current?.toBlob((b) => onChange(b), "image/png");
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    aDesenhar.current = true;
    ultimo.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!aDesenhar.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !ultimo.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    temTraco.current = true;
  };
  const onUp = () => {
    if (!aDesenhar.current) return;
    aDesenhar.current = false;
    ultimo.current = null;
    if (temTraco.current) emitir();
  };

  const limpar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    temTraco.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="h-40 w-full touch-none rounded-2xl border border-slate-300 bg-white"
      />
      <button
        type="button"
        onClick={limpar}
        className="text-xs font-semibold text-slate-500 transition hover:text-slate-700"
      >
        Limpar assinatura
      </button>
    </div>
  );
}
