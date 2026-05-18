// Smoke test do sistema de feature flags do agente Pedro SDR.
// Garante que o fail-safe (sem Deno = default false) funciona, e que
// a leitura de env var aceita as variantes documentadas.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isFeatureEnabled,
  listFeatureFlags,
  getEnabledFlags,
} from "../../supabase/functions/_shared/config/features";

const FLAG_COUNT = 13; // sincronizado com FeatureFlag union em features.ts

describe("pedro feature flags", () => {
  beforeEach(() => {
    delete (globalThis as any).Deno;
  });

  afterEach(() => {
    delete (globalThis as any).Deno;
  });

  it("retorna false quando Deno global nao existe (fail-safe Node/jsdom)", () => {
    expect(isFeatureEnabled("MESSAGE_SPLITTING")).toBe(false);
    expect(isFeatureEnabled("STRUCTURED_LOGGING")).toBe(false);
  });

  it("retorna false quando env var existe mas valor e undefined/vazio", () => {
    (globalThis as any).Deno = { env: { get: () => undefined } };
    expect(isFeatureEnabled("TYPING_SIMULATION")).toBe(false);

    (globalThis as any).Deno = { env: { get: () => "" } };
    expect(isFeatureEnabled("TYPING_SIMULATION")).toBe(false);
  });

  it("retorna true pra valor 'true' (sem ambiguidade)", () => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) =>
          k === "PEDRO_FF_MESSAGE_SPLITTING" ? "true" : undefined,
      },
    };
    expect(isFeatureEnabled("MESSAGE_SPLITTING")).toBe(true);
    expect(isFeatureEnabled("TYPING_SIMULATION")).toBe(false);
  });

  it("aceita variantes case-insensitive: TRUE, 1, yes, on, enabled", () => {
    for (const val of ["TRUE", "true", "1", "yes", "YES", "on", "ON", "enabled"]) {
      (globalThis as any).Deno = { env: { get: () => val } };
      expect(isFeatureEnabled("GUARDRAILS")).toBe(true);
    }
  });

  it("rejeita variantes nao reconhecidas como falso (false, 0, no, off, lixo)", () => {
    for (const val of ["false", "0", "no", "off", "disabled", "FALSE", "lixo", " "]) {
      (globalThis as any).Deno = { env: { get: () => val } };
      expect(isFeatureEnabled("LEAD_SCORING")).toBe(false);
    }
  });

  it("listFeatureFlags retorna objeto com 13 keys, todas booleanas", () => {
    (globalThis as any).Deno = { env: { get: () => undefined } };
    const all = listFeatureFlags();
    expect(Object.keys(all)).toHaveLength(FLAG_COUNT);
    Object.values(all).forEach((v) => expect(typeof v).toBe("boolean"));
  });

  it("getEnabledFlags filtra apenas as ligadas", () => {
    (globalThis as any).Deno = {
      env: {
        get: (k: string) =>
          k === "PEDRO_FF_LEAD_SCORING" || k === "PEDRO_FF_PERSONA_FEW_SHOTS"
            ? "true"
            : undefined,
      },
    };
    const enabled = getEnabledFlags();
    expect(enabled.sort()).toEqual(["LEAD_SCORING", "PERSONA_FEW_SHOTS"].sort());
  });

  it("nao quebra quando Deno.env.get joga excecao (fail-safe)", () => {
    (globalThis as any).Deno = {
      env: {
        get: () => {
          throw new Error("permission denied");
        },
      },
    };
    expect(isFeatureEnabled("OBJECTION_PLAYBOOKS")).toBe(false);
  });
});
