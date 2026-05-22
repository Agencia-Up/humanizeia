// Testes da normalização + validação de input para campos dinâmicos (Fase 6.3).

import { describe, it, expect } from "vitest";
import {
  normalizeForDedup,
  toDisplayName,
  validateNameInput,
} from "../services/dynamicFields/normalize";

describe("normalizeForDedup", () => {
  it("vazio retorna vazio", () => {
    expect(normalizeForDedup("")).toBe("");
    expect(normalizeForDedup(null as any)).toBe("");
    expect(normalizeForDedup(undefined as any)).toBe("");
  });

  it("lowercase + sem acento", () => {
    expect(normalizeForDedup("São José dos Campos")).toBe("sao jose dos campos");
    expect(normalizeForDedup("UBATUBA")).toBe("ubatuba");
    expect(normalizeForDedup("Pindamonhangaba")).toBe("pindamonhangaba");
  });

  it("colapsa espaços duplos e trim", () => {
    expect(normalizeForDedup("  Rio   de    Janeiro  ")).toBe("rio de janeiro");
  });

  it("duplicados detectados via normalized", () => {
    expect(normalizeForDedup("sao paulo")).toBe(normalizeForDedup("SÃO PAULO"));
    expect(normalizeForDedup("são paulo")).toBe(normalizeForDedup("Sao Paulo"));
  });
});

describe("toDisplayName", () => {
  it("Title Case básico", () => {
    expect(toDisplayName("ubatuba")).toBe("Ubatuba");
    expect(toDisplayName("TAUBATÉ")).toBe("Taubaté");
  });

  it("preposições PT-BR ficam minúsculas (exceto primeira palavra)", () => {
    expect(toDisplayName("são josé dos campos")).toBe("São José dos Campos");
    expect(toDisplayName("RIO DE JANEIRO")).toBe("Rio de Janeiro");
    expect(toDisplayName("santo antônio do pinhal")).toBe("Santo Antônio do Pinhal");
    expect(toDisplayName("ribeirão das neves")).toBe("Ribeirão das Neves");
  });

  it("primeira palavra sempre maiúscula mesmo se for preposição", () => {
    expect(toDisplayName("de bem com a vida")).toBe("De Bem com a Vida");
  });

  it("hífen mantido sem virar 'Santa-cruz'", () => {
    expect(toDisplayName("santa-cruz")).toBe("Santa-Cruz");
  });

  it("apóstrofe (D'Ávila)", () => {
    expect(toDisplayName("d'ávila")).toBe("D'Ávila");
  });

  it("vazio e whitespace", () => {
    expect(toDisplayName("")).toBe("");
    expect(toDisplayName("   ")).toBe("");
    expect(toDisplayName("\n  \t")).toBe("");
  });

  it("espaços duplos colapsam", () => {
    expect(toDisplayName(" são    josé   dos campos ")).toBe("São José dos Campos");
  });
});

describe("validateNameInput", () => {
  it("aceita nomes válidos sem erros", () => {
    expect(validateNameInput("Ubatuba")).toEqual([]);
    expect(validateNameInput("São José dos Campos")).toEqual([]);
    expect(validateNameInput("D'Ávila")).toEqual([]);
    expect(validateNameInput("Santa-Cruz")).toEqual([]);
  });

  it("rejeita curto demais", () => {
    expect(validateNameInput("X")).toContain("Mínimo 2 caracteres");
    expect(validateNameInput("")).toContain("Mínimo 2 caracteres");
  });

  it("rejeita longo demais", () => {
    expect(validateNameInput("x".repeat(101))).toContain("Máximo 100 caracteres");
  });

  it("rejeita números por default (cidades)", () => {
    expect(validateNameInput("Cidade123")).toContain("Não pode conter números");
    expect(validateNameInput("12345")).toContain("Não pode conter números");
  });

  it("aceita números com allowNumbers (origens)", () => {
    expect(validateNameInput("Facebook Ads 2025", { allowNumbers: true })).toEqual([]);
    expect(validateNameInput("Campanha Q4", { allowNumbers: true })).toEqual([]);
  });

  it("rejeita caracteres especiais malucos", () => {
    const errors = validateNameInput("Xyz#$%");
    expect(errors.some((e) => e.includes("Caracteres especiais"))).toBe(true);
  });

  it("aceita parenteses, ponto, hifen, apostrofe", () => {
    expect(validateNameInput("Porta (loja)")).toEqual([]);
    expect(validateNameInput("J. C. Penney", { allowNumbers: true })).toEqual([]);
  });
});
