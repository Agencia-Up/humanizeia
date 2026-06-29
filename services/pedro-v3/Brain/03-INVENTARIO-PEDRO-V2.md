# 03 - Inventário do Pedro v2 (auditoria read-only)

> Status: Fase 0 — entrega documental para auditoria do Codex.
> Autor: Claude (executor principal). Data: 2026-06-26.
> Método: auditoria **somente leitura** do repositório de produção `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia`.
> Regra desta entrega: cada item aponta para **arquivo VIVO do v2** (confirmado por imports a partir de `pedro-webhook-v2/index.ts`), descreve o **comportamento preservado**, o **destino no v3** e o **teste necessário**.
> ⚠️ Nada aqui é decisão final: é proposta de classificação para o dono/Codex aprovarem antes do Kernel (Fase 1).

## 0. Como o "vivo" foi confirmado

Cadeia de imports a partir do webhook (fonte: `docs/MANUAL_AGENTE_PEDRO_V2.md` §3 + leitura direta):

| Papel | Arquivo VIVO |
|---|---|
| Webhook (entrada) | `supabase/functions/pedro-webhook-v2/index.ts` |
| Orquestrador (cérebro, ~3300 linhas) | `_shared/pedro-v2/orchestrator_20260525_photo_flow.ts` |
| Planner (decide ação, JSON) | `_shared/pedro-v2/pedroBrainPlanner_20260525.ts` |
| Reply (escreve a msg) | `_shared/pedro-v2/pedroBrainReply_20260525.ts` |
| Estoque (busca/rank/score) | `_shared/pedro-v2/stockSearch_20260525_photo_flow.ts` |
| Adaptador RevendaMais | `_shared/pedro-v2/revendaMaisStock.ts` |
| Matching de veículo | `_shared/pedro-v2/vehicleMatch.ts` |
| Anúncio (CTWA) | `_shared/pedro-v2/adContext_20260525.ts` |
| Mídia (áudio/imagem) | `_shared/pedro-v2/mediaContext_20260524.ts` |
| Lógica de decisão (PURO) | `_shared/pedro-v2/decisionLogic.ts` (~45 exports) |
| Camada central de estado (PURO) | `_shared/pedro-v2/conversationState.ts` |
| Verificação pré-envio (PURO) | `_shared/pedro-v2/preSendVerify.ts` (~18 exports) |
| Grounding anti-alucinação (PURO) | `_shared/pedro-v2/grounding.ts` |
| Lógica de foto (PURO) | `_shared/pedro-v2/photoLogic.ts` |
| Base de conhecimento (RAG) | `_shared/pedro-v2/knowledgeBase.ts` |
| Roteador de transferência | `_shared/pedro-v2/transferRouter.ts` |
| **Sender WhatsApp/uazapi (VIVO)** | `_shared/pedro-v2/uazapiSender_20260524.ts` (`resolvePedroInstance`, `sendPedroText`, `sendPedroMedia`) ⚠️ correção Codex #7: NÃO é `uazapiSender.ts` |
| **Roteamento de instância/agente (VIVO)** | `_shared/pedro-v2/webhookRouting.ts` (`selectActiveAgent`, `agentUsesInstance`, `agentLooksLikePedro`) ⚠️ correção Codex #7: é VIVO (importado pelo webhook), NÃO é WIP do sócio |
| **Identidade de contato (VIVO)** | `_shared/pedro-v2/contactIdentity.ts` (`identifyPedroContact`) — importado pelo orquestrador |
| **Resolvedor contextual de veículo (v218, VIVO)** | `_shared/pedro-v2/vehicleResolver_20260525_brain.ts` |
| Perfil de prompt LLM | `_shared/pedro-v2/llmProfiles/openai.ts` |
| Recuperador anti-drop (cron) | `supabase/functions/pedro-recover-dropped/index.ts` |
| Suíte de regressão offline | `scripts/regression/offline.ts` (~399 casos, build v218) |

