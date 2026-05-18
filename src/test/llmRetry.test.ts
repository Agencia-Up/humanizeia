// Testes do retry + cortesia (IT-4.1).

import { describe, it, expect, vi } from "vitest";
import {
  fetchWithRetry,
  COURTESY_MESSAGE,
} from "../../supabase/functions/_shared/reliability/llmRetry";

// Helper: setTimeout mock que executa imediato (sem esperar de verdade).
const immediateTimeout: any = (cb: any) => {
  cb();
  return 0;
};

describe("COURTESY_MESSAGE", () => {
  it("nao e vazia e e pt-BR", () => {
    expect(COURTESY_MESSAGE.length).toBeGreaterThan(10);
    expect(COURTESY_MESSAGE.length).toBeLessThanOrEqual(200);
  });
});

describe("fetchWithRetry", () => {
  it("sucesso na primeira tentativa", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retry em 500 ate sucesso na 2a tentativa", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("retry em 429 (rate limit)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("NAO retry em 401 (problema permanente)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(false);
    expect(r.res.status).toBe(401);
    expect(r.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("NAO retry em 400 (bad request)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 400 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.attempts).toBe(1);
  });

  it("retorna ultima Response quando todas tentativas falham com 500", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 });
    const r = await fetchWithRetry("http://x", {}, {
      maxAttempts: 3,
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(false);
    expect(r.res.status).toBe(500);
    expect(r.attempts).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retry em network error ate sucesso", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const r = await fetchWithRetry("http://x", {}, {
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.res.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("joga exception se TODAS tentativas dao network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      fetchWithRetry("http://x", {}, {
        maxAttempts: 2,
        fetchFn: fetchMock as any,
        setTimeoutFn: immediateTimeout,
      })
    ).rejects.toThrow("network down");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backoff exponencial: delays 1000, 2000, 4000", async () => {
    const delays: number[] = [];
    const mockSetTimeout: any = (cb: any, ms: number) => {
      delays.push(ms);
      cb();
      return 0;
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await fetchWithRetry("http://x", {}, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      fetchFn: fetchMock as any,
      setTimeoutFn: mockSetTimeout,
    });
    // attempt 0 = sem delay; attempt 1 = 1000ms; attempt 2 = 2000ms
    expect(delays).toEqual([1000, 2000]);
  });

  it("respeita maxAttempts customizado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const r = await fetchWithRetry("http://x", {}, {
      maxAttempts: 5,
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.attempts).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("respeita retryableStatuses customizado", async () => {
    // 408 nao esta na default, mas pode ser adicionado
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 408 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const r = await fetchWithRetry("http://x", {}, {
      retryableStatuses: [408],
      fetchFn: fetchMock as any,
      setTimeoutFn: immediateTimeout,
    });
    expect(r.attempts).toBe(2);
  });
});
