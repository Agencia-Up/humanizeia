// Testes do fallback BNDV (IT-2.3).

import { describe, it, expect } from "vitest";
import {
  relaxBndvFilters,
  trySimilarVehiclesFallback,
} from "../../supabase/functions/_shared/qualification/bndvFallback";

describe("relaxBndvFilters", () => {
  it("filtros vazios retorna []", () => {
    expect(relaxBndvFilters({})).toEqual([]);
  });

  it("apenas marca/modelo retorna [] (nada pra relaxar)", () => {
    expect(relaxBndvFilters({ marca: "Honda", modelo: "Civic" })).toEqual([]);
  });

  it("filtros completos gera multiplas tentativas progressivas", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      versao: "Touring",
      combustivel: "flex",
      cambio: "automatico",
      cor: "preto",
      ano_min: 2023,
    });
    expect(attempts.length).toBeGreaterThan(1);
    // primeira tentativa remove APENAS a cor
    expect(attempts[0].filters.cor).toBeUndefined();
    expect(attempts[0].filters.cambio).toBe("automatico");
    expect(attempts[0].filters.versao).toBe("Touring");
    // ultima tentativa só mantém marca + modelo
    const last = attempts[attempts.length - 1];
    expect(last.filters.marca).toBe("Honda");
    expect(last.filters.modelo).toBe("Civic");
    expect(last.filters.cambio).toBeUndefined();
    expect(last.filters.cor).toBeUndefined();
    expect(last.filters.versao).toBeUndefined();
  });

  it("preserva marca e modelo em TODAS as tentativas", () => {
    const attempts = relaxBndvFilters({
      marca: "Fiat",
      modelo: "Strada",
      versao: "Freedom",
      cambio: "manual",
      cor: "vermelho",
    });
    attempts.forEach((a) => {
      expect(a.filters.marca).toBe("Fiat");
      expect(a.filters.modelo).toBe("Strada");
    });
  });

  it("level cresce monotonicamente (0/1 -> 5)", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      versao: "Touring",
      cambio: "auto",
      combustivel: "flex",
      cor: "preto",
    });
    for (let i = 1; i < attempts.length; i++) {
      expect(attempts[i].level).toBeGreaterThanOrEqual(attempts[i - 1].level);
    }
  });

  it("description e legivel pra cada tentativa", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      cor: "preto",
    });
    attempts.forEach((a) => {
      expect(a.description.length).toBeGreaterThan(5);
    });
    expect(attempts[0].description.toLowerCase()).toContain("cor");
  });

  it("dedupe nao deixa duas tentativas com mesmos filtros", () => {
    // sem cambio nem combustivel originalmente, niveis 2 e 3 viram iguais
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      cor: "preto",
      versao: "Touring",
    });
    const keys = attempts.map((a) =>
      JSON.stringify({
        v: a.filters.versao,
        c: a.filters.cambio,
        co: a.filters.combustivel,
        cor: a.filters.cor,
      })
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("apenas cor declarada -> dedupe colapsa em 1 tentativa (todas levam ao mesmo: marca+modelo)", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      cor: "preto",
    });
    // sem cambio/combustivel/versao/ano: nivel 1 (remove cor) == nivel 5
    // (marca+modelo) porque so havia cor pra remover. dedupe deixa 1.
    expect(attempts.length).toBe(1);
    expect(attempts[0].filters.cor).toBeUndefined();
  });

  it("cor + cambio declarados -> 2 tentativas distintas (remove cor, depois cor+cambio)", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      cor: "preto",
      cambio: "manual",
    });
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0].filters.cor).toBeUndefined();
    expect(attempts[0].filters.cambio).toBe("manual");
    expect(attempts[1].filters.cor).toBeUndefined();
    expect(attempts[1].filters.cambio).toBeUndefined();
  });

  it("apenas ano declarado -> tem fallback que remove ano", () => {
    const attempts = relaxBndvFilters({
      marca: "Honda",
      modelo: "Civic",
      ano_min: 2023,
    });
    // ano_min nao é removido nos primeiros niveis (cor/cambio/etc), mas
    // nivel 5 limpa tudo exceto marca+modelo
    const last = attempts[attempts.length - 1];
    expect(last.filters.ano_min).toBeUndefined();
  });
});

describe("trySimilarVehiclesFallback", () => {
  it("retorna null quando todas as tentativas retornam vazio", async () => {
    const result = await trySimilarVehiclesFallback(
      { marca: "Honda", modelo: "Civic", cor: "preto" },
      async () => []
    );
    expect(result).toBeNull();
  });

  it("retorna primeiro fallback que tiver items", async () => {
    let callCount = 0;
    const result = await trySimilarVehiclesFallback(
      { marca: "Honda", modelo: "Civic", cor: "preto", cambio: "manual" },
      async (filters) => {
        callCount++;
        // só retorna items na segunda tentativa
        if (callCount === 2) return [{ id: "veh1" }];
        return [];
      }
    );
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    expect(callCount).toBe(2);
  });

  it("para na primeira tentativa que retornar items (nao itera todas)", async () => {
    let callCount = 0;
    await trySimilarVehiclesFallback(
      { marca: "Honda", modelo: "Civic", cor: "preto", cambio: "manual" },
      async () => {
        callCount++;
        return [{ id: "x" }]; // sempre retorna 1
      }
    );
    expect(callCount).toBe(1); // parou na primeira
  });

  it("retorna null quando filtros nao tem nada relaxavel", async () => {
    const result = await trySimilarVehiclesFallback(
      { marca: "Honda", modelo: "Civic" },
      async () => [{ id: "x" }]
    );
    expect(result).toBeNull();
  });
});