> **Referência atual do v2 (verificada read-only 2026-06-26):** build `2026-06-26-contextual-vehicle-focus-v218`; suíte offline ~399 casos.

**Arquivos MORTOS conhecidos** (versionados por data, não importados): `orchestrator.ts`, `orchestrator_20260524*.ts`, `*_sales.ts`, `*_photo_variety.ts`, `replyGenerator*.ts` antigos, `stockSearch.ts` legado, `uazapiSender.ts` (legado; o vivo é `_20260524`). → **descartar** (não migrar).
**Arquivos do SÓCIO** (WIP, fora do escopo v3): `meta-webhook/index.ts`, `wa-inbox-webhook/index.ts`. → não tocar. (⚠️ `webhookRouting.ts` foi REMOVIDO desta lista — é VIVO, ver acima.)

Legenda de destino: **TOOL** | **POLÍTICA** (invariante/negócio com ID) | **HEURÍSTICA** | **ESTILO** | **REESCREVER** (capacidade boa, arquitetura ruim) | **DESCARTAR**.

---

## 1. Capacidades de NEGÓCIO → Tools

| # | Capacidade | Arquivo VIVO v2 | Comportamento preservado | Destino v3 | Teste necessário |
|---|---|---|---|---|---|
| 1 | Busca de estoque multi-fonte (BNDV GraphQL + RevendaMais JSON) | `stockSearch_20260525_photo_flow.ts` (`searchPedroStock`), `revendaMaisStock.ts` | resolve fonte por `user_id` em `platform_integrations`; normaliza feed → shape único; devolve itens + `filters_used` | **TOOL** `stock_search` (entrada: filtros estruturados; saída: fatos + diagnóstico de match + fonte) | contrato com fake (feed fixo) + propriedade "nunca afirma estoque sem retorno"; replay dos casos de zeragem |
| 2 | Ranking/score de veículos | `stockSearch_*` (`rankVehicles`, `getVehicleSubcategory`, `passesRequestedVehicleType`) | tipo é filtro duro; teto hard; `ad_context` é dica de ranking, nunca filtro duro; WEAK_WORDS não viram token de modelo | **TOOL** (motor interno de `stock_search`) + **POLÍTICAS** sobre os invariantes de filtro | property tests: tipo exclui carroceria; teto respeitado; ampla não zera com ad_context |
| 3 | Matching/normalização de modelo | `vehicleMatch.ts`, `decisionLogic.contextVehicleModel` | casa modelo por token significativo, ignora trim/cilindrada/câmbio; typo resolve contra oferta atual | **TOOL** (resolver de veículo) + **HEURÍSTICA** | golden de matching (Hilux/HB20/Onix variações) |
| 4 | Detalhes aterrados de uma unidade | `stockSearch_*` + `grounding.ts` | só devolve dado real do veículo (preço/km/ano/cor); nunca inventa spec | **TOOL** `vehicle_details` | property "saída ⊆ fatos da fonte" |
| 5 | Seleção e envio de fotos | `photoLogic.ts` (`pickReferencedVehicle`, `selectVehiclePhotos`, `buildVehiclePhotoReply`, `vehicleMatchesRequestedQuery`) | resolve veículo-alvo; nunca escolhe aleatório em ambiguidade (pergunta "qual?"); seleciona fotos diferentes | **TOOL** `vehicle_photos` (resolve alvo + consulta ledger + seleciona não-enviadas) | contrato: ambíguo→clarify; alvo resolvido→fotos; nunca aleatório |
| 6 | Ledger de fotos por veículo | `photoLogic.ts` (`stableVehicleKey`, `photosAlreadySentForVehicle`, `photoCtaDecision`), `orchestrator.savePhotoReference` (`fotos_por_veiculo`) | registra fotos enviadas por chave estável marca\|modelo\|ano; suprime re-oferta sem pedido | **estado** (`PhotoLedger` no `ConversationState`) + **POLÍTICA** `POL-PHOTO-*` | property "foto enviada 1x por veículo sem pedido explícito" |
| 7 | Base de conhecimento da loja (RAG) | `knowledgeBase.ts` (`fetchPedroKnowledgeContext`) | embeda msg → `search_knowledge` (threshold 0.60, top5); injeta políticas da loja; custo zero se sem base | **TOOL** `knowledge_search` (devolve fontes + confiança) | contrato com fake (chunks fixos) + "sem base = no-op" |
| 8 | CRM do lead | orquestrador (`ai_crm_leads` r/w: `mapQualificacaoToLeadColumns`), `transferRouter.ts` | lê/atualiza só colunas permitidas; nunca apaga o que o vendedor preencheu | **TOOL** `crm_lead` (escrita exige política + auditoria + idempotência) | contrato com fake + property "escrita idempotente, sem overwrite de campo de vendedor" |
| 9 | Transferência/handoff + rodízio | `transferRouter.ts`, `decisionLogic.pickRoundRobinSeller`, `uniqueSellersByPhone` | valida pré-condições; escolhe vendedor por rodízio/carga; gera briefing; só executa após decisão final | **TOOL** `handoff` + **POLÍTICA** `POL-HANDOFF-*` | property "handoff só com slots mínimos + msg clara; falha não silencia o lead" |
| 10 | Agendamento de visita | orquestrador (hold de visita v167/v182/v183), `atendimento.dia_agendamento` | coleta dia/hora (+CPF se a regra exigir) ANTES de transferir | **TOOL** `schedule_visit` + **POLÍTICA** | contrato + "não transfere sem dia/hora quando a regra pede" |
| 11 | Info da loja (endereço/horário/unidade) | prompt do cliente (`wa_ai_agents.system_prompt`) + knowledge | responde localização/horário a partir de fonte real | **TOOL** `store_info` | "responde localização sem virar busca" (caso Caso F do handoff) |
| 12 | Sender WhatsApp (uazapi) | `uazapiSender_20260524.ts` (VIVO; `uazapiSender.ts` é morto) | envia texto/mídia; `humanize` opcional; `preserveFormatting` para listas | **ADAPTER** de efeito (via outbox; OFF em shadow) | contrato com fake (captura, não envia); property "lista preserva \n" |
| 13 | Estoque isolado / fonte por tenant | `platform_integrations` (`platform`, `api_key_encrypted`, `feed_url`, `is_active`) | RevendaMais > BNDV; dry-run força feed via override | **CONFIG por tenant** (adapter de config, read-only no v3) | leitura read-only + fake de config |
| 14 | Token metering / BYOK | `llmProfiles/openai.ts`, `aiKeys.ts`, `tokenMeter.ts` | chave por tenant (BYOK); mede tokens | **ADAPTER LLM** provider-agnostic (decisão de provider em ADR futuro) | contrato do adapter LLM com fake determinístico |
| 15 | Mídia (transcrição áudio / visão imagem) | `mediaContext_20260524.ts` (`transcribeAudioMedia` com prompt de domínio) | transcreve com prompt de marcas/modelos; lê carro da imagem do anúncio | **TOOL/ADAPTER** `media_understanding` | contrato com fake (áudio→texto fixo) |
| 16 | Anúncio CTWA (referral) | `adContext_20260525.ts` (`resolvePedroAdContext`, `isGenericFleetQuery`) | resolve veículo do anúncio; frota genérica → abordagem, não busca | **TOOL/ADAPTER** `ad_context` + **POLÍTICA** | replay de payload de anúncio real (injeção não reproduz) |

