# 02 - Arquitetura e Contratos (proposta para aprovação)

> Status: Fase 0 — **PROPOSTA**. Nada será implementado antes da aprovação do dono + auditoria do Codex.
> Autor: Claude. Data: 2026-06-26.
> Os tipos abaixo são contratos conceituais (TypeScript) provider-agnostic. Não há código em `Agent/` ainda.

## 1. Princípios que os contratos garantem

1. **Uma `TurnDecision` por turno** (POL-STATE-001).
2. **`ConversationState` versionado** = única fonte operacional (POL-STATE-004).
3. **Tools devolvem fatos**, nunca escolhem o que responder (POL-STATE-002).
4. **PolicyEngine valida a decisão**; composer/sender não mudam ação (POL-STATE-003).
5. **Atomicidade com CAS**; inbox durável + lease em vez de background frágil (ADR-002).
6. **CoordinationStore** abstrai lock/cache/dedupe — hoje Postgres, amanhã Valkey (ADR-003).
7. **Provider-agnostic**: nenhum contrato menciona OpenAI/Gemini/Claude (decisão por ADR após testes com fakes).
8. **Shadow-safe**: todo efeito externo passa por um `EffectGate` que está OFF em shadow (ADR-004).

## 2. Contratos de domínio (TypeScript conceitual)

### 2.1 ConversationState (versionado)

```ts
type ConversationState = {
  schemaVersion: number;          // versão do schema do estado
  version: number;                // versão otimista p/ CAS (incrementa a cada persist)
  conversationId: string;
  tenantId: string;
  agentId: string;
  leadId?: string | null;
  turnNumber: number;
  stage: ConversationStage;       // ESTADO ENTREGUE: só avança via EffectOutcome (Codex r3 #1)
  currentObjective?: PendingObjective | null;   // ATIVO só após o send da pergunta ter receipt (Codex r3 #1)
  plannedObjectives: PlannedObjective[];        // PLANEJADO: perguntas/ofertas aguardando receipt do effectId
  slots: FunnelSlots;
  preferences: VehiclePreferences;     // tipo, faixa, câmbio, cor, marca, restrições duras
  vehicleContext: VehicleContext;      // current_vehicle_focus (← veiculo_em_foco v2)
  offers: OfferMemory;                 // last_stock_offer + opcoes_listadas_keys (v217)
  photoLedger: PhotoLedger;            // fotos_por_veiculo (v211), por stableVehicleKey
  rejected: RejectedMemory;            // rejeitados (v173)
  handoff: HandoffState;
  scheduling: SchedulingState;
  recentTurns: ConversationTurn[];     // janela curta p/ contexto
  lastDecision?: DecisionSummary | null;
  lastToolResult?: ToolResultSummary | null;
  updatedAt: string;
};
```

### 2.2 PlannedObjective × PendingObjective (planejado vs entregue) — CORREÇÃO Codex r3 #1

