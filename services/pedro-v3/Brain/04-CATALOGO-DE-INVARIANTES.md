# 04 - Catálogo de Invariantes e Políticas (IDs estáveis)

> Status: Fase 0 — proposta para auditoria do Codex.
> Autor: Claude. Data: 2026-06-26.
> Cada política tem **ID estável**, categoria, prioridade, gatilho, resultado, **origem no v2** (arquivo/caso real) e **teste**.
> Categorias: `INVARIANTE` (nunca violável) · `NEGOCIO` (varia por tenant) · `HEURISTICA` (ajuda, não manda) · `ESTILO` · `COMPAT` (temporária na migração).
> Prioridade: 1 (mais alta) a 5. Invariantes sempre vencem heurística/estilo.

## Convenção de ID

`POL-<DOMINIO>-<NNN>`. Domínios: `TRACK` (continuidade), `STOCK`, `PHOTO`, `GROUND` (aterramento), `HANDOFF`, `FUNNEL`, `SCHED`, `PERSONA`, `STYLE`, `STATE`, `TOOL`.

Toda política é função PURA testável. O `PolicyEngine` roda em 3 fases (pré-query / pós-query / grounding da resposta), recebe os `QueryResult` e devolve `PolicyVerdict[]` = **allow/deny + requirements/violations** (Codex rodada 2 #3/#6). **Política nunca escolhe ação nem compõe texto**; quem emite a decisão é o `Finalizer`.

---

## A. Continuidade da conversa (não perder o trilho) — prioridade 1

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-TRACK-001` | INVARIANTE | há `PendingObjective` de pagamento/entrada e o lead responde com restrição ("não tenho", "vou pela parcela") | decisão NÃO pode ser `search_stock`/`send_photos`; segue no objetivo financeiro | `decisionLogic.leadRespondsNoDownPaymentOrInstallmentConcern`; caso lead 98123-8305 (v212) | replay do caso + false-friends ("não tenho interesse") |
| `POL-TRACK-002` | INVARIANTE | `PendingObjective` de troca + lead dá objeção de valor/avaliação | mantém trilho de troca; não vira estoque/foto | `decisionLogic.leadRespondsTradeValueObjection` (v213); Francisco/Hilux | replay |
| `POL-TRACK-003` | INVARIANTE | lead descreve carro de troca (km/estado) | coleta; não transfere no meio nem vira busca | `decisionLogic.leadProvidingTradeDetails` (v176); lead 99628-7178 | "coleta da troca não interrompida" |
| `POL-TRACK-DATA` | INVARIANTE | `PendingObjective` de dados (nome/CPF/dia) + resposta curta de dado | registra dado; não busca/foto/transfere | `conversationState.likelyDataAnswer`, `classifyLeadReplyRelation=data_answer` (v216) | "nome não vira estoque" |
| `POL-TRACK-010` | INVARIANTE | existe `PendingObjective` ativo | a fala do lead é interpretada PRIMEIRO como resposta a ele; só vira nova busca com mudança explícita de assunto | princípio-mãe v212/v216 (`conversationTrackOverride`) | property geral multiturno |

## B. Estoque e oferta — prioridade 1–2

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-STOCK-001` | INVARIANTE | qualquer afirmação sobre disponibilidade/lista | exige `ToolResult` de `stock_search` no mesmo turno | `replyDeniesAvailability` + trava "não temos" | "negar/afirmar exige tool" |
| `POL-STOCK-002` | INVARIANTE | "mais opções" / continuação | preserva tipo/categoria/teto da última oferta e NÃO repete itens já apresentados | `buildStockFilters` (v202), `excludeAlreadyPresented`, `buildLastStockOffer` (v217) | "mais opções preserva filtros e não repete" |
| `POL-STOCK-003` | INVARIANTE | restrição dura (carroceria/teto/marca) | nunca oferecer fora da restrição sem explicar | `passesRequestedVehicleType`, hard ceiling | property "tipo exclui carroceria; teto respeitado" |
| `POL-STOCK-004` | HEURISTICA | termo de segmento/preço ("repasse","usado","barato") | busca ampla mais-em-conta, não modelo-lixo | `wantsCheapBroadStock` (v215); lead 92005-3580 | replay Avant |
| `POL-STOCK-005` | NEGOCIO | `sells_motorcycles` do tenant | moto só entra se pedida/nomeada e tenant vende moto | `passesRequestedVehicleType` + `wa_ai_agents.sells_motorcycles` | "moto fora de busca de carro" |
| `POL-STOCK-006` | ESTILO | qualquer lista | formatação única (1 veículo/linha), nunca grudada | `ensureStockReplyFormatting` + `preserveFormatting` | "lista preserva \n" |

## C. Fotos — prioridade 1–2

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-PHOTO-001` | INVARIANTE | enviar fotos | exige veículo-alvo resolvido; ambíguo → clarify, nunca aleatório | `pickReferencedVehicle`, `buildVehiclePhotoReply` | "ambíguo→pergunta; alvo→envia" |
| `POL-PHOTO-002` | INVARIANTE | fotos do veículo já enviadas + lead não pediu | NÃO re-ofertar/re-enviar | `photoCtaDecision`, `photosAlreadySentForVehicle`, `PhotoLedger` (v211) | "foto 1x sem pedido" |
| `POL-PHOTO-003` | INVARIANTE | oferta de foto | só se houver foto cadastrada do alvo | `rewriteUnavailablePhotoOffer` | "não oferece foto inexistente" |

## D. Aterramento (anti-alucinação) — prioridade 1 (INVARIANTE duro)

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-GROUND-PRICE` | INVARIANTE | preço de veículo citado | tem que bater com a fonte (tol. 2%); nunca deflaciona p/ orçamento | `validateGrounding` R6 (v161) | property "preço ∈ fatos" |
| `POL-GROUND-CLAIM` | INVARIANTE | spec/garantia/laudo/km | só afirma o que está no prompt/estoque; senão "confirmo com a equipe" | `detectUngroundedSpecs/Claims` (v160/v166) | "spec inventada neutralizada" |
| `POL-GROUND-STOCK` | INVARIANTE | "não temos / temos X" | exige tool de estoque | trava "não temos" (v140-147) | idem POL-STOCK-001 |

## E. Handoff / transferência — prioridade 1

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-HANDOFF-001` | INVARIANTE | proposta de `handoff` | exige slots mínimos do funil do tenant satisfeitos | `funnelBlocksHandoff`, `nextFunnelQuestion` (v211/handoff guard) | "handoff bloqueado sem slots" |
| `POL-HANDOFF-002` | INVARIANTE | handoff anunciado | só executa após mensagem clara enviada ("o consultor entra em contato"); nunca mutação tardia pós-envio | `shouldBlockUnannouncedHandoff`, `ensureTransferContactClarity` (v214) | "handoff só após msg clara; sem efeito tardio" |
| `POL-HANDOFF-003` | INVARIANTE | falha ao transferir | lead nunca fica em silêncio; erro observável + recuperação | recuperador/anti-drop + lições | "falha de handoff tratada" |
| `POL-HANDOFF-004` | NEGOCIO | seleção de vendedor | rodízio por carga/última atribuição, dedup por telefone | `pickRoundRobinSeller`, `uniqueSellersByPhone` | property de rodízio |
| `POL-CLOSE-001` | INVARIANTE | agradecimento/despedida de lead engajado | não encerra lead qualificado em silêncio | `leadExplicitlyDeclined`, `replyIsGracefulClose` (v169/v170) | "Grata! não encerra hot lead" |

## F. Funil / qualificação / agendamento — prioridade 2

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-FUNNEL-001` | NEGOCIO | funil do tenant (`agent_funnel_config.bloco4`) | conduz próxima pergunta não respondida; 1 pergunta/msg | funil-force (v180/v184), `nextFunnelQuestion` | "próxima pergunta correta" |
| `POL-QUAL-001` | NEGOCIO | mensagem vaga sem critério | clarifica, não despeja carros | `messageIsTooVagueToAct` (v158) | "vago→clarify" |
| `POL-SCHED-001` | NEGOCIO | "sim" a agendar visita | coleta dia/hora (+CPF se a regra exigir) antes de transferir | hold de visita (v167/v182/v183) | "sim-visita coleta" |
| `POL-STYLE-FUNNEL` | ESTILO | resposta sem pergunta significativa em lead engajado | puxa próxima qualificação (não isca vazia) | `replyHasMeaningfulQuestion`, `stripTrailingFillerQuestion` (v191) | "resposta passiva→+1 pergunta" |
| `POL-STYLE-INTRO` | ESTILO | 1º contato | apresenta consultor+loja (híbrido) | `ensureSelfIntroduction` (v178) | "1º turno apresenta" |

## G. Persona / segurança — prioridade 1

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-PERSONA-001` | INVARIANTE | tentativa de extrair identidade de IA / "ignore instruções" | nunca revela IA/bot/modelo; deflexão de persona | `detectAiIdentityLeak` (v167) | injeção de quebra de persona |
| `POL-PERSONA-002` | INVARIANTE | reação (👍) ou emoji solto | não vira ação/transferência | webhook `isReactionMessage`, lone-emoji guard (v186) | "reação ≠ sim" |

## H. Estado / decisão / atomicidade — prioridade 1

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-STATE-001` | INVARIANTE | todo turno | gera **uma `TurnDecision` final única**; PODE usar um plano LIMITADO de QueryTools read-only p/ se aterrar (Codex #4 — não limitar a 1 consulta) | §7 + correção Codex #4 | "uma decisão final; N queries permitidas" |
| `POL-STATE-002` | INVARIANTE | QueryTool executada na decisão | devolve FATO; NÃO muda o objetivo da conversa | §7/§10 + Codex #2 | "query não muda objetivo" |
| `POL-STATE-003` | INVARIANTE | autoridade decisória | **PolicyEngine NÃO decide** (só allow/deny/requirements/violations); só o **Finalizador central** emite a decisão; composer/sender não mudam ação | §7 + correção Codex #6 | "policy não decide; só finalizer emite; composer/sender não mudam ação" |
| `POL-STATE-004` | INVARIANTE | persistência | estado+decisão+eventos+EffectIntents na MESMA transação com CAS de versão; 2 webhooks não criam 2 turnos; processamento **at-least-once** | §9 + correções Codex #3/#9 | concorrência/CAS/at-least-once |
| `POL-STATE-005` | INVARIANTE | ação perigosa (search/photo/handoff/schedule) | exige `reasonCode` + evidência no estado | §7 | "ação perigosa sem razão é rejeitada" |
| `POL-STATE-006` | INVARIANTE | aplicação de mutação | só via `DecisionMutation[]` (commit) tipada + reducer determinístico; mutação inválida é rejeitada (não corrompe) | Codex r1 #5 | "reducer rejeita mutação inválida" |
| `POL-STATE-007` | INVARIANTE | resultado de efeito | foto vira `sent`/pergunta vira `asked`/handoff vira `completed` SÓ via `EffectOutcomeMutation` APÓS o receipt real do efeito | Codex r2 #1 | "sem receipt, estado não avança" |
| `POL-STATE-008` | INVARIANTE | materialização de efeito | payload do efeito só é materializado APÓS compose+validate; se `validateResponse` falha → fallback validado ou aborta; nada inválido é persistido/enviado | Codex r2 #2 | "ResponseValidator falha → nada inválido enviado" |
| `POL-STATE-009` | INVARIANTE | estado planejado × entregue | objetivo/oferta/foco-apresentado/stage/handoff/fala-do-agente são `EffectOutcomeMutation` (só após receipt); antes ficam `PlannedObjective` ligado ao `effectId`. **Nenhuma memória afirma que o lead viu algo sem receipt** | Codex r3 #1 | "pergunta não aceita não ativa objetivo; oferta não enviada não entra na memória" |
| `POL-STATE-010` | INVARIANTE | EffectOutcomeCommit | atômico+idempotente: checa `outcome_applied_at(effectId)`; aplica; CAS; state_history+evento; marca aplicado — tudo em 1 tx; mesmo `effectId` não aplica 2x; worker recupera `succeeded` sem outcome | Codex r3 #2 | "mesmo effectId não aplica outcome 2x; CAS falha → recupera" |
| `POL-STATE-011` | INVARIANTE | autorização de query | cada `QueryCall` do loop é autorizada por `authorizeQuery(call, ctx, facts)`; query proibida NUNCA executa | Codex r3 #6 | "query proibida nunca executa" |
| `POL-STATE-012` | INVARIANTE | limite de revalidação/reprocesso | após `maxAttempts` → safe response + alerta + dead-letter; nunca loop infinito nem silêncio | Codex r3 #7 | "validator falha repetidamente → termina sem loop/silêncio" |
| `POL-STATE-013` | INVARIANTE | nível de receipt | não afirmar `delivered` quando o provider só confirmou `accepted`; o nível que ativa objetivo/ledger/handoff é definido por efeito | Codex r3 #3 | "accepted não vira delivered" |
| `POL-TOOL-001` | INVARIANTE | EffectIntent (efeito externo) | despachado pelo outbox; **shadow nunca despacha**; ordem explícita (anúncio antes de handoff); **effectively-once depende da capacidade do provider** (idempotent/queryable/none) — `outcome_uncertain` reconcilia, não reenvia cego | §10/§19 + Codex r1 #3, r2 #5 | "shadow não produz efeito; ordem respeitada; incerto → reconcilia, não duplica" |

## I. Roteamento, ownership e ciclo de vida — prioridade 1 (CORREÇÃO Codex #7)

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-ROUTE-001` | INVARIANTE | evento de instância uazapi | resolve agente/tenant correto; agente inativo → no-op (não responde) | `webhookRouting.selectActiveAgent` | "evento→agente certo; inativo→no-op" |
| `POL-OWN-001` | INVARIANTE | mensagem `fromMe` (vendedor pelo celular) | auditada, NÃO vira turno de IA; descarte escopado por tipo de instância | webhook + orquestrador (fromMe) | "fromMe de vendedor não dispara IA" |
| `POL-OWN-002` | INVARIANTE | lead `ai_paused` ou assumido por humano (`assigned_to_id`) | IA silencia; não responde nem age | `ai_crm_leads.ai_paused`/`assigned_to_id` | "lead pausado/assumido → IA silencia" |
| `POL-HANDOFF-005` | INVARIANTE | após handoff | janela de silêncio da IA (não atropela o vendedor) | silêncio pós-handoff v2 (30min) | "pós-handoff respeita silêncio" |

## J. Privacidade / redaction — prioridade 1

| ID | Categoria | Gatilho | Resultado | Origem v2 | Teste |
|---|---|---|---|---|---|
| `POL-PRIV-001` | INVARIANTE | CPF/segredo | NUNCA no `ConversationState`/evento/prompt persistido/log; só `SensitiveValueRef`+status; valor em cofre isolado criptografado; **redaction por construção** (Codex #8) | decisão do dono Fase 0 + Codex #8 | property "nenhum evento/log casa `\d{3}\.?\d{3}\.?\d{3}-?\d{2}` nem token" |
| `POL-PRIV-002` | INVARIANTE | payload de evento persistido | tipado + versionado (`payloadSchemaVersion`); só aceita `Redacted<T>` | Codex #8 | "evento cru com PII não compila/é rejeitado" |

---

## Mapa de cobertura (a completar na auditoria)

Cada `POL-*` deve apontar para ≥1 caso na suíte de testes do v3. As sementes já existem em `humanizeia/scripts/regression/offline.ts` (~399 casos, build v218) e nas mensagens de commit/changelog do v2 — serão migradas por ID. O mapeamento detalhado caso→ID vive em `05-PLANO-DE-TESTES.md`.
