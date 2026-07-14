import type { CredentialProvider, SecretRef } from "../../domain/credential-provider.ts";
import type { Clock } from "../../domain/ports.ts";
import type { TenantAgentRef, TenantConfigSource, VehiclePhotoSource } from "../../domain/read-ports.ts";
import { WhatsAppEffectDispatcher } from "./whatsapp-dispatcher.ts";
import { UazapiWhatsAppSender, type UazapiHttpTransport } from "./uazapi-whatsapp-sender.ts";

export type WhatsAppInstanceProvider = "uazapi" | "unsupported";

export type WhatsAppInstanceConfig = {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly provider: WhatsAppInstanceProvider;
  readonly apiUrl: string;
  readonly instanceName: string | null;
  readonly tokenRef: SecretRef;
};

export interface WhatsAppInstanceSource {
  loadOwnedInstance(ref: TenantAgentRef, instanceId: string): Promise<WhatsAppInstanceConfig | null>;
}

export type PilotWhatsAppRuntimeDeps = {
  readonly configSource: TenantConfigSource;
  readonly instanceSource: WhatsAppInstanceSource;
  readonly credentialProvider: CredentialProvider;
  readonly httpTransport: UazapiHttpTransport;
  readonly photoSource: VehiclePhotoSource;
  readonly clock: Clock;
};

export type PilotWhatsAppRuntimeConfig = {
  readonly ref: TenantAgentRef;
  readonly conversationId: string;
  readonly to: string;
  readonly allowedUazapiHosts: readonly string[];
  readonly typingEnabled?: boolean;
};

export type PilotWhatsAppRuntimeErrorCode =
  | "TENANT_CONFIG_INVALID"
  | "AGENT_WITHOUT_INSTANCE"
  | "INSTANCE_NOT_FOUND"
  | "INSTANCE_PROVIDER_UNSUPPORTED"
  | "INSTANCE_OWNERSHIP_MISMATCH";

export type PilotWhatsAppRuntimeResult =
  | { readonly ok: true; readonly dispatcher: WhatsAppEffectDispatcher; readonly sender: UazapiWhatsAppSender; readonly instanceId: string }
  | { readonly ok: false; readonly error: PilotWhatsAppRuntimeErrorCode };

export async function createPilotWhatsAppDispatcher(
  config: PilotWhatsAppRuntimeConfig,
  deps: PilotWhatsAppRuntimeDeps,
): Promise<PilotWhatsAppRuntimeResult> {
  const runtimeConfig = await deps.configSource.load(config.ref);
  if (!runtimeConfig.ok) return { ok: false, error: "TENANT_CONFIG_INVALID" };

  const instanceId = runtimeConfig.config.instanceId;
  if (typeof instanceId !== "string" || instanceId.trim().length === 0) {
    return { ok: false, error: "AGENT_WITHOUT_INSTANCE" };
  }

  const instance = await deps.instanceSource.loadOwnedInstance(config.ref, instanceId);
  if (!instance) return { ok: false, error: "INSTANCE_NOT_FOUND" };
  if (instance.tenantId !== config.ref.tenantId || instance.instanceId !== instanceId) {
    return { ok: false, error: "INSTANCE_OWNERSHIP_MISMATCH" };
  }
  if (instance.provider !== "uazapi") {
    return { ok: false, error: "INSTANCE_PROVIDER_UNSUPPORTED" };
  }

  const sender = new UazapiWhatsAppSender({
    baseUrl: instance.apiUrl,
    allowedHosts: config.allowedUazapiHosts,
    instanceName: instance.instanceName,
    tokenRef: instance.tokenRef,
  }, deps.credentialProvider, deps.httpTransport);

  return {
    ok: true,
    instanceId,
    sender,
    dispatcher: new WhatsAppEffectDispatcher({
      ref: config.ref,
      conversationId: config.conversationId,
      to: config.to,
      clock: deps.clock,
      sender,
      photoSource: deps.photoSource,
      typingEnabled: config.typingEnabled === true,
    }),
  };
}
