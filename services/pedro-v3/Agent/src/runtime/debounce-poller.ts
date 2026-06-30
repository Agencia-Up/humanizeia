// ============================================================================
// debounce-poller.ts — F2.7.6. Laço de fundo do serviço v3: a cada tick pergunta
// quais conversas "assentaram" (debounce) e processa cada uma (claim do bloco ->
// decide -> dispatch). Robusto/recuperavel: estado vive no Postgres (v3_inbox +
// v3_conversation_routing); se o processo reinicia, as pendentes seguem la e o
// poller retoma. Sem Redis, sem setTimeout fragil por mensagem.
//
// runOnce() e a unidade testavel (finder + processor injetados). start() so faz a
// fiação do setInterval com guarda anti-sobreposicao.
// ============================================================================
import type { Clock, SettledConversation } from "../domain/ports.ts";

export type SettledConversationFinder = (nowIso: string) => Promise<SettledConversation[]>;
export type SettledConversationProcessor = (settled: SettledConversation) => Promise<void>;
export type PollerObserver = (event: { readonly kind: "error" | "tick"; readonly context: string; readonly detail?: unknown }) => void;

export type DebouncePollerResult = { readonly found: number; readonly processed: number; readonly failed: number };

export class DebouncePoller {
  #stopped = false;
  #running = false;

  constructor(
    private readonly finder: SettledConversationFinder,
    private readonly processor: SettledConversationProcessor,
    private readonly clock: Clock,
    private readonly observer?: PollerObserver,
  ) {}

  async runOnce(): Promise<DebouncePollerResult> {
    let settled: SettledConversation[];
    try {
      settled = await this.finder(this.clock.now());
    } catch (detail) {
      this.observer?.({ kind: "error", context: "find_settled", detail });
      return { found: 0, processed: 0, failed: 0 };
    }
    let processed = 0;
    let failed = 0;
    for (const conv of settled) {
      if (this.#stopped) break;
      try {
        await this.processor(conv);
        processed += 1;
      } catch (detail) {
        // Falha de uma conversa NAO derruba o tick nem o poller; o lease/claim deixa
        // as pendentes recuperaveis no proximo tick. So observa (log sanitizado).
        failed += 1;
        this.observer?.({ kind: "error", context: `process:${conv.conversationId}`, detail });
      }
    }
    this.observer?.({ kind: "tick", context: "poll", detail: { found: settled.length, processed, failed } });
    return { found: settled.length, processed, failed };
  }

  // Inicia o laço; devolve um stop() idempotente. Um tick nunca sobrepoe o anterior.
  start(intervalMs: number): () => void {
    const timer = setInterval(() => {
      if (this.#stopped || this.#running) return;
      this.#running = true;
      void this.runOnce().finally(() => { this.#running = false; });
    }, intervalMs);
    return () => { this.#stopped = true; clearInterval(timer); };
  }
}
