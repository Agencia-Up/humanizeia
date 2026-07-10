import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPedroStock } from "../../supabase/functions/_shared/pedro-v2/stockSearch_20260525_photo_flow";
import { resolvePedroVehicleTurn } from "../../supabase/functions/_shared/pedro-v2/vehicleResolver_20260525_brain";

function mockSupabaseWithBndvToken() {
  const makeChain = () => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      }),
      maybeSingle: vi.fn(async () => {
        if (filters.platform !== "bndv") return { data: null, error: null };
        return {
          data: {
            is_active: true,
            api_key_encrypted: JSON.stringify({ api_token: "test-token" }),
          },
          error: null,
        };
      }),
    };
    return chain;
  };

  return {
    from: vi.fn(() => makeChain()),
  };
}

describe("Pedro v2 stock safety", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not resolve color preta as Hyundai Creta when ad text has Peugeot 207", () => {
    const resolution = resolvePedroVehicleTurn({
      message: "Ola! Tenho interesse e queria mais informacoes, por favor.",
      enriched_message: [
        "Ola! Tenho interesse e queria mais informacoes, por favor.",
        "Veiculo do anuncio: Peugeot 207 XR 1.4 2011",
        "Contexto do anuncio: Peugeot 207 XR 1.4 2011, cor preta, preco R$22.950",
      ].join("\n"),
      ad_context: {
        has_ad_context: true,
        vehicle_query: "Peugeot 207 XR 1.4 2011",
        vehicle_type: "carro",
        confidence: 0.95,
      },
    });

    expect(resolution.query).toBe("Peugeot 207");
    expect(resolution.canonical_model).toBe("207");
    expect(resolution.all_matched_models).not.toContain("Hyundai Creta");
  });

  it("keeps the requested model when only preco_max from ad is below real stock price", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          vehiclesBy: [
            {
              markName: "Peugeot",
              modelName: "207",
              versionName: "207 Hatch XR 1.4 8V (flex) 2p",
              year: 2011,
              km: 185418,
              saleValue: 22990,
              color: "Preto",
              fuelName: "Flex",
              transmissionName: "Manual",
              pictureJs: "[]",
            },
          ],
        },
      }),
    })));

    const result = await searchPedroStock(mockSupabaseWithBndvToken(), {
      user_id: "user-1",
      query: "Peugeot 207 XR 1.4",
      filters: {
        query: "Peugeot 207 XR 1.4",
        modelo_desejado: "Peugeot 207 XR 1.4",
        tipo_veiculo: "hatch",
        preco_max: 22950,
      },
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
    expect(result.items[0]?.modelo).toBe("207");
    expect(result.items[0]?.preco).toBe(22990);
    expect(result.items[0]?.relaxed_match).toBe(true);
  });

  it("does not resolve down payment text as Fiat Strada", () => {
    const resolution = resolvePedroVehicleTurn({
      message: "Vou da 7 mil de entrada no financiamento",
    });

    expect(resolution.query).not.toBe("Fiat Strada");
    expect(resolution.all_matched_models).not.toContain("Fiat Strada");
  });

  it("does not create a fake Nissan Tambem model", () => {
    const resolution = resolvePedroVehicleTurn({
      message: "Nissan tambem me interessa",
    });

    expect(resolution.query).not.toBe("Nissan Tambem");
    expect(resolution.all_matched_models).not.toContain("Nissan Tambem");
  });

  it("resolves a misspelled Frontier question", () => {
    const resolution = resolvePedroVehicleTurn({
      message: "Qual ano da flontie e valor e disel",
    });

    expect(resolution.query).toBe("Nissan Frontier");
    expect(resolution.vehicle_type).toBe("pickup");
  });

  it("keeps Mini Cooper above unrelated Onix in stock search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          vehiclesBy: [
            {
              markName: "Chevrolet",
              modelName: "Onix",
              versionName: "Onix LT 1.0 Flex",
              year: 2023,
              km: 25000,
              saleValue: 76990,
              color: "Prata",
              fuelName: "Flex",
              transmissionName: "Manual",
              pictureJs: "[]",
            },
            {
              markName: "Mini",
              modelName: "Cooper",
              versionName: "Cooper 1.5 Turbo",
              year: 2019,
              km: 67000,
              saleValue: 108990,
              color: "Branco",
              fuelName: "Gasolina",
              transmissionName: "Automatico",
              pictureJs: "[]",
            },
          ],
        },
      }),
    })));

    const result = await searchPedroStock(mockSupabaseWithBndvToken(), {
      user_id: "user-1",
      query: "Mini Cooper 2019 1.5",
      filters: {
        query: "Mini Cooper 2019 1.5",
        modelo_desejado: "Mini Cooper",
      },
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
    expect(result.items[0]?.marca).toBe("Mini");
    expect(result.items[0]?.modelo).toBe("Cooper");
  });

  it("finds Frontier even when the lead types flontie and disel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          vehiclesBy: [
            {
              markName: "Nissan",
              modelName: "Frontier",
              versionName: "Frontier 2.5 SE 4x4 Diesel",
              year: 2012,
              km: 140000,
              saleValue: 84990,
              color: "Preto",
              fuelName: "Diesel",
              transmissionName: "Manual",
              pictureJs: "[]",
            },
            {
              markName: "Volkswagen",
              modelName: "Virtus",
              versionName: "Comfortline 200 TSI",
              year: 2021,
              km: 92375,
              saleValue: 82990,
              color: "Branco",
              fuelName: "Flex",
              transmissionName: "Automatico",
              pictureJs: "[]",
            },
          ],
        },
      }),
    })));

    const result = await searchPedroStock(mockSupabaseWithBndvToken(), {
      user_id: "user-1",
      query: "flontie disel",
      filters: {
        query: "flontie disel",
        modelo_desejado: "flontie",
        combustivel: "disel",
      },
    });

    expect(result.success).toBe(true);
    expect(result.total).toBe(1);
    expect(result.items[0]?.marca).toBe("Nissan");
    expect(result.items[0]?.modelo).toBe("Frontier");
  });
});
