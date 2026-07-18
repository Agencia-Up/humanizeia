// ============================================================================
// legacy-replay.ts — F7-6 (Fase 7). FRONTEIRA DE POLÍTICA do ramo LEGADO de autoria comercial determinística.
//
// CONTEXTO: no Pedro v3 LLM-first, a LLM (cérebro) CONDUZ e REDIGE toda a resposta comercial/conversacional; o
// engine só valida FATO/EFEITO e, no máximo, emite UMA nota curta de indisponibilidade técnica (outage). Os
// "handlers legados" (foto determinística, institucional, desengajamento, "mais opções", recuperação contextual,
// recall) são a autoria comercial DETERMINÍSTICA do desenho antigo — hoje MORTOS em produção.
//
// PRODUÇÃO = central_active E central_shadow, AMBOS com llmFirst=true (ver pilot-active-root #processCentralActive
// e central-shadow-runner). Nesses dois modos, NENHUM responseSource deterministic_* pode ser produzido — é a
// exigência essencial do dono ("nenhum central_active/central_shadow pode produzir resposta deterministic_*").
//
// Os handlers legados só rodam sob OPT-IN EXPLÍCITO (`legacyCommercialReplay=true`), reservado a harnesses de
// replay/offline (ex.: F2.13). Este módulo é a fonte única dessa política: o predicado de habilitação, o conjunto
// de fontes determinísticas e as duas invariantes (fiação + saída) que o engine chama fail-closed.
// ============================================================================
import type { ResponseSource } from "../central-engine.ts";

// Fontes determinísticas de autoria COMERCIAL — permitidas SOMENTE em replay/offline autorizado. `technical_fallback`
// e `legacy_compose` NÃO entram aqui: a nota de outage é o piso legítimo de qualquer modo, e legacy_compose é a via de
// 2º compose (não é autoria determinística do engine).
export const LEGACY_DETERMINISTIC_SOURCES: ReadonlySet<ResponseSource> = new Set<ResponseSource>([
  "deterministic_recall",
  "deterministic_photo",
  "deterministic_institutional",
  "deterministic_recovery",
  "deterministic_discovery",
  "deterministic_conduct",
]);

// Ramo legado habilitado SOMENTE quando NÃO é llmFirst E o chamador autorizou explicitamente o replay. Produção
// (llmFirst=true) nunca passa a flag -> sempre false.
export function isLegacyReplayEnabled(llmFirst: boolean, legacyCommercialReplay: boolean): boolean {
  return !llmFirst && legacyCommercialReplay === true;
}

// INVARIANTE DE FIAÇÃO: produção nunca liga o replay. llmFirst + replay é erro de composição (bug de wiring) — falha
// alto e cedo. Só pode disparar num teste mal configurado, que é exatamente quando queremos que estoure.
export function assertReplayWiring(llmFirst: boolean, legacyCommercialReplay: boolean): void {
  if (llmFirst && legacyCommercialReplay) {
    throw new Error("F7-6 INVARIANT: legacyCommercialReplay deve ser false quando llmFirst (produção) é true");
  }
}

// INVARIANTE DE SAÍDA: um responseSource deterministic_* comercial só pode existir sob replay legado autorizado.
// Em central_active/central_shadow (llmFirst) OU em qualquer chamador não-llmFirst sem autorização, dispara.
export function assertLegacyAuthoringAuthorized(
  responseSource: ResponseSource,
  opts: { readonly llmFirst: boolean; readonly legacyCommercialReplay: boolean },
): void {
  if (LEGACY_DETERMINISTIC_SOURCES.has(responseSource) && !isLegacyReplayEnabled(opts.llmFirst, opts.legacyCommercialReplay)) {
    throw new Error(
      `F7-6 INVARIANT: responseSource determinístico "${responseSource}" é replay-only; ` +
      `proibido sob llmFirst=${opts.llmFirst} legacyCommercialReplay=${opts.legacyCommercialReplay}`,
    );
  }
}
