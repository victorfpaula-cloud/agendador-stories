"use client";

import { useLayoutEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode, ButtonHTMLAttributes, RefObject } from "react";

// Gera o mapa de deslocamento (a imagem que diz pro filtro SVG como
// "dobrar" o fundo perto das bordas — vermelho = deslocamento horizontal,
// verde = vertical, cinza neutro no centro) já no tamanho exato do
// elemento. Como isso é recalculado a cada medição, funciona em qualquer
// largura sem precisar de uma imagem fixa por componente.
function gerarMapaDeslocamento(width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const desfoque = Math.max(4, Math.round(r * 0.32));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>
  <defs>
    <linearGradient id='gx' x1='0%' y1='0%' x2='100%' y2='0%'><stop offset='0%' stop-color='#000'/><stop offset='100%' stop-color='#f00'/></linearGradient>
    <linearGradient id='gy' x1='0%' y1='0%' x2='0%' y2='100%'><stop offset='0%' stop-color='#000'/><stop offset='100%' stop-color='#0f0'/></linearGradient>
    <filter id='b'><feGaussianBlur stdDeviation='${desfoque}'/></filter>
  </defs>
  <rect width='${width}' height='${height}' rx='${r}' fill='url(#gx)' style='mix-blend-mode:screen'/>
  <rect width='${width}' height='${height}' rx='${r}' fill='url(#gy)' style='mix-blend-mode:screen'/>
  <rect width='${width}' height='${height}' rx='${r}' fill='#808080' filter='url(#b)'/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Mede o elemento em tempo real (ResizeObserver) e monta o filtro de
// refração do tamanho exato dele — assim funciona em qualquer largura
// (botão w-full, aba que estica no grid do celular etc.). Antes de medir
// (primeiro paint) e no Safari/Firefox, cai pro vidro fosco simples: a
// refração de borda via feDisplacementMap só roda no Chrome/Android (ver
// skill liquid-glass), o resto sempre ganha ao menos o blur.
function useVidro<T extends HTMLElement>(radius: number | undefined, scale: number, blur: number) {
  const ref = useRef<T>(null) as RefObject<T>;
  const [tamanho, setTamanho] = useState<{ w: number; h: number } | null>(null);
  const filterId = `vidro-${useId().replace(/[:]/g, "")}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setTamanho({ w: el.clientWidth, h: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const temMapa = !!tamanho && tamanho.w > 0 && tamanho.h > 0;
  const raio = temMapa ? radius ?? tamanho!.h / 2 : 0;
  const mapa = temMapa ? gerarMapaDeslocamento(tamanho!.w, tamanho!.h, raio) : null;

  const backdropFilter = mapa
    ? `blur(${blur}px) url(#${filterId}) brightness(1.05) saturate(1.25)`
    : `blur(${blur}px) brightness(1.05) saturate(1.15)`;

  const filterDefs =
    mapa && tamanho ? (
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
            <feImage result="dm" x={0} y={0} width={tamanho.w} height={tamanho.h} preserveAspectRatio="none" href={mapa} />
            <feDisplacementMap in="SourceGraphic" in2="dm" scale={scale} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
    ) : null;

  return { ref, backdropFilter, filterDefs };
}

// As quatro camadas do vidro (ver skill liquid-glass): refração, cor,
// brilho concentrado no topo (em vez de um contorno uniforme — é o que
// faz parecer vidro de verdade em vez de um "adesivo" colado) e um
// relevo bem sutil pra dar profundidade.
function Camadas({
  backdropFilter,
  tint,
  sheenOpacity,
  fundo,
}: {
  backdropFilter: string;
  tint: string;
  sheenOpacity: number;
  fundo?: boolean;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, borderRadius: "inherit", backdropFilter, WebkitBackdropFilter: backdropFilter, isolation: "isolate", pointerEvents: "none" }}
      />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "inherit", background: tint, pointerEvents: "none" }} />
      <div
        aria-hidden="true"
        style={{
          position: "absolute", left: 0, top: 0, right: 0, height: fundo ? "45%" : "55%", borderRadius: "inherit",
          background: "linear-gradient(180deg, rgba(255,255,255,.62), rgba(255,255,255,0))",
          opacity: sheenOpacity, pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
          boxShadow: fundo
            ? "inset 0 1px 1px rgba(255,255,255,.9), inset 0 -7px 11px -7px rgba(49,46,129,.5)"
            : "inset 0 1px 0 rgba(255,255,255,.8), inset 0 -1px 0 rgba(15,23,42,.05)",
        }}
      />
    </>
  );
}

// Superfície de vidro genérica — pra abas, cards e qualquer container que
// não seja um <button> de verdade (ver GlassButton pra esse caso).
export function GlassSurface({
  radius,
  scale = -18,
  blur = 9,
  tint,
  sheenOpacity = 0.45,
  deep = false,
  className,
  style,
  children,
}: {
  radius?: number;
  scale?: number;
  blur?: number;
  tint: string;
  sheenOpacity?: number;
  deep?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const { ref, backdropFilter, filterDefs } = useVidro<HTMLDivElement>(radius, scale, blur);
  return (
    <div ref={ref} className={className} style={{ position: "relative", overflow: "hidden", borderRadius: radius ?? 9999, ...style }}>
      {filterDefs}
      <Camadas backdropFilter={backdropFilter} tint={tint} sheenOpacity={sheenOpacity} fundo={deep} />
      <div style={{ position: "relative", zIndex: 2, height: "100%" }}>{children}</div>
    </div>
  );
}

// Botão de vidro — cápsula com brilho no topo, feita pra ser o CTA
// principal (equivalente ao antigo bg-brand-600 rounded-lg). Aceita as
// mesmas props de um <button> normal (onClick, disabled, type...).
export function GlassButton({
  scale = -20,
  blur = 9,
  tint = "linear-gradient(180deg, rgba(129,140,248,.52), rgba(61,84,224,.86))",
  className,
  style,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { scale?: number; blur?: number; tint?: string }) {
  const { ref, backdropFilter, filterDefs } = useVidro<HTMLButtonElement>(undefined, scale, blur);
  return (
    <button
      ref={ref}
      disabled={disabled}
      {...rest}
      className={className}
      style={{ position: "relative", overflow: "hidden", borderRadius: 9999, opacity: disabled ? 0.6 : 1, ...style }}
    >
      {filterDefs}
      <Camadas backdropFilter={backdropFilter} tint={tint} sheenOpacity={0.85} fundo />
      <span style={{ position: "relative", zIndex: 2, display: "flex", height: "100%", width: "100%", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {children}
      </span>
    </button>
  );
}