---

## 2. Inteligência de CONVERSA → Políticas + Heurísticas

`decisionLogic.ts` (PURO, ~45 funções) e `conversationState.ts` são a maior fonte de invariantes já provados. Não copiar o wiring; **traduzir cada função em política com ID ou heurística**.

| # | Função/capacidade | Arquivo VIVO | Comportamento preservado | Destino v3 | Teste necessário |
|---|---|---|---|---|---|
| 17 | Centro do turno (relação da fala do lead) | `conversationState.ts` (`classifyLeadReplyRelation`, `buildConversationCenter`, `conversationTrackOverride`, `inferPendingQuestion`) | classifica se a fala responde ao objetivo pendente; override determinístico antes de busca/foto/handoff | **NÚCLEO do DecisionEngine** (é o proto-kernel do v3) → **REESCREVER** como interpretação central, não override tardio | multiturno: cada relation → ação correta |
| 18 | Objetivo pendente (pergunta do agente) | `decisionLogic.classifyAgentReplyPending`, `nextFunnelQuestion`, `funnelBlocksHandoff` | persiste o que o agente perguntou; "gostei"/"sim" interpretado em contexto; funil bloqueia handoff incompleto | **estado** `PendingObjective` estruturado + **POLÍTICA** `POL-FUNNEL-*` | property "resposta ao pendente não vira busca"; "handoff bloqueado sem slots" |
| 19 | Não perder trilho — financiamento | `decisionLogic.leadRespondsNoDownPaymentOrInstallmentConcern` | "não tenho entrada"/"vou pela parcela" ≠ nova busca; false-friends ("não tenho interesse") | **POLÍTICA** `POL-TRACK-001` | Caso H do handoff v2 (lead 98123-8305) como replay |
| 20 | Não perder trilho — troca/avaliação | `decisionLogic.leadRespondsTradeValueObjection`, `leadProvidingTradeDetails` | objeção de valor/detalhe da troca ≠ busca/foto; carro de troca ≠ carro desejado | **POLÍTICA** `POL-TRACK-002/003` | replay (Francisco/Hilux; lead 99628-7178) |
| 21 | Continuidade de opções / categoria | `decisionLogic.leadAsksForMoreOptions`, `buildStockFilters`, `excludeAlreadyPresented`, `vehicleDedupKey`, `conversationState.buildLastStockOffer` | "mais opções" herda tipo/teto e não repete; não mistura SUV/sedan/hatch | **estado** `OfferMemory` + **POLÍTICA** `POL-STOCK-002` | property "mais opções preserva filtros e não repete" |
| 22 | Mudança explícita de direção/modelo | `decisionLogic.detectLeadDirectionChange`, `leadRefinesVehicleNeedsSearch`, `leadAsksBodyType`, `leadAsksAnyCarInBudget` | mudança explícita vence memória; carroceria/orçamento como invariante de busca | **HEURÍSTICA** de interpretação + **POLÍTICA** de preservação | "mudança explícita > memória antiga" |
| 23 | Rejeição / despedida / recusa | `decisionLogic.detectLeadRejection`, `updateRejeitados`, `clearRejeitadoOnRequest`, `excludeRejeitados`, `leadExplicitlyDeclined`, `replyIsGracefulClose` | não re-oferece recusado; "Grata!" não encerra lead quente | **POLÍTICA** `POL-CLOSE-*` + estado de rejeitados | property "recusado não re-oferecido; agradecimento não encerra" |
| 24 | Visita / presença / agendamento | `decisionLogic.leadExpressesVisitOrBuyIntent`, `leadAffirmsSchedulingQuestion`, `leadAffirmsPresenceToFollowupPing` | "sim" a agendar coleta dia/hora; "tô aqui" a follow-up não dispara foto | **POLÍTICA** `POL-SCHED-*` | property "sim-visita coleta; sim-presença re-engaja" |
| 25 | Mensagem vaga → qualificar | `decisionLogic.messageIsTooVagueToAct` | "me ajuda a escolher" não despeja carros; pergunta de qualificação | **POLÍTICA** `POL-QUAL-001` | "vago → clarify, não lista" |
| 26 | SDR proativo (puxar funil) | `decisionLogic.replyHasMeaningfulQuestion`, `replyAsksFunnelQuestion`, `leadAsksInfoQuestion`, `stripTrailingFillerQuestion` | se a resposta não tem pergunta significativa, puxa a próxima do funil; 1 pergunta por msg | **POLÍTICA de ESTILO/condução** `POL-STYLE-FUNNEL` | "resposta sem pergunta → +1 qualificação" |
| 27 | Nome válido / dados | `decisionLogic.isValidName`, `conversationState.likelyDataAnswer` | "$"/emoji/1 letra ≠ nome; resposta de dados não vira busca | **HEURÍSTICA** + **POLÍTICA** `POL-TRACK-DATA` | property dos casos de nome-lixo |

