// Testes do typing simulator (IT-1.2 humanização Pedro SDR).

import { describe, it, expect, vi } from "vitest";
import {
  calculateTypingDelayMs,
  sendTypingPresence,
} from "../../supabase/functions/_shared/humanization/typingSimulator";

describe("calculateTypingDelayMs", () => {
  it("texto vazio retorna minMs (800ms default)", () => {
    expect(calculateTypingDelayMs("")).toBe(800);
    expect(calculateTypingDelayMs("", { minMs: 500 })).toBe(500);
  });

  it("texto pequeno e clampado pra minMs", () => {
    // 5 chars / 18 cps = 277ms < 800ms -> clamp a 800ms
    const d = calculateTypingDelayMs("Oi tu", { randomFn: () => 0 });
    expect(d).toBe(800);
  });

  it("texto muito longo e clampado pra maxMs", () => {
    // 1000 chars / 18 cps = 55555ms > 4000ms -> clamp a 4000ms
    const longText = "x".repeat(1000);
    const d = calculateTypingDelayMs(longText, { randomFn: () => 0 });
    expect(d).toBe(4000);
  });

  it("texto medio fica entre min e max", () => {
    // 100 chars / 18 cps = 5555ms... espera, isso passa do max
    // 50 chars / 18 cps = 2777ms -> ok
    const text = "x".repeat(50);
    const d = calculateTypingDelayMs(text, { randomFn: () => 0 });
    expect(d).toBeGreaterThanOrEqual(800);
    expect(d).toBeLessThanOrEqual(4000);
    expect(d).toBeCloseTo(2777, -2); // tolerancia 100ms
  });

  it("respeita randomFn injetada (determinismo de teste)", () => {
    const text = "x".repeat(30);
    // randomFn=0 -> cps=18 (min) -> ms = 30/18*1000 = 1666
    const a = calculateTypingDelayMs(text, { randomFn: () => 0 });
    // randomFn=1 -> cps=28 (max) -> ms = 30/28*1000 = 1071
    const b = calculateTypingDelayMs(text, { randomFn: () => 1 });
    expect(a).toBeGreaterThan(b);
    expect(a).toBeCloseTo(1666, -1);
    expect(b).toBeCloseTo(1071, -1);
  });

  it("respeita parametros customizados de cps", () => {
    const text = "x".repeat(20);
    // baseCps=10, jitter=0, randomFn=0 -> cps=10 -> 2000ms
    const d = calculateTypingDelayMs(text, {
      baseCps: 10,
      jitterCps: 0,
      randomFn: () => 0,
    });
    expect(d).toBe(2000);
  });

  it("respeita min/max customizados", () => {
    expect(
      calculateTypingDelayMs("", { minMs: 100, maxMs: 200 })
    ).toBe(100);
    expect(
      calculateTypingDelayMs("x".repeat(1000), {
        minMs: 100,
        maxMs: 200,
        randomFn: () => 0,
      })
    ).toBe(200);
  });
});

describe("sendTypingPresence", () => {
  it("retorna true quando primeiro endpoint responde 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true });
    const ok = await sendTypingPresence(
      "https://api.example.com",
      "tok123",
      "5511999999999",
      "composing",
      fetchMock as any
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/message/presence",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          number: "5511999999999",
          presence: "composing",
        }),
      })
    );
  });

  it("faz fallback pro segundo endpoint quando primeiro falha", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const ok = await sendTypingPresence(
      "https://api.example.com",
      "tok123",
      "5511",
      "paused",
      fetchMock as any
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.example.com/chat/presence",
      expect.anything()
    );
  });

  it("retorna false silenciosamente quando ambos endpoints falham", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false });
    const ok = await sendTypingPresence(
      "https://api.example.com",
      "tok",
      "5511",
      "composing",
      fetchMock as any
    );
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("nao joga excecao quando fetch quebra (best-effort)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"));
    await expect(
      sendTypingPresence(
        "https://api.example.com",
        "tok",
        "5511",
        "composing",
        fetchMock as any
      )
    ).resolves.toBe(false);
  });

  it("envia token no header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true });
    await sendTypingPresence(
      "https://api.example.com",
      "MEU_TOKEN_SECRET",
      "5511",
      "composing",
      fetchMock as any
    );
    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.headers).toEqual({
      "Content-Type": "application/json",
      token: "MEU_TOKEN_SECRET",
    });
  });
});
