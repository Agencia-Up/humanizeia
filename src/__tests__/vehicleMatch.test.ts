import { describe, expect, it } from "vitest";
import {
  rankVehiclesV2,
  normVehText,
  tokenSim,
  NON_MODEL_WORDS,
  type MatchVehicle,
} from "../../supabase/functions/_shared/pedro-v2/vehicleMatch";

// Fixture baseado no inventário REAL da Icom (+ Mini Cooper / Uno / Kicks p/ os casos).
const STOCK: MatchVehicle[] = [
  { markName: "Peugeot", modelName: "207", versionName: "207 Hatch XR 1.4 8V (flex) 2p", year: 2011, km: 185418, saleValue: 22990, color: "Preto" },
  { markName: "Fiat", modelName: "Uno", versionName: "Uno Way 1.0", year: 2013, km: 90000, saleValue: 30000, color: "Branco" },
  { markName: "Ford", modelName: "EcoSport", versionName: "Ecosport Freestyle 1.6 16V (Flex)", year: 2017, km: 52463, saleValue: 64990, color: "Branco" },
  { markName: "Chevrolet", modelName: "Onix", versionName: "ONIX HATCH LT 1.0 12V FLEX 5P MEC.", year: 2022, km: 111000, saleValue: 66990, color: "Azul" },
  { markName: "Chevrolet", modelName: "Onix Sedan", versionName: "ONIX SEDAN PLUS LT 1.0 12V FLEX 4P MEC.", year: 2025, km: 46300, saleValue: 79990, color: "Branco" },
  { markName: "Hyundai", modelName: "Creta", versionName: "Creta Attitude 1.6 16V Flex", year: 2019, km: 80000, saleValue: 86990, color: "Preto" },
  { markName: "Hyundai", modelName: "Creta", versionName: "Creta Comfort 1.0 TGDI", year: 2025, km: 12000, saleValue: 130000, color: "Branco" },
  { markName: "Mini", modelName: "Cooper", versionName: "Cooper 1.5 Aut", year: 2019, km: 67000, saleValue: 135000, color: "Cinza" },
  { markName: "Nissan", modelName: "Frontier", versionName: "Frontier LE 4x4 2.5 16V (cab. dupla)", year: 2012, km: 148931, saleValue: 84990, color: "Preto" },
  { markName: "Nissan", modelName: "Kicks", versionName: "Kicks Exclusive 1.6", year: 2022, km: 104000, saleValue: 95000, color: "Branco" },
  { markName: "Volkswagen", modelName: "Polo", versionName: "Polo Track 1.0 Flex 12V 5P", year: 2025, km: 15200, saleValue: 79990, color: "Branco" },
];

const models = (r: ReturnType<typeof rankVehiclesV2>) => r.map((x) => normVehText(x.vehicle.modelName));
const top = (r: ReturnType<typeof rankVehiclesV2>) => normVehText(r[0]?.vehicle.modelName);

describe("vehicleMatch — busca por modelo exato", () => {
  it("'frontier' acha a Frontier no topo", () => {
    const r = rankVehiclesV2(STOCK, { query: "frontier" });
    expect(top(r)).toContain("frontier");
  });
  it("'creta' traz só as Cretas (2), nenhuma outra", () => {
    const r = rankVehiclesV2(STOCK, { query: "tem creta?" });
    expect(r.length).toBe(2);
    expect(r.every((x) => normVehText(x.vehicle.modelName).includes("creta"))).toBe(true);
  });
  it("'onix' traz os Onix, não o resto", () => {
    const r = rankVehiclesV2(STOCK, { query: "onix" });
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r.every((x) => normVehText(x.vehicle.modelName).includes("onix"))).toBe(true);
  });
});

describe("vehicleMatch — TYPOS resolvidos por similaridade (sem lista de alias)", () => {
  for (const typo of ["flontie", "frontie", "fronteir", "frontiet"]) {
    it(`'${typo}' (typo) ainda acha a Frontier`, () => {
      const r = rankVehiclesV2(STOCK, { query: typo });
      expect(top(r)).toContain("frontier");
    });
  }
  it("'unos' (typo de Uno) acha a Uno", () => {
    const r = rankVehiclesV2(STOCK, { query: "unos" });
    expect(models(r)).toContain("uno");
  });
  it("'unos.200.13' (formato sujo) ainda acha a Uno", () => {
    const r = rankVehiclesV2(STOCK, { query: "Olha.poderia.ser.unos.200.13" });
    expect(models(r)).toContain("uno");
  });
});