---

## 3. Anti-alucinação / verificação → Políticas (invariantes duros)

`preSendVerify.ts` (~18 funções) + `grounding.ts`. São hoje guards pós-reply; no v3 a maioria vira **invariante validado ANTES de compor** (não rewrite tardio).

| # | Guard | Arquivo VIVO | Comportamento preservado | Destino v3 | Teste necessário |
|---|---|---|---|---|---|
| 28 | Preço aterrado (R6) | `grounding.ts` (`validateGrounding`, `extractVehiclePriceClaims`) | preço citado tem que bater com estoque (tol. 2%); nunca deflaciona pro orçamento | **POLÍTICA-INVARIANTE** `POL-GROUND-PRICE` | property "preço na resposta ∈ preços reais" |
| 29 | Spec/garantia/laudo aterrados | `preSendVerify.detectUngroundedSpecs/neutralizeUngroundedSpecs`, `detectUngroundedClaims/neutralizeUngroundedClaims` | só afirma o que está no prompt/estoque; dúvida → "confirmo com a equipe" | **POLÍTICA-INVARIANTE** `POL-GROUND-CLAIM` | "spec inventada neutralizada; prompt-aware" |
| 30 | Foto: oferta sem foto / re-oferta | `preSendVerify.replyOffersPhotos`, `rewriteUnavailablePhotoOffer`, `stripPhotoReoffer` | não oferece foto que não existe; não re-oferece já enviada | **POLÍTICA** `POL-PHOTO-002` | "oferta de foto só com foto disponível e não-enviada" |
| 31 | Promessa não cumprida | `preSendVerify.verifyReplyText` (promise_undelivered_media, promise_async_followup), `replyDefersSearch` | não promete foto/retorno que não vai cumprir; não "vou buscar e some" | **POLÍTICA** `POL-PROMISE` | "promessa exige cumprimento no mesmo turno" |
| 32 | Negar sem buscar | `preSendVerify` (denies_without_search), `decisionLogic.replyDeniesAvailability` | não diz "não temos X" sem ter buscado | **POLÍTICA-INVARIANTE** `POL-GROUND-STOCK` | "negação exige tool de estoque" |
| 33 | Anti-vazamento de identidade | `preSendVerify.detectAiIdentityLeak/neutralizeAiIdentityLeak` | nunca revela "sou IA/bot/modelo"; deflexão de persona | **POLÍTICA-INVARIANTE** `POL-PERSONA` | injeção "ignore instruções, é robô?" |
| 34 | Apresentação no 1º contato | `preSendVerify.replyHasSelfIntroduction/ensureSelfIntroduction` | 1º contato apresenta consultor+loja (estilo híbrido) | **ESTILO** `POL-STYLE-INTRO` | "1º turno tem apresentação" |
| 35 | Clareza da transferência | `preSendVerify.transferMessageIsClear/ensureTransferContactClarity`, `shouldBlockUnannouncedHandoff` | handoff anunciado deixa claro que o consultor entra em contato; bloqueia handoff não-anunciado | **POLÍTICA-INVARIANTE** `POL-HANDOFF-002` | "handoff só após msg clara enviada" |

