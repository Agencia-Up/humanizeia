import assert from "node:assert/strict";
import { CoreSemanticKnowledgeSource, CompositeKnowledgeSource } from "../src/domain/knowledge.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";
import { SupabaseKnowledgeSource } from "../src/adapters/read/supabase-knowledge-source.ts";
import type { CrmReadSource, StockSource, VehicleDetailSource, VehiclePhotoSource } from "../src/domain/read-ports.ts";

const ref = { tenantId: "tenant-a", agentId: "agent-a" } as const;

const core = new CoreSemanticKnowledgeSource();
const payment = await core.search(ref, "carta contemplada 53 mil forma de pagamento", 4);
assert.ok(payment.chunks.some((chunk) => chunk.id === "core:payment-roles"));
assert.match(payment.chunks.find((chunk) => chunk.id === "core:payment-roles")!.content, /automaticamente entrada/i);

const tenant = {
  async search(receivedRef: typeof ref, query: string, limit: number) {
    assert.deepEqual(receivedRef, ref);
    assert.equal(query, "condição de financiamento");
    assert.equal(limit, 3);
    return { confidence: 0.91, chunks: [{ id: "tenant:1", sourceId: "source-1", title: "Condições", content: "Conteúdo cadastrado pelo cliente.", confidence: 0.91, provenance: "tenant_knowledge" as const }] };
  },
};
const composite = new CompositeKnowledgeSource(tenant);
const merged = await composite.search(ref, "condição de financiamento", 3);
assert.equal(merged.chunks[0].provenance, "tenant_knowledge");

const emptyStock = { async search() { return { items: [], filtersUsed: {} }; } } as StockSource;
const emptyDetails = { async getDetails() { return null; } } as VehicleDetailSource;
const emptyPhotos = { async resolvePhotos() { return { vehicleKey: "", ambiguous: true, photoIds: [] }; }, async resolveUrls() { return []; } } as VehiclePhotoSource;
const emptyCrm = { async readLead() { return null; } } as CrmReadSource;
const runner = createReadQueryRunner(ref, { stock: emptyStock, vehicleDetails: emptyDetails, vehiclePhotos: emptyPhotos, crm: emptyCrm, knowledge: composite });
const result = await runner({ tool: "knowledge_search", input: { query: "condição de financiamento", topK: 3 } });
assert.equal(result.ok, true);
if (result.ok && result.tool === "knowledge_search") assert.equal(result.data.chunks[0].id, "tenant:1");

let capturedBody: Record<string, unknown> | null = null;
const remote = new SupabaseKnowledgeSource("https://example.supabase.co", "service-key", async (_input, init) => {
  capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
  return new Response(JSON.stringify({ results: [{ id: "kb-chunk", source_id: "kb-source", content: "Fonte do portal", similarity: 0.88 }] }), { status: 200 });
});
const remoteResult = await remote.search(ref, "financiamento", 2);
assert.deepEqual(capturedBody, { query: "financiamento", tenant_id: "tenant-a", agent_id: "agent-a", match_count: 2 });
assert.equal(remoteResult.chunks[0].provenance, "tenant_knowledge");
assert.equal(remoteResult.chunks[0].confidence, 0.88);

console.log("F2.61 semantic knowledge: 10 OK");
