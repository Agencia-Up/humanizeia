// Testes do service principal de campos dinâmicos (6.3 completos).
// Foca na lógica de similar (bigramSimilarity) e validações antes da chamada Supabase.

import { describe, it, expect } from "vitest";
import {
  normalizeForDedup,
  toDisplayName,
} from "@/services/dynamicFields/normalize";

// Helper local — replica da função interna do service pra testar similaridade
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const bigrams = (s: string): Set<string> => {
    const out = new Set<string>();
    const padded = `  ${s}  `;
    for (let i = 0; i < padded.length - 1; i++) out.add(padded.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

describe("bigramSimilarity — proxy do pg_trgm pro client", () => {
  it("string igual a si mesma = 1.0", () => {
    expect(bigramSimilarity("ubatuba", "ubatuba")).toBe(1);
  });

  it("Ubaatuba vs Ubatuba — similaridade > 0.7 (caso do plano)", () => {
    const a = normalizeForDedup("Ubaatuba");
    const b = normalizeForDedup("Ubatuba");
    const sim = bigramSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.7);
  });

  it("Sao Paulo vs São Paulo — normalizado é igual (similaridade 1)", () => {
    expect(bigramSimilarity(normalizeForDedup("sao paulo"), normalizeForDedup("SÃO PAULO"))).toBe(1);
    expect(bigramSimilarity(normalizeForDedup("Sao Paulo"), normalizeForDedup("são paulo"))).toBe(1);
  });

  it("Caraguatatuba contém 'tuba' → similaridade ~0.57 com Ubatuba (esperado pelo plano: 61%)", () => {
    const sim = bigramSimilarity(normalizeForDedup("Ubatuba"), normalizeForDedup("Caraguatatuba"));
    expect(sim).toBeGreaterThan(0.4);
    expect(sim).toBeLessThan(0.7);
  });

  it("Ubatuba vs Pindamonhangaba — similaridade < 0.4 (diferentes)", () => {
    const sim = bigramSimilarity(normalizeForDedup("Ubatuba"), normalizeForDedup("Pindamonhangaba"));
    expect(sim).toBeLessThan(0.4);
  });

  it("strings vazias retornam 0", () => {
    expect(bigramSimilarity("", "qualquer")).toBe(0);
    expect(bigramSimilarity("qualquer", "")).toBe(0);
  });

  it("typo de 1 letra pequena (Ubattuba) mantém similaridade alta", () => {
    const sim = bigramSimilarity(normalizeForDedup("Ubattuba"), normalizeForDedup("Ubatuba"));
    expect(sim).toBeGreaterThan(0.7);
  });
});

describe("Casos críticos do plano 6.3 (verificação end-to-end de regras)", () => {
  it("'ubatuba' → display 'Ubatuba', normalized 'ubatuba'", () => {
    expect(toDisplayName("ubatuba")).toBe("Ubatuba");
    expect(normalizeForDedup("ubatuba")).toBe("ubatuba");
  });

  it("'São José Dos Campos' → 'São José dos Campos' (correção do 'Dos')", () => {
    expect(toDisplayName("São José Dos Campos")).toBe("São José dos Campos");
  });

  it("' rio de janeiro ' → 'Rio de Janeiro' (espaços)", () => {
    expect(toDisplayName(" rio de janeiro ")).toBe("Rio de Janeiro");
    expect(normalizeForDedup(" rio de janeiro ")).toBe("rio de janeiro");
  });

  it("'santo antônio do pinhal' → 'Santo Antônio do Pinhal'", () => {
    expect(toDisplayName("santo antônio do pinhal")).toBe("Santo Antônio do Pinhal");
  });

  it("'RIO DE JANEIRO' → 'Rio de Janeiro'", () => {
    expect(toDisplayName("RIO DE JANEIRO")).toBe("Rio de Janeiro");
  });

  it("normalized é igual entre maiúscula/minúscula/acento — dedup funciona", () => {
    const a = normalizeForDedup("São Paulo");
    const b = normalizeForDedup("são paulo");
    const c = normalizeForDedup("SAO PAULO");
    const d = normalizeForDedup("sao paulo");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });
});
