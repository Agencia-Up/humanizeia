import type { ModelHttpTransport } from "../adapters/llm/structured-json-model.ts";
import { OpenAiChatCompletionsModel, type OpenAiChatModelConfig } from "../adapters/llm/openai-chat-model.ts";
import type { TenantRuntimeConfig } from "../domain/read-ports.ts";
import {
  CanaryShadowRoot,
  type CanaryReadDeps,
  type CanaryShadowConfig,
} from "./canary-shadow-root.ts";

export class OpenAiRuntimeSecret {
  readonly #apiKey: string;

  private constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  static fromString(apiKey: string): OpenAiRuntimeSecret {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new OpenAiCanaryRootError("OPENAI_SECRET_MISSING");
    }
    return new OpenAiRuntimeSecret(apiKey);
  }

  materialize<T>(fn: (apiKey: string) => T): T {
    return fn(this.#apiKey);
  }

  toJSON(): Record<string, string> {
    return { kind: "openai_runtime_secret" };
  }
}

export class OpenAiCanaryRootError extends Error {
  constructor(public readonly code:
    | "OPENAI_SECRET_MISSING"
    | "OPENAI_TRANSPORT_MISSING") {
    super(code);
    this.name = "OpenAiCanaryRootError";
  }
}

export type OpenAiCanaryModelOptions = Omit<
  OpenAiChatModelConfig,
  "apiKey" | "model" | "temperature"
> & {
  readonly modelOverride?: string | null;
  readonly temperatureOverride?: number | null;
};

export type OpenAiCanaryDeps = Omit<CanaryReadDeps, "model" | "modelFactory"> & {
  readonly openAiSecret: OpenAiRuntimeSecret;
  readonly modelTransport: ModelHttpTransport;
  readonly modelOptions?: OpenAiCanaryModelOptions;
};

export function createOpenAiModelFactory(deps: {
  readonly openAiSecret: OpenAiRuntimeSecret;
  readonly modelTransport: ModelHttpTransport;
  readonly modelOptions?: OpenAiCanaryModelOptions;
}): (config: TenantRuntimeConfig) => OpenAiChatCompletionsModel {
  if (!deps.modelTransport) throw new OpenAiCanaryRootError("OPENAI_TRANSPORT_MISSING");
  return (config) => deps.openAiSecret.materialize((apiKey) => new OpenAiChatCompletionsModel({
    ...deps.modelOptions,
    apiKey,
    model: deps.modelOptions?.modelOverride ?? config.model,
    temperature: deps.modelOptions?.temperatureOverride ?? config.temperature,
  }, deps.modelTransport));
}

export function redactedOpenAiCanaryDepsSummary(deps: OpenAiCanaryDeps): Record<string, unknown> {
  return {
    openAiSecret: deps.openAiSecret.toJSON(),
    hasModelTransport: !!deps.modelTransport,
    modelOptions: {
      endpointUrl: deps.modelOptions?.endpointUrl,
      allowedHosts: deps.modelOptions?.allowedHosts,
      modelOverride: deps.modelOptions?.modelOverride,
      temperatureOverride: deps.modelOptions?.temperatureOverride,
      timeoutMs: deps.modelOptions?.timeoutMs,
      maxResponseBytes: deps.modelOptions?.maxResponseBytes,
      maxCompletionTokens: deps.modelOptions?.maxCompletionTokens,
    },
  };
}

export async function createOpenAiCanaryShadowRoot(
  config: CanaryShadowConfig,
  deps: OpenAiCanaryDeps,
): Promise<CanaryShadowRoot> {
  return CanaryShadowRoot.create(config, {
    ...deps,
    modelFactory: createOpenAiModelFactory(deps),
  });
}
