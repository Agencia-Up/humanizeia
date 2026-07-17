export type PedroAiProvider = "openai" | "deepseek";
export type CompletionTokenParameter = "max_completion_tokens" | "max_tokens";

export interface RuntimeApiSecret {
  materialize<T>(fn: (apiKey: string) => T): T;
  toJSON(): Readonly<Record<string, string>>;
}

export class AiRuntimeSecret implements RuntimeApiSecret {
  readonly #apiKey: string;

  private constructor(readonly provider: PedroAiProvider, apiKey: string) {
    this.#apiKey = apiKey;
  }

  static fromString(provider: PedroAiProvider, apiKey: string): AiRuntimeSecret {
    const normalized = typeof apiKey === "string" ? apiKey.trim() : "";
    if (normalized === "" || normalized.length > 512 || /\s/.test(normalized)) {
      throw new AiProviderConfigError("AI_SECRET_MISSING");
    }
    return new AiRuntimeSecret(provider, normalized);
  }

  materialize<T>(fn: (apiKey: string) => T): T {
    return fn(this.#apiKey);
  }

  toJSON(): Readonly<Record<string, string>> {
    return { kind: "ai_runtime_secret", provider: this.provider };
  }
}

export type AiProviderRuntimeConfig = {
  readonly provider: PedroAiProvider;
  readonly endpointUrl: string;
  readonly allowedHosts: readonly string[];
  readonly model: string;
  readonly retryModel: string;
  readonly tokenParameter: CompletionTokenParameter;
};

export class AiProviderConfigError extends Error {
  constructor(public readonly code: "AI_PROVIDER_INVALID" | "AI_MODEL_INVALID" | "AI_SECRET_MISSING") {
    super(code);
    this.name = "AiProviderConfigError";
  }
}

function modelValue(value: string | undefined, fallback: string): string {
  const model = value?.trim() || fallback;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) throw new AiProviderConfigError("AI_MODEL_INVALID");
  return model;
}

export function resolveAiProviderRuntime(env: NodeJS.ProcessEnv): AiProviderRuntimeConfig {
  const raw = env.PEDRO_V3_AI_PROVIDER?.trim().toLowerCase() || "openai";
  if (raw === "deepseek") {
    const model = modelValue(env.PEDRO_V3_DEEPSEEK_MODEL, "deepseek-chat");
    return Object.freeze({
      provider: "deepseek",
      endpointUrl: "https://api.deepseek.com/chat/completions",
      allowedHosts: Object.freeze(["api.deepseek.com"]),
      model,
      retryModel: modelValue(env.PEDRO_V3_DEEPSEEK_RETRY_MODEL, model),
      tokenParameter: "max_tokens",
    });
  }
  if (raw !== "openai") throw new AiProviderConfigError("AI_PROVIDER_INVALID");
  const model = modelValue(env.PEDRO_V3_OPENAI_MODEL, "gpt-4.1");
  return Object.freeze({
    provider: "openai",
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    allowedHosts: Object.freeze(["api.openai.com"]),
    model,
    retryModel: modelValue(env.PEDRO_V3_OPENAI_RETRY_MODEL, "gpt-4.1"),
    tokenParameter: "max_completion_tokens",
  });
}

// Excecao operacional do piloto: o servico do Easypanel pode receber a chave DeepSeek diretamente.
// OpenAI permanece exclusivamente BYOK/Vault. A funcao devolve segredo opaco e nunca o valor cru.
export function resolveProviderEnvironmentSecret(
  env: NodeJS.ProcessEnv,
  provider: PedroAiProvider,
): AiRuntimeSecret | null {
  if (provider !== "deepseek") return null;
  const raw = env.DEEPSEEK_API_KEY;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return AiRuntimeSecret.fromString("deepseek", raw);
}
