import { allowedToolsForAgentProfile, isGeneralSdrProfile } from "../src/domain/agent-profile.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import type { TenantAgentRef } from "../src/domain/read-ports.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) { passed += 1; console.log(`OK ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}`); }
}

const generalTools = allowedToolsForAgentProfile("sdr_geral");
const automotiveTools = allowedToolsForAgentProfile("sdr");

check("SDR Geral é reconhecido", isGeneralSdrProfile("sdr_geral"));
check("SDR Geral mantém Base e informação da empresa", generalTools.includes("knowledge_search") && generalTools.includes("tenant_business_info"));
check("SDR Geral não recebe estoque nem fotos", !generalTools.includes("stock_search") && !generalTools.includes("vehicle_details") && !generalTools.includes("vehicle_photos_resolve"));
check("SDR Automóveis mantém ferramentas automotivas", automotiveTools.includes("stock_search") && automotiveTools.includes("vehicle_photos_resolve"));

const ref: TenantAgentRef = { tenantId: "tenant-profile-test", agentId: "agent-profile-test" };
let stockCalls = 0;
const runner = createReadQueryRunner(ref, {
  allowedTools: generalTools,
  stock: { search: async () => { stockCalls += 1; return { items: [], filtersUsed: {} }; } },
  vehicleDetails: { getDetails: async () => null },
  vehiclePhotos: {
    resolvePhotos: async () => ({ vehicleKey: "unused", ambiguous: false, photoIds: [] }),
    resolveUrls: async () => [],
  },
  crm: { readLead: async () => null },
});

const denied = await runner({ tool: "stock_search", input: {} });
check("SDR Geral bloqueia stock_search no executor", !denied.ok && denied.error.code === "FORBIDDEN");
check("SDR Geral não consulta a fonte de estoque", stockCalls === 0);

console.log(`AGENT_PROFILE: ${passed} OK / ${failed} FALHA`);
if (failed > 0) process.exit(1);
