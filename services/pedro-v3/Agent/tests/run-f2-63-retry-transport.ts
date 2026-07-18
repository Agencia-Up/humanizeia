// run-f2-63-retry-transport.ts — FASE 4 (Retry/backoff real no runtime)
//
// Prova determinística do RetryingModelHttpTransport SEM rede real e SEM espera real:
//  - inner transport com sequência roteirizada de respostas/erros;
//  - sleep injetado que só REGISTRA a duração (nunca dorme de verdade).
// Invariantes cobertos:
//  - 2xx e 4xx≠429 NÃO re-tentam (resposta válida / erro do cliente não vira retry-storm);
//  - 429 e 5xx re-tentam até o teto e devolvem o sucesso quando ele chega;
//  - erro de rede/transporte re-tenta; se persistir, propaga o erro após o teto;
//  - abort do chamador (timeout do modelo) NÃO gasta tentativas — passa direto uma vez;
//  - Retry-After (retryAfterMs) é honrado; sem ele, backoff exponencial crescente;
//  - teto default de 2 retries => no máx. 3 chamadas ao inner.

import {
  RetryingModelHttpTransport,
} from "../src/runtime/fetch-transports.ts";
import type {
  ModelHttpRequest,
  ModelHttpResponse,
  ModelHttpTransport,
} from "../src/adapters/llm/structured-json-model.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}${detail ? `: ${detail}` : ""}`); }
}

type Scripted =
  | { kind: "response"; response: ModelHttpResponse }
  | { kind: "throw"; error: unknown };

function resp(status: number, retryAfterMs?: number): Scripted {
  return {
    kind: "response",
    response: { status, contentType: "application/json", bodyText: "{}", retryAfterMs },
  };
}

class ScriptedInner implements ModelHttpTransport {
  calls = 0;
  constructor(private readonly script: Scripted[]) {}
  async postJson(_url: string, _request: ModelHttpRequest): Promise<ModelHttpResponse> {
    const step = this.script[this.calls] ?? this.script[this.script.length - 1];
    this.calls += 1;
    if (step.kind === "throw") throw step.error;
    return step.response;
  }
}

function request(signal: AbortSignal): ModelHttpRequest {
  return { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal };
}

function recordingSleep() {
  const waits: number[] = [];
  const sleep = (ms: number, _signal: AbortSignal): Promise<void> => { waits.push(ms); return Promise.resolve(); };
  return { waits, sleep };
}

async function main(): Promise<void> {
  console.log("F2.63 retry/backoff transport (Fase 4):");

  // A) 2xx não re-tenta.
  {
    const inner = new ScriptedInner([resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("A: 2xx faz 1 chamada e não dorme", inner.calls === 1 && waits.length === 0 && out.status === 200, `calls=${inner.calls} waits=${waits.length}`);
  }

  // B) 4xx≠429 (400) não re-tenta.
  {
    const inner = new ScriptedInner([resp(400)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("B: 400 não re-tenta (erro do cliente)", inner.calls === 1 && waits.length === 0 && out.status === 400, `calls=${inner.calls}`);
  }

  // C) 429 transitório -> sucesso na 2ª -> devolve 200.
  {
    const inner = new ScriptedInner([resp(429), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, baseDelayMs: 500 });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("C: 429 depois 200 => 2 chamadas, 1 sleep, resultado 200", inner.calls === 2 && waits.length === 1 && out.status === 200, `calls=${inner.calls} waits=${JSON.stringify(waits)}`);
  }

  // D) Retry-After honrado (usa o valor sugerido, não o backoff).
  {
    const inner = new ScriptedInner([resp(429, 2_000), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, baseDelayMs: 500, maxDelayMs: 8_000 });
    await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("D: Retry-After (2000ms) é honrado no lugar do backoff", waits.length === 1 && waits[0] === 2_000, `waits=${JSON.stringify(waits)}`);
  }

  // E) 5xx persistente -> esgota teto (2 retries = 3 chamadas) -> devolve o último 5xx.
  {
    const inner = new ScriptedInner([resp(503), resp(503), resp(503), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, maxRetries: 2, baseDelayMs: 400, maxDelayMs: 8_000 });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("E: 5xx persistente esgota teto (3 chamadas) e devolve 503", inner.calls === 3 && waits.length === 2 && out.status === 503, `calls=${inner.calls} status=${out.status}`);
    check("E: backoff exponencial cresce (wait[1] > wait[0])", waits[1] > waits[0], `waits=${JSON.stringify(waits)}`);
  }

  // F) Erro de rede persistente -> re-tenta e, esgotado o teto, PROPAGA o erro.
  {
    const netErr = new TypeError("fetch failed");
    const inner = new ScriptedInner([{ kind: "throw", error: netErr }]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, maxRetries: 2 });
    let thrown: unknown = null;
    try { await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal)); }
    catch (e) { thrown = e; }
    check("F: erro de rede persistente propaga após o teto", thrown === netErr && inner.calls === 3 && waits.length === 2, `calls=${inner.calls} err=${String(thrown)}`);
  }

  // G) Erro de rede transitório -> sucesso na 2ª chamada.
  {
    const inner = new ScriptedInner([{ kind: "throw", error: new TypeError("fetch failed") }, resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("G: erro de rede transitório recupera na 2ª", inner.calls === 2 && out.status === 200 && waits.length === 1, `calls=${inner.calls}`);
  }

  // H) Abort do chamador (timeout do modelo) NÃO gasta tentativas: passa direto uma vez.
  {
    const controller = new AbortController();
    controller.abort();
    const inner = new ScriptedInner([resp(429), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep });
    const out = await t.postJson("https://api.openai.com/v1/x", request(controller.signal));
    check("H: signal já abortado => 1 chamada, 0 sleep (sem retry)", inner.calls === 1 && waits.length === 0 && out.status === 429, `calls=${inner.calls} waits=${waits.length}`);
  }

  // I) maxRetries=0 desliga o retry (1 chamada mesmo em 429).
  {
    const inner = new ScriptedInner([resp(429), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, maxRetries: 0 });
    const out = await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("I: maxRetries=0 => sem retry (1 chamada)", inner.calls === 1 && waits.length === 0 && out.status === 429, `calls=${inner.calls}`);
  }

  // J) waitMs nunca ultrapassa maxDelayMs (mesmo com Retry-After absurdo já é limitado a 30s pelo parser; aqui o cap local).
  {
    const inner = new ScriptedInner([resp(503, 25_000), resp(200)]);
    const { waits, sleep } = recordingSleep();
    const t = new RetryingModelHttpTransport(inner, { sleep, maxDelayMs: 8_000 });
    await t.postJson("https://api.openai.com/v1/x", request(new AbortController().signal));
    check("J: Retry-After grande é limitado a maxDelayMs", waits.length === 1 && waits[0] === 8_000, `waits=${JSON.stringify(waits)}`);
  }

  if (failed > 0) {
    console.error(`=== F2.63 RETRY TRANSPORT: ${ok} OK | ${failed} FALHA ===`);
    process.exit(1);
  }
  console.log(`=== F2.63 RETRY TRANSPORT: ${ok} OK | 0 FALHA ===`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
