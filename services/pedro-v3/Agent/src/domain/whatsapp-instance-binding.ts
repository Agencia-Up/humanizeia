// A origem WhatsApp de uma conversa e um fato de roteamento, nao uma
// preferencia do agente. Este modulo centraliza a compatibilidade entre o
// vinculo legado (instance_id) e o vinculo multiplo (instance_ids).

export type WhatsAppInstanceBindingConfig = {
  readonly instanceId?: string | null;
  readonly instanceIds?: readonly string[] | null;
};

export type WhatsAppInstanceResolution =
  | { readonly ok: true; readonly instanceId: string; readonly configuredInstanceIds: readonly string[] }
  | {
      readonly ok: false;
      readonly error: "AGENT_WITHOUT_INSTANCE" | "INSTANCE_CONTEXT_REQUIRED" | "INSTANCE_NOT_BOUND_TO_AGENT";
      readonly configuredInstanceIds: readonly string[];
    };

function normalizedId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function configuredWhatsAppInstanceIds(config: WhatsAppInstanceBindingConfig): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const id = normalizedId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  add(config.instanceId);
  for (const id of config.instanceIds ?? []) add(id);
  return Object.freeze(ids);
}

export function resolveConversationWhatsAppInstance(
  config: WhatsAppInstanceBindingConfig,
  requestedInstanceId?: string | null,
): WhatsAppInstanceResolution {
  const configuredInstanceIds = configuredWhatsAppInstanceIds(config);
  const requested = normalizedId(requestedInstanceId);

  if (requested) {
    return configuredInstanceIds.includes(requested)
      ? { ok: true, instanceId: requested, configuredInstanceIds }
      : { ok: false, error: "INSTANCE_NOT_BOUND_TO_AGENT", configuredInstanceIds };
  }
  if (configuredInstanceIds.length === 0) {
    return { ok: false, error: "AGENT_WITHOUT_INSTANCE", configuredInstanceIds };
  }
  if (configuredInstanceIds.length > 1) {
    return { ok: false, error: "INSTANCE_CONTEXT_REQUIRED", configuredInstanceIds };
  }
  return { ok: true, instanceId: configuredInstanceIds[0], configuredInstanceIds };
}
