// Testes do summarizer de historico (IT-3.2).

import { describe, it, expect, vi } from "vitest";
import {
  splitForSummarization,
  buildSummarizationPrompt,
  formatSummaryAsSystemMessage,
  summarizeOldMessages,
  type ChatMessage,
} from "../../supabase/functions/_shared/memory/historySummarizer";

function mkHistory(n: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    });
  }
  return out;
}

describe("splitForSummarization", () => {
  it("array vazio retorna [[],[]]", () => {
    const r = splitForSummarization([], 10);
    expect(r.oldMessages).toEqual([]);
    expect(r.recentMessages).toEqual([]);
  });

  it("history menor que keepRecent: tudo vai pra recentes", () => {
    const h = mkHistory(5);
    const r = splitForSummarization(h, 10);
    expect(r.oldMessages).toEqual([]);
    expect(r.recentMessages).toHaveLength(5);
  });

  it("history igual a keepRecent: tudo recente, nada velho", () => {
    const h = mkHistory(10);
    const r = splitForSummarization(h, 10);
    expect(r.oldMessages).toEqual([]);
    expect(r.recentMessages).toHaveLength(10);
  });

  it("history maior que keepRecent: split correto", () => {
    const h = mkHistory(30);
    const r = splitForSummarization(h, 10);
    expect(r.oldMessages).toHaveLength(20);
    expect(r.recentMessages).toHaveLength(10);
    // oldMessages sao as 20 primeiras, recentMessages sao as 10 ultimas
    expect((r.oldMessages[0].content as string)).toBe("msg 0");
    expect((r.oldMessages[19].content as string)).toBe("msg 19");
    expect((r.recentMessages[0].content as string)).toBe("msg 20");
    expect((r.recentMessages[9].content as string)).toBe("msg 29");
  });

  it("keepRecent default = 10", () => {
    const r = splitForSummarization(mkHistory(15));
    expect(r.recentMessages).toHaveLength(10);
    expect(r.oldMessages).toHaveLength(5);
  });

  it("input nao-array retorna [[],[]]", () => {
    const r = splitForSummarization(null as any, 10);
    expect(r.oldMessages).toEqual([]);
    expect(r.recentMessages).toEqual([]);
  });
});

describe("buildSummarizationPrompt", () => {
  it("retorna systemPrompt nao-vazio com instrucoes claras", () => {
    const { systemPrompt } = buildSummarizationPrompt(mkHistory(5));
    expect(systemPrompt.length).toBeGreaterThan(100);
    expect(systemPrompt.toLowerCase()).toContain("sumariz");
    expect(systemPrompt.toLowerCase()).toContain("8 bullets");
    expect(systemPrompt.toLowerCase()).toContain("modelo de interesse");
  });

  it("transcript usa 'Cliente:' e 'Pedro:' pros 2 roles", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá, sou o Pedro" },
    ];
    const { userMessage } = buildSummarizationPrompt(messages);
    expect(userMessage).toContain("Cliente: Oi");
    expect(userMessage).toContain("Pedro: Olá, sou o Pedro");
  });

  it("inclui count de mensagens no userMessage", () => {
    const { userMessage } = buildSummarizationPrompt(mkHistory(20));
    expect(userMessage).toContain("20 mensagens");
  });

  it("content nao-string vira JSON.stringify", () => {
    const { userMessage } = buildSummarizationPrompt([
      { role: "user", content: [{ type: "text", text: "Oi" }] as any },
    ]);
    expect(userMessage).toContain("type");
  });
});

describe("formatSummaryAsSystemMessage", () => {
  it("retorna ChatMessage role='system'", () => {
    const msg = formatSummaryAsSystemMessage("- Cliente quer Onix\n- À vista", 15);
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("RESUMO DAS 15 MENSAGENS ANTERIORES");
    expect(msg.content).toContain("Cliente quer Onix");
    expect(msg.content).toContain("À vista");
    expect(msg.content).toContain("⚠️");
  });
});

describe("summarizeOldMessages", () => {
  it("retorna '' quando oldMessages vazio", async () => {
    const r = await summarizeOldMessages([], "fake-key");
    expect(r).toBe("");
  });

  it("retorna '' quando apiKey vazio", async () => {
    const r = await summarizeOldMessages(mkHistory(5), "");
    expect(r).toBe("");
  });

  it("retorna texto do primeiro modelo OK", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ text: "  - Cliente quer Onix\n  - À vista  " }],
      }),
    });
    const r = await summarizeOldMessages(
      mkHistory(15),
      "key",
      ["model-1"],
      fetchMock as any
    );
    expect(r).toBe("- Cliente quer Onix\n  - À vista");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("faz cascade pra proximo modelo quando primeiro retorna 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "model not found" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ text: "Resumo OK" }] }),
      });
    const r = await summarizeOldMessages(
      mkHistory(15),
      "key",
      ["model-1", "model-2"],
      fetchMock as any
    );
    expect(r).toBe("Resumo OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retorna '' quando todos os modelos falham", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "model" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "internal" });
    const r = await summarizeOldMessages(
      mkHistory(15),
      "key",
      ["model-1", "model-2"],
      fetchMock as any
    );
    expect(r).toBe("");
  });

  it("retorna '' quando todos os fetch jogam excecao", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    const r = await summarizeOldMessages(
      mkHistory(15),
      "key",
      ["model-1", "model-2"],
      fetchMock as any
    );
    expect(r).toBe("");
  });

  it("envia x-api-key + anthropic-version no header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ text: "ok" }] }),
    });
    await summarizeOldMessages(
      mkHistory(5),
      "MY_KEY_123",
      ["model-1"],
      fetchMock as any
    );
    const callArgs = fetchMock.mock.calls[0][1];
    expect(callArgs.headers["x-api-key"]).toBe("MY_KEY_123");
    expect(callArgs.headers["anthropic-version"]).toBeDefined();
  });
});
