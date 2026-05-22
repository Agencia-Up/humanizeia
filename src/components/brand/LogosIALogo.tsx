/**
 * LogosIA Brand Logo — usa a nova arte (Prompt redesign 16/05)
 *
 * Imagens reais em `public/`:
 *   - logosia-logo-light.png — LOGOS azul-marinho + IA dourado (fundo branco/claro)
 *   - logosia-logo-dark.png  — LOGOS branco + IA dourado (fundo navy/escuro)
 *
 * Mantém as 2 exportações (LogosIALogo, LogosIAIcon) pra não quebrar
 * imports existentes na app. O componente detecta dark mode automaticamente
 * via classe `.dark` no <html> ou via prop forceVariant.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const LOGO_LIGHT = '/logosia-logo-light.png';
const LOGO_DARK = '/logosia-logo-dark.png';

interface LogosIALogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;                          // mantido por compat — a imagem JÁ tem texto
  className?: string;
  iconOnly?: boolean;                          // se true, renderiza só o crop com o símbolo (sem texto LOGOS|IA)
  variant?: 'light' | 'dark' | 'auto';         // light = pra fundo branco | dark = pra fundo navy | auto = detecta
}

const sizesPx = {
  xs: 28,
  sm: 36,
  md: 48,
  lg: 72,
  xl: 96,
};

/* Hook detecta tema escuro via classe `.dark` no <html>.
 * Usa useSyncExternalStore (React 18) — lê o DOM SINCRONAMENTE no primeiro
 * render via getSnapshot e reage a mudanças via MutationObserver. Sem flash
 * inicial de "light" quando o site já está em dark mode. */
function useIsDarkMode(): boolean {
  const subscribe = useCallback((callback: () => void) => {
    if (typeof document === 'undefined') return () => {};
    const observer = new MutationObserver(callback);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);
  const getSnapshot = useCallback(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    []
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * LogosIALogo — versão completa (imagem inteira com símbolo + texto)
 */
export function LogosIALogo({
  size = 'md',
  className = '',
  variant = 'auto',
  iconOnly = false,
}: LogosIALogoProps) {
  const isDark = useIsDarkMode();
  const useDark = variant === 'dark' || (variant === 'auto' && isDark);
  const src = useDark ? LOGO_DARK : LOGO_LIGHT;
  const px = sizesPx[size];

  // iconOnly: usa só o símbolo (parte de cima). A imagem PNG tem símbolo + texto, então
  // se quisermos só ícone, recortamos via object-fit: cover + aspect-square + crop top.
  if (iconOnly) {
    return (
      <div
        className={`relative overflow-hidden inline-flex shrink-0 ${className}`}
        style={{ width: px, height: px }}
      >
        <img
          src={src}
          alt="LOGOS|IA"
          className="absolute inset-0 w-full h-auto"
          style={{
            // a imagem tem ~62% símbolo + 38% texto. Mostra só os ~62% de cima.
            objectFit: 'cover',
            objectPosition: 'top center',
            // escala pra que o símbolo preencha o quadrado
            transform: 'scale(1.6) translateY(15%)',
            transformOrigin: 'center top',
          }}
        />
      </div>
    );
  }

  // Versão completa com texto — preserva aspect ratio da imagem (~1280x848)
  const ratio = 1280 / 848;
  const width = px * ratio;

  return (
    <img
      src={src}
      alt="LOGOS|IA — Plataforma de Atendimento e Vendas com IA"
      className={`shrink-0 select-none ${className}`}
      style={{ height: px, width, objectFit: 'contain' }}
      draggable={false}
    />
  );
}

/**
 * LogosIAIcon — versão compacta (só o símbolo, sem texto LOGOS|IA)
 * Usada em sidebars, headers compactos, favicons etc.
 */
export function LogosIAIcon({
  size = 32,
  className = '',
  variant = 'auto',
}: {
  size?: number;
  className?: string;
  variant?: 'light' | 'dark' | 'auto';
}) {
  const isDark = useIsDarkMode();
  const useDark = variant === 'dark' || (variant === 'auto' && isDark);
  const src = useDark ? LOGO_DARK : LOGO_LIGHT;

  return (
    <div
      className={`relative overflow-hidden inline-flex shrink-0 rounded-md ${className}`}
      style={{ width: size, height: size }}
      aria-label="LOGOS|IA"
    >
      <img
        src={src}
        alt=""
        className="absolute inset-0 w-full h-auto"
        style={{
          // recorta a parte superior (símbolo) — ajustado pra centralizar o cérebro+cruz+livro
          objectFit: 'cover',
          objectPosition: 'top center',
          transform: 'scale(1.55) translateY(12%)',
          transformOrigin: 'center top',
        }}
        draggable={false}
      />
    </div>
  );
}
