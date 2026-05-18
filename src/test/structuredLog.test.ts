// Testes dos logs estruturados (IT-4.3).

import { describe, it, expect, vi } from "vitest";
import {
  newTraceId,
  slog,
  makeTurnLogger,
} from "../../supabase/functions/_shared/observability/structuredLog";

describe("newTraceId", () => {
  it("retorna string nao-vazia", () => {
    const id = newTraceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("tem 8 chars hex", () => {
    const id = newTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("gera ids diferentes em chamadas consecutivas", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(newTraceId());
    expect(ids.size).toBeGreaterThan(95); // colisões muito raras
  });
});

describe("slog", () => {
  it("serializa em JSON valido com ts/level/event", () => {
    const captured: string[] = [];
    slog("info", "test_event", { foo: "bar" }, (s) => captured.push(s));
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("test_event");
    expect(parsed.foo).toBe("bar");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("inclui trace_id quando passado", () => {
    const captured: string[] = [];
    slog(
      "info",
      "turn_start",
      { trace_id: "abc12345", lead_phone: "5511" },
      (s) => captured.push(s)
    );
    const parsed = JSON.parse(captured[0]);
    expect(parsed.trace_id).toBe("abc12345");
    expect(parsed.lead_phone).toBe("5511");
  });

  it("fields vazio funciona", () => {
    const captured: string[] = [];
    slog("info", "noop", {}, (s) => captured.push(s));
    const parsed = JSON.parse(captured[0]);
    expect(parsed.event).toBe("noop");
  });

  it("nivel error/warn/debug todos serializam", () => {
    const captured: string[] = [];
    slog("error", "e", {}, (s) => captured.push(s));
    slog("warn", "w", {}, (s) => captured.push(s));
    slog("debug", "d", {}, (s) => captured.push(s));
    expect(captured).toHaveLength(3);
    expect(JSON.parse(captured[0]).level).toBe("error");
    expect(JSON.parse(captured[1]).level).toBe("warn");
    expect(JSON.parse(captured[2]).level).toBe("debug");
  });

  it("circular reference nao quebra (fallback)", () => {
    const captured: string[] = [];
    const circular: any = { a: 1 };
    circular.self = circular;
    slog("info", "circ", { obj: circular }, (s) => captured.push(s));
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]);
    expect(parsed._serialization_error).toBe(true);
    expect(parsed.event).toBe("circ");
  });

  it("usa console nativo quando consoleFn nao passado", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    slog("info", "default_route", { x: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(typeof arg).toBe("string");
    const parsed = JSON.parse(arg);
    expect(parsed.event).toBe("default_route");
    spy.mockRestore();
  });
});

describe("makeTurnLogger", () => {
  it("retorna funcao que prefixa trace_id em todas chamadas", () => {
    const captured: string[] = [];
    const consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation((s) => captured.push(s as string));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((s) => captured.push(s as string));

    const log = makeTurnLogger("xyz98765");
    log("info", "ev1", { foo: 1 });
    log("warn", "ev2", { bar: 2 });

    expect(captured).toHaveLength(2);
    expect(JSON.parse(captured[0]).trace_id).toBe("xyz98765");
    expect(JSON.parse(captured[1]).trace_id).toBe("xyz98765");
    expect(JSON.parse(captured[0]).foo).toBe(1);
    expect(JSON.parse(captured[1]).bar).toBe(2);

    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("baseFields aplica em todas chamadas (lead_id, agent_id)", () => {
    const captured: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((s) => captured.push(s as string));

    const log = makeTurnLogger("trc", { lead_id: "lead-1", agent_id: "agent-x" });
    log("info", "ev1");
    log("info", "ev2");

    const p1 = JSON.parse(captured[0]);
    const p2 = JSON.parse(captured[1]);
    expect(p1.lead_id).toBe("lead-1");
    expect(p1.agent_id).toBe("agent-x");
    expect(p2.lead_id).toBe("lead-1");

    spy.mockRestore();
  });

  it("fields do call override baseFields", () => {
    const captured: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((s) => captured.push(s as string));

    const log = makeTurnLogger("trc", { custom: "base_value" });
    log("info", "override_test", { custom: "call_value" });

    const parsed = JSON.parse(captured[0]);
    expect(parsed.custom).toBe("call_value");

    spy.mockRestore();
  });
});