describe("vehicleMatch — PALAVRAS COMUNS nunca viram modelo (anti falso-positivo)", () => {
  it("'preta' (cor) NÃO casa Creta — vira busca ampla", () => {
    const r = rankVehiclesV2(STOCK, { query: "quero uma preta" });
    // sem modelo real -> busca ampla (todos), não só a Creta
    expect(r.length).toBe(STOCK.length);
  });
  it("'creta preta' acha as Cretas (cor é ignorada como modelo)", () => {
    const r = rankVehiclesV2(STOCK, { query: "creta preta" });
    expect(r.every((x) => normVehText(x.vehicle.modelName).includes("creta"))).toBe(true);
    expect(r.length).toBe(2);
  });
  it("'minha entrada de 15 mil' (pagamento) não vira modelo -> ampla", () => {
    const r = rankVehiclesV2(STOCK, { query: "minha entrada de 15 mil" });
    expect(r.length).toBe(STOCK.length);
  });
});

describe("vehicleMatch — marca vs modelo", () => {
  it("'nissan frontier' traz a Frontier, NÃO o Kicks", () => {
    const r = rankVehiclesV2(STOCK, { query: "nissan frontier" });
    expect(top(r)).toContain("frontier");
    expect(models(r)).not.toContain("kicks");
  });
  it("'mini cooper' acha o Mini Cooper", () => {
    const r = rankVehiclesV2(STOCK, { query: "mini cooper" });
    expect(top(r)).toContain("cooper");
  });
  it("'cooper' sozinho acha o Mini Cooper", () => {
    const r = rankVehiclesV2(STOCK, { query: "cooper" });
    expect(top(r)).toContain("cooper");
  });
});

describe("vehicleMatch — filtros numéricos / busca ampla", () => {
  it("sem modelo + preco_max=70000 -> só carros <= 70k", () => {
    const r = rankVehiclesV2(STOCK, { preco_max: 70000 });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => Number(x.vehicle.saleValue) <= 70000)).toBe(true);
  });
  it("sem nada (busca ampla) -> todos os carros com preço", () => {
    const r = rankVehiclesV2(STOCK, {});
    expect(r.length).toBe(STOCK.length);
  });
  it("ate 100k -> todos (todos < 100k aqui menos os 130k/135k)", () => {
    const r = rankVehiclesV2(STOCK, { preco_max: 100000 });
    expect(r.every((x) => Number(x.vehicle.saleValue) <= 100000)).toBe(true);
  });
});

describe("vehicleMatch — anúncio com preço divergente (relaxado)", () => {
  it("'frontier' + teto baixo (50k) volta a Frontier marcada relaxed", () => {
    const r = rankVehiclesV2(STOCK, { query: "frontier", preco_max: 50000 });
    expect(r.length).toBeGreaterThan(0);
    expect(top(r)).toContain("frontier");
    expect(r[0].relaxed).toBe(true);
  });
});

describe("vehicleMatch — propriedades", () => {
  it("toda COR é palavra não-modelo (nunca gera intenção de modelo)", () => {
    for (const cor of ["preto", "branco", "prata", "vermelho", "azul", "cinza"]) {
      expect(NON_MODEL_WORDS.has(cor)).toBe(true);
      const r = rankVehiclesV2(STOCK, { query: cor });
      expect(r.length).toBe(STOCK.length); // ampla, não filtra por "modelo cor"
    }
  });
  it("typo de 1 letra de um modelo real sempre casa (>= limiar)", () => {
    expect(tokenSim("frontier", "frontiet")).toBeGreaterThanOrEqual(0.72);
    expect(tokenSim("creta", "creto")).toBeGreaterThanOrEqual(0.72);
    expect(tokenSim("onix", "onyx")).toBeGreaterThanOrEqual(0.72);
  });
  it("número curto não casa por similaridade (200 != 207)", () => {
    expect(tokenSim("200", "207")).toBe(0);
  });
});
