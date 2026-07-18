// ============================================================================
// response-draft-schema.ts — F7-4: UM contrato json_schema strict do ResponseDraft
// compartilhado pelos adapters de `compose` (structured-json-model, openai-chat-model).
//
// Elimina response_format:{type:"json_object"} ("must contain json") nos caminhos LLM
// ativos, trocando por response_format:{type:"json_schema",json_schema:{strict,schema}}.
// O compose retorna ResponseDraft {parts} — shape bem definido, migra em strict:true.
// interpret (TurnInterpretation) e propose (DecisionStep) usam o MESMO transporte
// json_schema mas em strict:false: os decoders (prompt-bound-conversation) REJEITAM
// campos opcionais preenchidos como null, então strict:true forçaria nullable-null e
// quebraria o decode. strict:false remove o "must contain json" sem sobre-restringir.
//
// O shape do draft espelha domain/decision.ts ResponsePart (5 variantes) e é validado
// no decode por prompt-bound-conversation.validResponsePart / openai-agent-brain.#decodePart.
// ============================================================================

const S_STR = { type: "string" } as const;
const S_STR_NULL = { type: ["string", "null"] } as const;

// strict mode exige additionalProperties:false + todos os campos em required.
export function strictObject(required: readonly string[], properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: [...required], properties };
}

// ResponseDraft {parts:[...]} — cada part é uma das 5 variantes (anyOf discriminado por `type`).
// vehicleKey/slotName do money_ref ficam nullable pois só uma delas se aplica por `source.kind`;
// o decoder lê a que corresponde ao kind e ignora a null.
export function responseDraftJsonSchema(): Record<string, unknown> {
  const partText = strictObject(["type", "content"], { type: { type: "string", enum: ["text"] }, content: S_STR });
  const partBreak = strictObject(["type"], { type: { type: "string", enum: ["message_break"] } });
  const partVehRef = strictObject(["type", "vehicleKey", "field"], {
    type: { type: "string", enum: ["vehicle_ref"] }, vehicleKey: S_STR,
    field: { type: "string", enum: ["marca", "modelo", "ano", "km", "cambio", "cor"] },
  });
  const partMoney = strictObject(["type", "role", "source"], {
    type: { type: "string", enum: ["money_ref"] },
    role: { type: "string", enum: ["vehicle_price", "down_payment", "installment", "budget"] },
    source: strictObject(["kind", "vehicleKey", "slotName"], {
      kind: { type: "string", enum: ["vehicle_fact", "slot_value"] }, vehicleKey: S_STR_NULL, slotName: S_STR_NULL,
    }),
  });
  const partOffer = strictObject(["type", "vehicleKeys"], {
    type: { type: "string", enum: ["vehicle_offer_list"] }, vehicleKeys: { type: "array", items: S_STR },
  });
  return strictObject(["parts"], { parts: { type: "array", items: { anyOf: [partText, partBreak, partVehRef, partMoney, partOffer] } } });
}

export function responseDraftResponseFormat(): Record<string, unknown> {
  return { type: "json_schema", json_schema: { name: "response_draft", strict: true, schema: responseDraftJsonSchema() } };
}

// TurnRelation (domain/decision.ts). Mantido em sincronia com o decoder RELATIONS.
const TURN_RELATIONS = ["answers_pending", "direction_change", "continues_offer", "asks_vehicle_detail", "ambiguous", "unrelated"] as const;

// interpret: json_schema strict:false. required só o discriminante `relation`; os opcionais
// (intentSummary, extractedEntities) NÃO entram em required — o modelo pode omiti-los e o
// decoder de interpret não recebe null (que rejeitaria).
export function turnInterpretationResponseFormat(): Record<string, unknown> {
  const schema = {
    type: "object",
    additionalProperties: true,
    required: ["relation"],
    properties: {
      relation: { type: "string", enum: [...TURN_RELATIONS] },
      intentSummary: { type: "string" },
      extractedEntities: {
        type: "object",
        additionalProperties: true,
        properties: {
          model: { type: "string" },
          models: { type: "array", items: { type: "string" } },
          price: { type: "number" },
        },
      },
    },
  };
  return { type: "json_schema", json_schema: { name: "turn_interpretation", strict: false, schema } };
}

// propose: DecisionStep = {kind:"query",call} | {kind:"final",proposal}. Shape grande e
// arriscado (ProposedDecision com união de 6 effect kinds + DecisionMutation[]); em strict:false
// só ancoramos o discriminante `kind`. Remove o "must contain json" sem forçar o decoder
// (prompt-bound-conversation) a lidar com nullable-null em dezenas de campos opcionais.
export function decisionStepResponseFormat(): Record<string, unknown> {
  const schema = {
    type: "object",
    additionalProperties: true,
    required: ["kind"],
    properties: {
      kind: { type: "string", enum: ["query", "final"] },
      call: { type: "object", additionalProperties: true },
      proposal: { type: "object", additionalProperties: true },
    },
  };
  return { type: "json_schema", json_schema: { name: "decision_step", strict: false, schema } };
}

export function responseFormatForOperation(operation: "interpret" | "propose" | "compose"): Record<string, unknown> {
  if (operation === "compose") return responseDraftResponseFormat();
  if (operation === "interpret") return turnInterpretationResponseFormat();
  return decisionStepResponseFormat();
}