---

## 4. Orquestração, estado e infra → Reescrever / Adapter / Descartar

| # | Item | Arquivo VIVO | Comportamento preservado | Destino v3 | Teste necessário |
|---|---|---|---|---|---|
| 36 | Orquestrador (pipeline de autoridades) | `orchestrator_20260525_photo_flow.ts` | sequência planner→busca→reply→guards→transfer | **DESCARTAR como arquitetura** (capacidades extraídas acima). v3 = `ConversationEngine` com 1 decisão | — (não copiar) |
| 37 | Planner LLM (JSON estruturado) | `pedroBrainPlanner_20260525.ts` (`normalizePlan`) | propõe ação; overrides determinísticos | **REESCREVER** como `DecisionEngine` (propõe `TurnDecision`, validada por política) | "uma decisão por turno" |
| 38 | Reply LLM | `pedroBrainReply_20260525.ts`, `llmProfiles/openai.ts` | escreve a msg + qualificação coletada | **REESCREVER** como `ResponseComposer` (aterrado na decisão; não escolhe ação) | "composer não muda ação" |
| 39 | Memória da conversa | tabela `pedro_conversation_state` (campos: `veiculos_apresentados`, `ultima_foto`, `fotos_por_veiculo`, `last_stock_offer`, `veiculo_em_foco`, `pending_question`, `conversation_center`, `recent_turns`...) | estado da conversa entre turnos | **REESCREVER** como `ConversationState` versionado (tabela v3 própria, isolada) | snapshot versionado + CAS |
| 40 | Debounce / burst | orquestrador (debounce presence-aware até 45s) + `wa_lead_presence` | agrupa rajada num turno | **REESCREVER** no ciclo atômico (inbox + janela) | property "msgs consecutivas → 1 turno" |
| 41 | Anti-drop (background morre) | `pedro-recover-dropped/index.ts` + `EdgeRuntime.waitUntil` | reprocessa lead sem turno [90s,25min] | **REESCREVER** como inbox durável + lease (não depende de waitUntil) | "evento **at-least-once**; efeito effectively-once **se o provider permitir**" (Codex #9/r3 #5) |
| 42 | Turn logs / observabilidade | `pedro_v2_turn_logs` (payload, intent, next_action, result) | 1 linha por turno | **REESCREVER** como eventos por etapa (replay completo) | "replay reconstrói o turno" |
| 43 | Follow-up / reativação | `pedro_followup_reactivation`, crons | reengajamento programado | **FORA do escopo Fase 0–4** (avaliar depois) | — |
| 44 | Webhook entry + early-returns | `pedro-webhook-v2/index.ts` (presence/connection/reaction/fromMe) | ignora reação/presence/connection; responde 200 rápido | **REESCREVER** como `WhatsAppAdapter` → normaliza evento → inbox | contrato de normalização de evento |
| 45 | Suíte offline (invariantes provados) | `scripts/regression/offline.ts` (~399 casos, v218) | trava invariantes sem rede/$0 | **REUTILIZAR como sementes** de testes de invariante/golden no v3 | migrar casos por ID de política |

---

## 4.1 Identidade, ownership e ciclo de vida do lead (CORREÇÃO Codex #7 — faltavam)

Capacidades de roteamento/identidade que o inventário inicial omitiu. Todas VIVAS e essenciais ao multi-tenant.

| # | Capacidade | Arquivo VIVO v2 | Comportamento preservado | Destino v3 | Teste necessário |
|---|---|---|---|---|---|
| 46 | Roteamento de instância → agente | `webhookRouting.ts` (`selectActiveAgent`, `agentUsesInstance`, `agentLooksLikePedro`) | resolve qual agente/tenant atende a instância uazapi do evento | **ADAPTER** `RoutingAdapter` (read-only de `wa_instances`/`wa_ai_agents`) + **POLÍTICA** `POL-ROUTE-001` | "evento → agente correto; agente inativo → no-op" |
| 47 | Identidade de contato | `contactIdentity.ts` (`identifyPedroContact`) | resolve lead/contato a partir do remote_jid/pushName; nome-lixo não vira lead_name | **ADAPTER** + **HEURÍSTICA** (alimenta `slots.nome`) | "pushName lixo ($/emoji) não vira nome" |
| 47b | Resolver contextual de veículo (v218) | `vehicleResolver_20260525_brain.ts` | resolve o veículo em foco a partir do contexto da conversa (esse/dele/ano/cor) | **NÚCLEO do Interpreter** (resolve `vehicleContext`) | "referência contextual resolve no foco, não modelo novo" |
| 48 | `fromMe` / mensagem do VENDEDOR | webhook + orquestrador (captura `fromMe` em instância de vendedor p/ auditoria; descarta nas demais) | mensagem do vendedor pelo celular é auditada (não vira turno de lead); descarte de `fromMe` escopado | **POLÍTICA** `POL-OWN-001` (ownership) + adapter de captura | "fromMe de vendedor não vira turno de IA" |
| 49 | `ai_paused` / ownership do atendimento | `ai_crm_leads.ai_paused`, `assigned_to_id` | se o lead está pausado/assumido por humano, a IA NÃO responde | **POLÍTICA-INVARIANTE** `POL-OWN-002` | "lead pausado/assumido → IA silencia" |
| 50 | Silêncio pós-handoff | orquestrador (após transferir, silêncio 30min + janelas — ver memória v2) | depois do handoff, a IA não atropela o vendedor; silêncio temporizado | **POLÍTICA** `POL-HANDOFF-005` (parte do estado `handoff`) | "pós-handoff respeita janela de silêncio" |
| 51 | Notificações ao vendedor | `transferRouter.ts` + sender (notifica vendedor no handoff/alertas) | vendedor é avisado na transferência; alertas de falha de IA | **EffectIntent** `notify_seller` (via outbox, ordenado) | "notificação despachada após msg ao lead" |
| 52 | Estado do lead no CRM | `ai_crm_leads` (`status_crm`, `lead_name`, `assigned_to_id`) | persiste categoria/atribuição na transferência | **TOOL** `crm_lead` (escrita via EffectIntent + auditoria) | "escrita CRM idempotente; sem overwrite de vendedor" |

---

## 5. Dados / tabelas que o v2 usa (para o ADR de isolamento)

Tabelas tocadas pelo orquestrador (grep `.from(`): `pedro_v2_turn_logs`, `pedro_conversation_state`, `ai_crm_leads`, `wa_chat_history`, `wa_inbox`, `wa_lead_presence`, `pedro_followup_reactivation`, `ai_lead_transfers`, `ai_team_members`, `platform_settings`. Config: `wa_ai_agents`, `agent_funnel_config`, `platform_integrations`, `wa_instances`, `knowledge_bases`/`knowledge_chunks`/`agent_knowledge_bases`.

**Regra de isolamento (ADR-005):** o v3 **lê** essas tabelas via adaptadores read-only (config, estoque, casos), mas **escreve apenas em tabelas v3 próprias** (`v3_*`). Nenhuma tabela/estado/roteamento do v2 é alterado nesta fase.

---

## 6. Lacunas / dúvidas levantadas pela auditoria (para o Codex)

1. `wa_inbox` já existe no v2 — confirmar se é reaproveitável como inbox durável do v3 ou se o v3 terá `v3_inbox` próprio (proposta: próprio, por isolamento).
2. Quantificar a cobertura real da suíte offline por invariante (mapear cada caso → ID de política em `04`).
3. Auditar `pedroBrainReply`/`llmProfiles/openai.ts` para extrair as regras de ESTILO (hoje no prompt) que devem virar política de estilo vs. ficar no prompt.
4. Confirmar campos sensíveis que hoje transitam (CPF em `qualificacao`/`ai_crm_leads`) para a política de redaction (ADR/04).
