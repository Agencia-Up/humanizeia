// ============================================================================
// PERFIS DE LLM — resolvedor. Escolhe a parte LLM-ESPECÍFICA (prompt/regras/few-shots) pelo provedor
// ATIVO, mantendo orquestrador/decisão/busca/guards COMPARTILHADOS. É a alternativa CERTA a "forkar o
// agente por LLM" (que seria 3x manutenção): só os ~10% específicos divergem; os ~90% ficam únicos.
// Por enquanto só existe o perfil OpenAI (base). Ao criar deepseek.ts / claude.ts, registre aqui.
// ============================================================================
import { openaiReplyProfile } from "./openai.ts";

export function getReplyProfile(provider?: string | null) {
  // deepseek.ts / claude.ts entram aqui (ex.: provider==='deepseek' -> deepseekReplyProfile).
  // Default = perfil OpenAI (base), usado por todos enquanto os outros não divergem.
  switch (String(provider || "").toLowerCase()) {
    default:
      return openaiReplyProfile;
  }
}
