import type { KnowledgeChunk, KnowledgeSearchResult, KnowledgeSource } from "../../domain/knowledge.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";

type FetchLike = typeof fetch;

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function parseChunk(raw: unknown, index: number): KnowledgeChunk | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const content = typeof item.content === "string" ? item.content.trim().slice(0, 6000) : "";
  if (!content) return null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id : `tenant:chunk:${index}`;
  const sourceId = typeof item.source_id === "string" ? item.source_id : null;
  const title = typeof item.title === "string" ? item.title.slice(0, 240) : null;
  const score = clampConfidence(item.similarity ?? item.confidence);
  return { id, sourceId, title, content, confidence: score, provenance: "tenant_knowledge" };
}

/** Server-side adapter for the portal's existing pgvector knowledge base. */
export class SupabaseKnowledgeSource implements KnowledgeSource {
  private readonly endpoint: string;
  private readonly fetcher: FetchLike;

  constructor(baseUrl: string, private readonly serviceRoleKey: string, fetcher: FetchLike = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") throw new Error("KNOWLEDGE_SOURCE_REQUIRES_HTTPS");
    this.endpoint = `${url.toString().replace(/\/$/, "")}/functions/v1/knowledge-search`;
    this.fetcher = fetcher;
  }

  async search(ref: TenantAgentRef, query: string, limit: number): Promise<KnowledgeSearchResult> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.serviceRoleKey}`,
        apikey: this.serviceRoleKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: query.slice(0, 1200), tenant_id: ref.tenantId, agent_id: ref.agentId, match_count: Math.max(1, Math.min(limit, 8)) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { chunks: [], confidence: 0 };
    const body: unknown = await response.json().catch(() => null);
    if (typeof body !== "object" || body === null) return { chunks: [], confidence: 0 };
    const rawResults = (body as Record<string, unknown>).results;
    const chunks = Array.isArray(rawResults) ? rawResults.map(parseChunk).filter((chunk): chunk is KnowledgeChunk => chunk !== null).slice(0, 8) : [];
    return { chunks, confidence: chunks.length > 0 ? Math.max(...chunks.map((chunk) => chunk.confidence)) : 0 };
  }
}
