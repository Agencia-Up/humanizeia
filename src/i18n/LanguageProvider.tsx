import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DICT_EN } from './dictionary';

// ── Tradutor de INTERFACE (layout) embutido ────────────────────────────────────
// Troca o idioma da tela na hora (Português <-> Inglês) sem depender do tradutor do
// navegador (que trava). NÃO mexe na IA/atendimento, nem no backend, nem nos dados do
// cliente — só nos TEXTOS FIXOS da interface, por correspondência EXATA num dicionário
// (DICT_EN). String que não está no dicionário fica como está (seguro: nome de lead,
// carro, etc. nunca são traduzidos). Preferência por navegador (localStorage), padrão PT.
// Ao trocar, recarrega a página pra aplicar do zero (simples e confiável).

type Lang = 'pt' | 'en';
const LS_KEY = 'logos_lang';
const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'pt', setLang: () => {} });
export const useLanguage = () => useContext(LangCtx);

export function getLang(): Lang {
  try { return (localStorage.getItem(LS_KEY) as Lang) === 'en' ? 'en' : 'pt'; } catch { return 'pt'; }
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'SVG']);
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

// Traduz um trecho por correspondência exata (ignora espaços nas pontas).
function tr(text: string): string | null {
  const key = text.trim();
  if (key.length < 2) return null;
  const hit = DICT_EN[key];
  if (hit === undefined || hit === key) return null;
  return text.replace(key, hit); // preserva espaços/quebras nas pontas
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang] = useState<Lang>(getLang);
  const obsRef = useRef<MutationObserver | null>(null);

  const setLang = (l: Lang) => {
    try { localStorage.setItem(LS_KEY, l); } catch { /* ignore */ }
    // recarrega pra aplicar/limpar a tradução do zero (evita estado meio-traduzido)
    window.location.reload();
  };

  useEffect(() => {
    if (lang !== 'en') return; // PT = nada a fazer (padrão)
    const root = document.body;
    let applying = false;

    const trText = (node: Text) => {
      const t = node.nodeValue || '';
      const out = tr(t);
      if (out != null && out !== t) node.nodeValue = out;
    };
    const trAttrs = (el: Element) => {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const out = tr(v);
        if (out != null && out !== v) el.setAttribute(a, out);
      }
    };
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { trText(node as Text); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return;
      if ((el as HTMLElement).isContentEditable) return;
      trAttrs(el);
      for (const child of Array.from(node.childNodes)) walk(child);
    };

    const runAll = () => { applying = true; try { walk(root); } finally { applying = false; } };
    runAll();

    const obs = new MutationObserver((muts) => {
      if (applying) return;
      applying = true;
      try {
        for (const m of muts) {
          if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) trText(m.target as Text);
          else if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
          else if (m.type === 'attributes' && m.target.nodeType === Node.ELEMENT_NODE) trAttrs(m.target as Element);
        }
      } finally { applying = false; }
    });
    obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    obsRef.current = obs;
    // documento em inglês (ajuda leitores de tela)
    try { document.documentElement.lang = 'en'; } catch { /* ignore */ }

    return () => { obs.disconnect(); obsRef.current = null; };
  }, [lang]);

  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}