Princípio: **nenhuma memória pode afirmar que o lead viu/recebeu algo sem o receipt do efeito.** A pergunta que o agente decidiu fazer é primeiro um `PlannedObjective` (ligado ao `effectId` da mensagem); só vira `PendingObjective` ATIVO (`currentObjective`) quando o `send_message` daquela pergunta confirma receipt (Codex r3 #3 define o nível). Mesma regra para oferta, foco apresentado, avanço de stage e handoff.

```ts
type PlannedObjective = {
  id: string;
  effectId: string;                // efeito (send_message) que, ao receber receipt, ativa este objetivo
  type: ObjectiveType;             // perguntou_pagamento | perguntou_troca | perguntou_dados | ofereceu_fotos | ofereceu_opcoes
  slot?: SlotName | null;
  plannedInTurnId: string;
  expectedAnswerKinds: AnswerKind[];
};

type PendingObjective = {          // ATIVO: só existe após o receipt do effectId correspondente
  id: string;
  type: ObjectiveType;
  slot?: SlotName | null;
  askedAt: string;                 // = momento do receipt (não da decisão)
  askedInTurnId: string;
  deliveredByEffectId: string;     // prova de entrega
  expectedAnswerKinds: AnswerKind[];
  status: "pending" | "satisfied" | "declined" | "superseded";
  attempts: number;
};

// Mutações DEPENDENTES DE ENTREGA (Codex r3 #1) — viram EffectOutcomeMutation, nunca DecisionMutation:
//   set_objective (pergunta), record_offer (oferta vista), presented_vehicle_focus (carro apresentado),
//   set_stage (avanço de etapa de venda), handoff (completed), assistant_turn (fala do agente registrada).
// Mutações de FATO DO INBOUND (não dependem de entrega) — DecisionMutation no commit:
//   set_slot do que o LEAD disse, add_rejected do que o lead recusou, resolve_objective pela resposta do lead.
```

### 2.3 FunnelSlot (valor + proveniência)

```ts
type FunnelSlot<T> = {
  status: "unknown" | "known" | "declined" | "not_applicable";
  value: T | null;
  sourceTurnId?: string | null;
  confidence: number;     // 0..1
  updatedAt: string;
};

type FunnelSlots = {
  nome: FunnelSlot<string>;
  interesse: FunnelSlot<string>;
  tipoVeiculo: FunnelSlot<string>;
  faixaPreco: FunnelSlot<{ min?: number; max?: number }>;
  formaPagamento: FunnelSlot<string>;
  entrada: FunnelSlot<number>;
  parcelaDesejada: FunnelSlot<number>;
  possuiTroca: FunnelSlot<boolean>;
  veiculoTroca: FunnelSlot<{ marca?: string; modelo?: string; ano?: number; km?: number; estado?: string }>;
  cidade: FunnelSlot<string>;
  conheceLoja: FunnelSlot<boolean>;
  interesseVisita: FunnelSlot<boolean>;
  diaHorario: FunnelSlot<string>;
  cpf: SensitiveSlot;               // CORREÇÃO Codex #8: NUNCA valor cru no estado — ref + status (ver §2.3.1)
};
```

#### 2.3.1 Valores sensíveis (CPF/segredos) — CORREÇÃO Codex #8

CPF (e qualquer segredo) **não** entram no `ConversationState`, nem em evento, prompt persistido ou log. O estado guarda apenas uma **referência** + status; o valor real vive em armazenamento isolado, criptografado, lido só no momento do efeito autorizado (handoff/agenda) — nunca em shadow.

```ts
type SensitiveValueRef = {
  ref: string;                      // ponteiro p/ cofre isolado (ex.: v3_sensitive_vault.id)
  kind: "cpf" | "secret";
  last4?: string | null;           // dígitos finais p/ UX/auditoria, se a política permitir
  encAlg?: string;                 // algoritmo/versão de criptografia em repouso
};

type SensitiveSlot = {
  status: "unknown" | "known" | "declined" | "not_applicable";
  ref: SensitiveValueRef | null;   // nunca o valor; só a referência
  sourceTurnId?: string | null;
  updatedAt: string;
};

// Garantia por construção: todo payload persistido é `Redacted<T>` (def. em §4) — a função que cria
// eventos/logs só aceita tipos já redigidos; CPF/segredo bruto NÃO compila/NÃO é aceito.
// `JsonValue` = união JSON tipada (string|number|boolean|null|JsonValue[]|{[k:string]:JsonValue}), sem `unknown`.
```

### 2.4 TurnDecision (a decisão única)

```ts
type TurnAction =
  | "reply" | "clarify" | "collect_slot" | "search_stock" | "send_photos"
  | "answer_vehicle_question" | "schedule_visit" | "handoff" | "close" | "no_op";

// ProposedDecision (Codex #6): o que o DecisionEngine PROPÕE ao final do loop de queries. NÃO escreve
// estado, NÃO materializa payload de efeito, NÃO é a decisão final (quem emite é o Finalizer, §2.7).
type ProposedDecision = {
  proposedAction: TurnAction;
  target?: EntityReference | null;
  facts: DecisionMutation[];             // fatos confirmados pelo inbound/queries (Codex #1) — vão ao commit
  proposedEffects: EffectPlan[];         // PLANOS de efeito, SEM payload materializado (Codex #2)
  nextObjective?: PendingObjective | null;
  responsePlan: ResponsePlan;            // intenção de resposta (não o texto)
  reasonCode: string; reasonSummary: string; confidence: number;
};

// TurnDecision: a ÚNICA decisão comercial final do turno. Emitida SÓ pelo Finalizer.
type TurnDecision = {
  turnId: string;
  action: TurnAction;
  target?: EntityReference | null;
  reasonCode: string; reasonSummary: string; confidence: number;
  decisionMutations: DecisionMutation[]; // FATOS aplicados no COMMIT (Codex #1) — nunca "sent/asked/completed"
  effectPlan: EffectPlan[];              // o QUE despachar; payload materializado só após compose+validate (Codex #2)
  nextObjective?: PendingObjective | null;
  responsePlan: ResponsePlan;
  policyChecks: PolicyVerdict[];         // evidência allow/deny/requirements/violations (NÃO é a decisão)
};
```

### 2.5 QueryTools tipadas + LOOP limitado de leitura, e EffectPlan (sem payload materializado)

**QueryTool** é leitura pura, usável durante a decisão. **EffectPlan** é a intenção de efeito (envio/CRM/agenda/handoff) — sem payload materializado; o payload só é montado após `compose+validate` (§3) e vira `EffectIntent` no outbox.

```ts
// (a) TIPAGEM POR CONSTRUÇÃO (Codex #6): mapas de entrada/saída por tool — sem `unknown`.
type QueryInputMap = {
  stock_search: { tipo?: VehicleType; precoMax?: number; modelo?: string; broad?: boolean; excludeKeys?: string[] };
  vehicle_details: { vehicleKey: string };
  vehicle_photos_resolve: { vehicleRef: EntityReference; angle?: PhotoAngle };
  knowledge_search: { query: string; topK: number };
  crm_read: { leadId: string };
  store_info: { topic: "address" | "hours" | "unit" };
  availability_check: { date: string };
  media_understanding: { mediaRef: string; kind: "audio" | "image" };
  ad_context: { referralRef: string };
};
type QueryOutputMap = {
  stock_search: { items: VehicleFact[]; filtersUsed: StockFilters; matchDiagnostics: MatchDiag };
  vehicle_details: { vehicle: VehicleFact };
  vehicle_photos_resolve: { vehicleKey: string; ambiguous: boolean; candidates: EntityReference[]; photoIds: string[] };
  knowledge_search: { chunks: KnowledgeChunk[]; confidence: number };
  crm_read: { lead: LeadFact };
  store_info: { value: string; source: string };
  availability_check: { slots: string[] };
  media_understanding: { text: string; entities: string[] };
  ad_context: { vehicleQuery: string | null; generic: boolean };
};
type QueryName = keyof QueryInputMap;
type QueryResult<N extends QueryName = QueryName> =
  | { ok: true; tool: N; data: QueryOutputMap[N]; source: string; diagnostics?: Record<string, JsonValue> }
  | { ok: false; tool: N; error: ToolError };
type ToolError = { code: "TIMEOUT" | "NOT_FOUND" | "UPSTREAM" | "VALIDATION" | "FORBIDDEN"; message: string; retryable: boolean };

interface QueryTool<N extends QueryName> {            // SEM efeito externo -> roda na decisão E em shadow
  name: N;
  timeoutMs: number; retry: { maxAttempts: number; backoffMs: number };
  execute(input: QueryInputMap[N], ctx: QueryContext): Promise<QueryResult<N>>;
}

// (b) BOUNDED READ-ONLY QUERY LOOP (Codex #4 + r3 #6). QueryCall = MAPPED UNION (tool ↔ input correlacionados):
type QueryCall = { [N in QueryName]: { tool: N; input: QueryInputMap[N] } }[QueryName];
type DecisionStep =
  | { kind: "query"; call: QueryCall }
  | { kind: "final"; proposal: ProposedDecision };

interface DecisionEngine {
  // olha estado + fatos JÁ acumulados e PROPÕE: mais uma QueryCall OU finalizar.
  proposeNextQueryOrFinal(ctx: TurnContext, facts: QueryResult[]): Promise<DecisionStep>;
}

type QueryLoopLimits = {
  maxSteps: number;            // teto de consultas no turno (ex.: 4)
  totalTimeoutMs: number;      // teto de tempo do loop inteiro
};
// LOOP (Codex r3 #6): cada QueryCall é AUTORIZADA por chamada — PolicyEngine.authorizeQuery(call, ctx, facts);
// só executa se 'allow'. Nada de whitelist estática única: a autorização vê os fatos JÁ acumulados.
// SAÍDA SEGURA: maxSteps/timeout sem "final" -> decisão determinística segura (clarify) + evento de erro.
// Resultado do loop = UMA ProposedDecision (depois: postQuery -> Finalizer emite a TurnDecision).

// (c) EFFECT PLAN = UNIÃO SEMÂNTICA tipada (Codex r3 #4): contém DADOS DE NEGÓCIO, não o payload do provider.
//     A materialização (§3) cria o payload do provider a partir do plano + da resposta composta.
//     effectId DETERMINÍSTICO (Codex r3.5 #3): effectId = `${turnId}:${planId}` — conhecido ANTES de criar
//     o PlannedObjective (que referencia esse effectId). planId é estável dentro do turno.
type EffectKind = "send_message" | "send_media" | "crm_write" | "schedule_visit" | "handoff" | "notify_seller";
type EffectPlanBase = {
  planId: string;                          // estável no turno -> effectId = turnId:planId
  order: number;                           // ordem: anúncio antes do handoff
  dependsOn?: string[];
  // OUTCOMES SEMÂNTICOS DE SUCESSO (Codex r3.5 #2): o que aplicar no estado QUANDO o efeito receber receipt.
  // Persistidos no outbox junto do efeito; o EffectOutcomeCommit (§3 passo 19) aplica-os após 'succeeded'.
  onSuccess: EffectOutcomeMutation[];      // ex.: [activate_objective, record_offer, set_presented_vehicle_focus, advance_stage, append_assistant_turn]
};
type SendMessagePlan  = EffectPlanBase & { kind: "send_message" };
type SendMediaPlan    = EffectPlanBase & { kind: "send_media"; vehicleKey: string; photoIds: string[] };  // 1 plano por veículo; receipt POR foto (Codex r3 #5)
type CrmWritePlan     = EffectPlanBase & { kind: "crm_write"; leadId: string; fields: CrmWritableFields };
type SchedulePlan     = EffectPlanBase & { kind: "schedule_visit"; leadId: string; slot: string };
type HandoffPlan      = EffectPlanBase & { kind: "handoff"; leadId: string; sellerId: string };          // briefing materializado depois
type NotifySellerPlan = EffectPlanBase & { kind: "notify_seller"; sellerId: string; reason: string };
type EffectPlan = SendMessagePlan | SendMediaPlan | CrmWritePlan | SchedulePlan | HandoffPlan | NotifySellerPlan;

// Payload do PROVIDER, materializado por kind APÓS compose+validate (Codex #2/#6), redacted por construção (#8).
type EffectPayloadMap = {
  send_message: { text: RedactedText };
  send_media: { vehicleKey: string; photoItems: { photoId: string; url: string }[]; caption?: RedactedText };
  crm_write: { leadId: string; fields: CrmWritableFields };
  schedule_visit: { leadId: string; slot: string };
  handoff: { leadId: string; sellerId: string; briefing: RedactedText };
  notify_seller: { sellerId: string; message: RedactedText };
};
type EffectIntent<K extends EffectKind = EffectKind> = {
  effectId: string; planId: string; kind: K;
  idempotencyKey: string;                 // garantia REAL depende da capacidade do provider (§6/ADR-002)
  payload: EffectPayloadMap[K];           // materializado APÓS compose+validate (§3)
  order: number; dependsOn?: string[];
  requiresActiveMode: true;               // shadow NUNCA despacha
};

interface ToolRegistry {
  getQuery<N extends QueryName>(name: N): QueryTool<N>;
  listQueries(): QueryName[];
  // EffectPlans NÃO ficam aqui — viram EffectIntent no outbox (§4) e o OutboxDispatcher executa (§6).
}
```

### 2.6 DecisionMutation (commit) × EffectOutcomeMutation (após receipt) + reducer — CORREÇÃO Codex #1/#5/#6

Duas classes de mutação. **DecisionMutation** = fatos confirmados pelo inbound/queries, aplicados no COMMIT. **EffectOutcomeMutation** = resultado de um efeito, aplicada SÓ após o **receipt** real do efeito correspondente. Foto não vira `sent`, pergunta não vira `asked/delivered`, handoff não vira `completed` antes da confirmação do efeito (Codex #1). Reducer determinístico, mutação inválida é rejeitada (não corrompe).

```ts
// (a) set_slot DISCRIMINADO por slot (Codex #6) — value TIPADO por slot, sem `unknown`:
type SlotMutation =
  | { op: "set_slot"; slot: "nome"; value: string; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "interesse"; value: string; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "tipoVeiculo"; value: VehicleType; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "faixaPreco"; value: { min?: number; max?: number }; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "formaPagamento"; value: PaymentMethod; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "entrada"; value: number; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "possuiTroca"; value: boolean; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "diaHorario"; value: string; confidence: number; sourceTurnId: string }
  | { op: "set_slot_ref"; slot: "cpf"; ref: SensitiveValueRef; sourceTurnId: string }
  | { op: "set_slot"; slot: "parcelaDesejada"; value: number; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "veiculoTroca"; value: { marca?: string; modelo?: string; ano?: number; km?: number; estado?: string }; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "cidade"; value: string; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "conheceLoja"; value: boolean; confidence: number; sourceTurnId: string }
  | { op: "set_slot"; slot: "interesseVisita"; value: boolean; confidence: number; sourceTurnId: string };

// (b) DecisionMutation: aplicada no COMMIT — SÓ FATOS DO INBOUND (não dependem de entrega). Codex r3 #1.
type DecisionMutation =
  | SlotMutation                                                       // o que o LEAD disse
  | { op: "resolve_objective"; objectiveId: string; status: "satisfied" | "declined" }  // resposta do lead
  | { op: "supersede_objective"; objectiveId: string }                // lead mudou de assunto
  | { op: "add_rejected"; modelo: string }                            // lead recusou
  | { op: "set_planned_objective"; planned: PlannedObjective }        // PLANEJADO (ligado a effectId), não ativo
  | { op: "append_lead_turn"; turn: ConversationTurn };               // a fala do LEAD (recebida) — não a do agente

// (c) EffectOutcomeMutation: aplicada SOMENTE com o receipt do efeito (Codex r3 #1). Tudo que afirma que o
//     lead VIU/RECEBEU algo entra aqui — pergunta, oferta, foco apresentado, avanço de stage, handoff, fala do agente.
type EffectOutcomeMutation =
  | { op: "activate_objective"; effectId: string; plannedObjectiveId: string }   // PlannedObjective -> currentObjective
  | { op: "mark_message_delivered"; effectId: string; messageId: string }
  | { op: "record_offer"; effectId: string; offer: OfferRecord }                 // oferta entra na memória só se enviada
  | { op: "set_presented_vehicle_focus"; effectId: string; vehicle: EntityReference }  // foco apresentado ao lead
  | { op: "mark_photos_sent"; effectId: string; vehicleKey: string; photoIds: string[] }  // só os photoIds CONFIRMADOS (Codex r3 #5)
  | { op: "advance_stage"; effectId: string; stage: ConversationStage }          // avanço de etapa depende de entrega
  | { op: "mark_handoff_completed"; effectId: string; sellerId: string }
  | { op: "append_assistant_turn"; effectId: string; turn: ConversationTurn }    // fala do agente só após enviada
  | { op: "mark_effect_failed"; effectId: string; reason: string };              // falha NÃO avança o estado

type ReducerResult = { ok: true; next: ConversationState } | { ok: false; rejected: { mutation: DecisionMutation | EffectOutcomeMutation; reason: string }[] };

// EffectResult DISCRIMINADO (Codex r3.5 #4) — substitui o "receipt obrigatório":
type EffectResult =
  | { status: "succeeded"; effectId: string; receipt: EffectReceipt }
  | { status: "failed"; effectId: string; error: ToolError }
  | { status: "outcome_uncertain"; effectId: string; metadata: Redacted<{ [k: string]: JsonValue }> };

interface StateReducer {
  // PURO. applyDecision no COMMIT (só fatos do inbound). applyEffectOutcome decide pelo EffectResult:
  //   succeeded -> aplica os onSuccess do efeito (respeitando ReceiptLevel/perItem);
  //   failed    -> aplica mark_effect_failed (estado NÃO avança);
  //   outcome_uncertain -> NÃO aplica (aguarda reconciliação §6); registra o estado de incerteza.
  applyDecision(state: ConversationState, mutations: DecisionMutation[]): ReducerResult;
  applyEffectOutcome(state: ConversationState, onSuccess: EffectOutcomeMutation[], result: EffectResult): ReducerResult;
}
```

### 2.7 PolicyEngine em FASES (recebe QueryResults) + Finalizador central — CORREÇÃO Codex #3/#6

Políticas **não escolhem ação**: retornam veredito (allow/deny) + requisitos/violações. Rodam em **3 momentos** e recebem os **fatos** (`QueryResult[]`). Quem emite a decisão final única é o **Finalizador**.

```ts
type PolicyVerdict = {
  policyId: string;                       // POL-...
  outcome: "allow" | "deny";
  requirements?: SlotName[];              // o que falta p/ liberar (tipado, não string solta)
  violations?: string[];                  // invariantes violados pela proposta/resposta
  detail?: string;
};

interface PolicyEngine {
  // (1) AUTORIZAÇÃO POR CHAMADA (Codex r3 #6): cada QueryCall proposta no loop é autorizada vendo os fatos JÁ
  //     acumulados. Só executa se 'allow'. (Substitui o preQuery de whitelist estática.)
  authorizeQuery(call: QueryCall, ctx: TurnContext, accumulatedFacts: QueryResult[]): PolicyVerdict;
  // (2) PÓS-QUERY: valida a decisão proposta CONTRA OS FATOS coletados (ex.: veículo fora do teto -> deny).
  postQuery(proposal: ProposedDecision, facts: QueryResult[], ctx: TurnContext): PolicyVerdict[];
  // (3) GROUNDING DA RESPOSTA: valida a resposta COMPOSTA contra os fatos (preço/spec/estoque). Não muda ação.
  validateResponse(composed: RenderedResponse, facts: QueryResult[], decision: TurnDecision): PolicyVerdict[];
}

interface Finalizer {
  // ÚNICA autoridade que emite a TurnDecision. Se postQuery dá deny de invariante, substitui a ação por uma
  // segura/conforme (ex.: collect_slot do requirement, ou clarify) — nunca "deixa passar".
  finalize(proposal: ProposedDecision, postQuery: PolicyVerdict[], facts: QueryResult[]): TurnDecision;
}
```

Cadeia de autoridade (uma só decisão): loop `proposeNextQueryOrFinal` (cada `QueryCall` autorizada por `authorizeQuery`) → `postQuery` (allow/deny/requirements/violations sobre os FATOS) → `Finalizer.finalize` (**a única** que emite `TurnDecision`) → compose → `validateResponse` (grounding). Composer e Sender jamais mudam a ação (POL-STATE-003).

### 2.8 Eventos de turno (tipados e versionados) — CORREÇÃO Codex #8

```ts
// EventPayloadMap por tipo (Codex #6): payload TIPADO por evento, sem `unknown`. Cada payload é Redacted<...>.
type EventPayloadMap = {
  ingested: Redacted<{ eventIds: string[]; channel: "whatsapp" }>;
  burst_merged: Redacted<{ eventIds: string[]; cutoff: string }>;
  state_loaded: { conversationId: string; version: number };
  interpreted: Redacted<{ objectiveId?: string; relation: string }>;
  query_executed: { tool: QueryName; ok: boolean; source?: string; ms: number };          // sem input/output crus
  decision_proposed: { proposedAction: TurnAction; reasonCode: string; confidence: number };
  policy_evaluated: { phase: "pre" | "post" | "response"; verdicts: PolicyVerdict[] };
  decision_final: { action: TurnAction; reasonCode: string; effectPlanIds: string[] };
  response_composed: { length: number; effectPlanIds: string[] };
  response_validated: { ok: boolean; violations: string[] };
  state_committed: { version: number; mutationOps: string[] };
  effect_enqueued: { effectId: string; kind: EffectKind; order: number };
  effect_dispatched: { effectId: string; status: EffectStatus; provider?: string };
  effect_failed: { effectId: string; status: EffectStatus; reason: string };
  no_op: { reason: string };
  error: { step: string; loadedVersion?: number; hadExternalEffect: boolean; reason: string };
};
type TurnEventType = keyof EventPayloadMap;

type TurnEvent<T extends TurnEventType = TurnEventType> = {
  eventId: string;
  payloadSchemaVersion: number;          // versionado por type
  correlationId: string;
  conversationId: string;
  turnId: string;
  type: T;
  at: string;
  payload: EventPayloadMap[T];           // TIPADO por type; `Redacted<...>` exigido por construção (Codex #8)
};
```

## 3. Ciclo atômico do turno (engine)

Processamento **at-least-once** (Codex #9): o engine pode rodar mais de uma vez para o mesmo evento. A **ingestão atômica** evita turno duplicado; o resultado é **effectively-once apenas quando a capacidade do provider permite** (idempotent/queryable, §6) — não é garantia incondicional (Codex r3 #5/#8).

```text
INGESTÃO (Codex #1: o INSERT é o dedupe — sem dedupe separado):
1. WhatsAppAdapter.normalize(event) -> RawInbound
2. INSERT INTO v3_inbox (event_id, ...) VALUES (...) ON CONFLICT (event_id) DO NOTHING
   -> linha inserida? processa. conflito (0 linhas)? evento já visto -> no_op idempotente.

PROCESSAMENTO (sob lease; CLAIM do inbox detalhado em §9):
3. lease = CoordinationStore.acquireLease(conversationId)        // lock por conversa
4. burst = claimBurst(conversationId, cutoff=now)                // claim de eventIds 'pending' <= cutoff (§9);
                                                                 //   msgs que CHEGAREM depois ficam p/ o próximo turno
5. (state, version) = StateStore.load(conversationId)            // carga única + versão p/ CAS
6. ctx = buildTurnContext(burst, state, tenantConfig)
7. interp = Interpreter.run(ctx)                                 // responde pendente? muda assunto? combina?

   -- BOUNDED READ-ONLY QUERY LOOP (Codex #4 + r3 #6: autorização POR CHAMADA) --
8. facts = []
   loop (até maxSteps / totalTimeoutMs):
     step = DecisionEngine.proposeNextQueryOrFinal(ctx, facts)
     if step.kind == "final": proposal = step.proposal; break
     if step.kind == "query":
        v = PolicyEngine.authorizeQuery(step.call, ctx, facts)   // autoriza VENDO os fatos já acumulados
        if v.outcome == "allow": facts.push(run(step.call))       // read-only; query proibida NUNCA executa
        else: facts.push({ ok:false, tool: step.call.tool, error:{code:"FORBIDDEN",...} })
   if no "final" (limite atingido): proposal = SAFE_CLARIFY + event(error: query_loop_exhausted)

9. post = PolicyEngine.postQuery(proposal, facts, ctx)           // valida decisão CONTRA OS FATOS (ex.: fora do teto)
10. final = Finalizer.finalize(proposal, post, facts)            // ÚNICA autoridade -> 1 TurnDecision (com effectPlan)

   -- COMPOSE -> VALIDATE -> MATERIALIZE (Codex #2; limite de tentativas Codex r3 #7) --
11. reduced = StateReducer.applyDecision(state, final.decisionMutations)   // só FATOS DO INBOUND; nunca entregue
12. attempt = 0
    loop:
      composed = ResponseComposer.compose(final, facts, ctx)     // texto aterrado; NÃO muda ação
      gv = PolicyEngine.validateResponse(composed, facts, final) // grounding da resposta composta
      if gv ok: break
      composed = DeterministicFallback.fromFacts(final, facts); if valid(composed): break
      if ++attempt >= maxValidationAttempts:                      // LIMITE (Codex r3 #7)
        // TERMINAL SAFE_RESPONSE (Codex r3.5 #1): CANCELA todos os EffectPlans comerciais ORIGINAIS
        // (send_media/crm_write/handoff/schedule/notify). Só permite UM send_message seguro + alerta/dead-letter.
        final = { ...final, action: "reply", effectPlan: [SAFE_SEND_MESSAGE_PLAN] }  // onSuccess vazio/neutro
        composed = SAFE_RESPONSE; emit(alert); deadLetter(turn)   // nunca loop infinito nem silêncio
        break
13. effectIntents = materializeEffects(final.effectPlan, composed)   // SÓ AGORA o payload existe (Codex #2)

COMMIT ATÔMICO (CAS) — estado(FATOS) + decisão + eventos + EffectIntents na MESMA transação (Codex #3):
16. tx:
      UPDATE v3_conversation_state SET version=version+1, state=$reduced.next
        WHERE conversation_id=$id AND version=$version    -- CAS; 0 linhas => conflito => reprocessa
      INSERT v3_state_history, v3_decisions, v3_turn_events
      INSERT v3_effect_outbox (effectIntents: status='pending', idempotency_key, order, depends_on)
      UPDATE v3_inbox SET status='done' (apenas os eventIds DO CLAIM)
17. release lease (em finally — §9)

DESPACHO + RECONCILIAÇÃO (assíncrono; Codex #1/#5, r3 #2/#3):
18. OutboxDispatcher pega 'pending' por (conversation, order), respeitando depends_on:
    - shadow: EffectGate OFF -> status='skipped' (nunca envia/CRM/agenda/transfere)
    - ativo: status='processing' -> executa -> receipt { level: 'accepted' | 'delivered', ... } (Codex r3 #3)
    - ORDEM EXPLÍCITA: send_message(anúncio) order=1 com receipt no nível exigido ANTES de handoff order=2 (Codex #3)
    - send_media de N fotos: receipt POR foto; ledger avança só p/ os photoIds confirmados (Codex r3 #5)

19. EFFECT-OUTCOME-COMMIT (atômico + idempotente — Codex r3 #2), tx SEPARADA do commit da decisão:
      load (state, version)
      if outbox.outcome_applied_at(effectId) já setado: SKIP (idempotente — mesmo effectId não aplica 2x)
      tx:
        StateReducer.applyEffectOutcome(state, mutation, receipt)   // ativa objetivo / avança ledger / stage / handoff
        UPDATE v3_conversation_state ... WHERE version=$version       -- CAS; conflito -> recarrega e reaplica
        INSERT v3_state_history + v3_turn_events
        UPDATE v3_effect_outbox SET outcome_applied_at=now() WHERE effect_id=$e
      -- o NÍVEL exigido por outcome (Codex r3 #3): pergunta/objetivo/handoff = 'delivered' se o provider entrega;
      --   se provider só dá 'accepted' (ex.: uazapi=none), o objetivo ativa em 'accepted' MAS o estado registra
      --   delivery_level='accepted' (nunca afirma 'delivered' sem confirmação real de entrega).

20. INCERTEZA (Codex #5): timeout após possível aceite -> status='outcome_uncertain'. NÃO repete cego.
    Reconcilia por provider_capability (§6): idempotent->retry; queryable->reconcile(); none->revisão/alerta.
    Falha final 'failed': estado NÃO avança + alerta; lead nunca em silêncio (POL-HANDOFF-003).

21. RECUPERAÇÃO (Codex r3 #2): worker varre efeitos 'succeeded' SEM outcome_applied_at e roda o passo 19
    (idempotente) -> garante que todo receipt sucedido vire estado, mesmo se o engine caiu entre 18 e 19.

* qualquer falha -> v3_turn_events{type:"error", step, loadedVersion, hadExternalEffect} -> nunca catch silencioso
```

## 4. Persistência durável (esquema v3 proposto — tabelas EXCLUSIVAS `v3_*`)

> Isolamento total (ADR-005): nenhuma tabela do v2 é alterada. Tudo `v3_*`. Migração entregue como SQL para o DONO aplicar (MCP read-only).

| Tabela | Papel | Campos-chave |
|---|---|---|
| `v3_conversation_state` | snapshot versionado | `conversation_id` (PK), `version`, `tenant_id`, `agent_id`, `lead_id`, `state` (jsonb), `updated_at` |
| `v3_state_history` | histórico/versões p/ replay e rollback | `conversation_id`, `version`, `state` (jsonb), `created_at` |
| `v3_turn_events` | eventos por etapa (replay completo) | `event_id` (PK), `correlation_id`, `conversation_id`, `turn_id`, `type`, `payload` (jsonb, redacted), `at` |
| `v3_inbox` | ingestão durável + **dedupe pelo próprio INSERT** (Codex #1) + burst + **claim** (Codex #7) | `event_id` (PK UNIQUE → `ON CONFLICT DO NOTHING` é o dedupe), `conversation_id`, `raw` (jsonb redacted), `status` (pending/claimed/done/error), `claimed_by`, `turn_id`, `attempts`, `next_retry_at`, `received_at`, `claimed_at` |
| `v3_leases` | lock por conversa (CoordinationStore Postgres) | `conversation_id` (PK), `owner`, `acquired_at`, `expires_at` |
| `v3_query_log` | auditoria das QueryTools (read-only; sem efeito) | `id` (PK), `conversation_id`, `turn_id`, `tool`, `input` (redacted), `result` (redacted), `at` |
| `v3_effect_outbox` | **transactional outbox** dos EffectIntents (Codex #3/#5, r3 #2/#3) | `effect_id` (PK), `idempotency_key` (UNIQUE), `conversation_id`, `turn_id`, `kind`, `payload` (redacted), `order`, `depends_on` (text[]), `status` (**pending/processing/succeeded/failed/outcome_uncertain/skipped**), `provider`, `provider_capability` (idempotent/queryable/none), `receipt_level` (accepted/delivered/null), `attempts`, `next_retry_at`, `provider_receipt` (jsonb), `outcome_applied_at` (idempotência do EffectOutcomeCommit — Codex r3 #2), `last_error`, `created_at`, `dispatched_at` |
| `v3_media_receipts` | receipt POR foto (sucesso parcial de mídia — Codex r3 #5) | `effect_id`, `photo_id`, `status` (succeeded/failed), `provider_receipt` (jsonb), `at` |
| `v3_sensitive_vault` | cofre isolado de CPF/segredos (Codex #8) | `ref` (PK), `kind`, `enc_value` (criptografado em repouso), `enc_alg`, `last4`, `created_at` |
| `v3_decisions` | decisão final por turno | `turn_id` (PK), `conversation_id`, `action`, `reason_code`, `policy_checks` (jsonb), `at` |
| `v3_messages` | mensagens recebidas/enviadas (shadow registra `mode='shadow'` = "would_send", sem envio) | `id`, `conversation_id`, `direction`, `content` (redacted), `mode` (active/shadow), `at` |
| `v3_shadow_comparisons` | comparação v2 × v3 por turno | `turn_id`, `v2_action`, `v3_action`, `agreement`, `notes` |

```ts
type EffectStatus = "pending" | "processing" | "succeeded" | "failed" | "outcome_uncertain" | "skipped";
type ProviderCapability = "idempotent" | "queryable" | "none";   // define COMO reconciliar (Codex #5)
type Redacted<T> = T & { readonly __redacted: true };            // marca por construção (Codex #8)
type RedactedText = Redacted<{ text: string }>;
```

**Atomicidade (POL-STATE-004):** o `commit` da DECISÃO (só FATOS do inbound) é atômico: (a) CAS `UPDATE v3_conversation_state SET version=version+1, state=$reduced WHERE conversation_id=$id AND version=$expected` (0 linhas → conflito → reprocessa); (b) INSERT `v3_state_history` + `v3_decisions` + `v3_turn_events` + **`v3_effect_outbox` (intents 'pending')**; (c) `v3_inbox.status='done'` (eventIds do claim). O **despacho dos efeitos é DEPOIS** (OutboxDispatcher), nunca dentro da decisão. O avanço de estado ENTREGUE acontece no **EffectOutcomeCommit** separado (§3 passo 19), só com receipt. Processamento é **at-least-once**; o resultado é **effectively-once SE** a capacidade do provider permitir (§6) — não é promessa incondicional (Codex r3 #8).

> **`02` é o CONTRATO autoritativo; `00` é a VISÃO** do dono. Ambos devem ser consistentes — onde o esboço de `00` divergir (ex.: `statePatch`), vale este documento.

## 5. CoordinationStore (abstração para Valkey futuro)

> CORREÇÃO Codex #1: o **dedupe NÃO é método do CoordinationStore** — é a ingestão atômica `INSERT ... ON CONFLICT` no `v3_inbox`. O CoordinationStore cuida só de lock/cache.

```ts
interface CoordinationStore {
  acquireLease(key: string, ttlMs: number): Promise<Lease | null>;
  renewLease(lease: Lease, ttlMs: number): Promise<boolean>;
  releaseLease(lease: Lease): Promise<void>;
  getHotState?(key: string): Promise<JsonValue | null>;          // cache opcional (não usado agora)
  setHotState?(key: string, value: JsonValue, ttlMs: number): Promise<void>;
}
```

- **Implementação Fase 0–4:** `PostgresCoordinationStore` (leases em `v3_leases` com `expires_at`). **Dedupe é a ingestão atômica no `v3_inbox` (Codex #1), não método do store.** Sem Redis.
- **Futuro:** `ValkeyCoordinationStore` com a MESMA interface — trocado por config quando métricas (latência/contention/burst) justificarem (decisão do dono). Ver ADR-003.

## 6. Adapters de efeito + OutboxDispatcher (OFF em shadow)

Os efeitos NÃO rodam na decisão. O `OutboxDispatcher` lê `v3_effect_outbox` e executa via adapters, passando pelo `EffectGate`:

```ts
interface EffectGate { readonly enabled: boolean; run<T>(label: string, fn: () => Promise<T>): Promise<T | { skipped: true }>; }

type ReceiptLevel = "accepted" | "delivered";   // Codex r3 #3: aceite ≠ entrega
type EffectReceipt = {
  effectId: string;
  level: ReceiptLevel;                            // o que o provider REALMENTE confirmou
  providerMessageId?: string;
  perItem?: { photoId: string; status: "succeeded" | "failed" }[];  // sucesso PARCIAL de mídia (Codex r3 #5)
  raw: Redacted<{ [k: string]: JsonValue }>;
  at: string;
};
type DispatchOutcome = { status: EffectStatus; receipt?: EffectReceipt };

interface EffectDispatcher<K extends EffectKind = EffectKind> {
  kind: K;
  capability: ProviderCapability;        // idempotent | queryable | none (Codex #5)
  dispatch(intent: EffectIntent<K>, ctx: DispatchContext): Promise<DispatchOutcome>;
  reconcile?(intent: EffectIntent<K>): Promise<DispatchOutcome>;  // queryable -> consulta provider por status/receipt
}
```

**Nível de receipt que ativa cada outcome (Codex r3 #3):** `objetivo/pergunta`, `handoff` e `mensagem entregue` idealmente exigem `delivered`; quando o provider só dá `accepted`, ativa em `accepted` mas o estado grava `delivery_level='accepted'` — **nunca afirma `delivered` sem confirmação real**. `PhotoLedger` avança só pelos `photoId` com `status:'succeeded'` no `perItem`.

**Reconciliação de incerteza (Codex #5):** timeout após possível aceite → `outcome_uncertain`. Ação por `capability`: `idempotent`→retry com a mesma `idempotency_key`; `queryable`→`reconcile()`; `none`→**revisão/alerta** (nunca reenvia cego). `effectively-once` é **propriedade do par (efeito, provider)**, não promessa da chave local.

### Matriz conservadora inicial de providers (Codex r3 — revisar na Fase 2)

| Efeito / provider | capability | reconciliação |
|---|---|---|
| `send_message`/`send_media` (uazapi) | **none** (até validação técnica) | timeout incerto → **revisão/alerta**, não reenvia cego |
| `crm_write` (Supabase) | **idempotent** quando protegido por RPC/transação com chave | retry seguro com a mesma chave |
| `handoff` | **efeitos separados** (msg ao lead + atribuição + notificação), cada um com sua chave/ordem | reconcilia por etapa |
| `schedule_visit` (agenda) | **idempotent só com chave única** do slot | retry só se a chave única garante não-duplicação |

Adapters reutilizam capacidades do v2 (inventário §1) só por trás de contrato: `WhatsAppAdapter` (`uazapiSender_20260524.ts`), `StockAdapter` (BNDV/RevendaMais), `CrmAdapter`, `KnowledgeAdapter`, `LlmAdapter` (provider-agnostic). Em shadow, `EffectGate.enabled=false` → todo efeito vira `skipped` (POL-TOOL-001). **QueryTools (read-only) continuam rodando em shadow** — só os efeitos são bloqueados.

## 9. Claim do inbox e ciclo de vida do burst — CORREÇÃO Codex #7

```text
claimBurst(conversationId, cutoff):
  - seleciona eventIds de v3_inbox WHERE conversation_id=$c AND status='pending' AND received_at <= cutoff
    ORDER BY received_at  -> esses eventIds EXATOS formam o burst do turno
  - UPDATE ... SET status='claimed', claimed_by=$worker, turn_id=$turn, claimed_at=now(), attempts=attempts+1
  - o turno processa SOMENTE os eventIds claimados; mensagens que chegarem com received_at > cutoff
    (ou após o claim) NÃO entram -> ficam 'pending' p/ o PRÓXIMO turno (Codex #7)

renovação/release (em finally):
  - lease é renovado (renewLease) enquanto o turno roda; SEMPRE liberado no finally (sucesso, erro ou exceção)
  - no commit: os eventIds do claim viram status='done' na MESMA tx do CAS

recuperação após lease expirado (worker antigo travado):
  - um claim 'claimed' cujo lease/claimed_at expirou (> claimTTL) volta a ser elegível (next_retry_at)
  - como o processamento é at-least-once + commit idempotente (CAS por versão), reprocessar é seguro:
    se o worker antigo ainda commitar, o CAS de versão de UM deles falha (0 linhas) -> só um turno vence
  - efeitos: idempotency_key no outbox evita duplicar envio mesmo se dois workers materializarem
```

## 7. Provider-agnostic LLM

```ts
interface LlmAdapter {
  // CORREÇÃO Codex #5/#6: o LLM PROPÕE fatos/intenção (mutations + ação proposta), NÃO escreve estado
  // nem produz a decisão final. O reducer aplica as mutations; o Finalizer emite a TurnDecision.
  propose(input: DecisionPrompt): Promise<RawDecisionProposal>;   // p/ DecisionEngine
  compose(input: ComposePrompt): Promise<string>;                 // p/ ResponseComposer (texto aterrado)
}
```

Nenhum contrato cita provider. Há `FakeLlmAdapter` determinístico para testes/shadow. A escolha real (OpenAI/Gemini/Claude/gateway) é um ADR posterior, decidido por custo/latência/qualidade medidos com fakes primeiro.

## 8. O que falta definir (pendências p/ próxima rodada)

- ADR do provider LLM (após fakes).
- Definição do **cofre de valores sensíveis** (`v3_sensitive_vault`) + chave de criptografia do CPF (ADR-006 pendente do dono).
- Loop de processamento do inbox/dispatcher (poll vs trigger) — detalhar no Kernel/Fase 2.
- (Entregues nesta rodada: `05-PLANO-DE-TESTES.md`, `06-ERROS-E-LICOES.md`.)

---

## Contrato runtime F2.5.4B - composicao conversacional

- `StructuredConversationModel` e a porta provider-agnostic para interpret/propose/compose; retorno externo e `unknown` ate decode runtime.
- `ModelBinding` recebe exclusivamente a `TenantRuntimeConfig` validada. Prompt, tenant, agente e versionStamp sao imutaveis; credenciais nao entram no binding.
- `TurnContextPreparer` roda dentro do lease, depois do load do estado, e fornece interpretacao, catalogo e ClaimExtractor para aquele snapshot.
- O modelo pode propor QueryCalls e uma proposta comercial, mas somente PolicyEngine + Finalizer emitem a decisao final.
- Toda mutacao proposta passa pelo decoder e por dry-run do StateReducer antes do commit.
- Excecao de provider e output invalido viram codigos sanitizados e caminho terminal-safe.
- Canary root permanece shadow por construcao e revalida o EffectGate em cada turno.
- O adapter real futuro deve incluir structured outputs e extracao semantica independente para claims automotivos fora do catalogo antes de modo ativo.