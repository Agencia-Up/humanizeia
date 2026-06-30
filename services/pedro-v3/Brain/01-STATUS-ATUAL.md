# 01 - Status Atual do Pedro v3

> Atualize ao fim de cada etapa relevante. E o primeiro arquivo que qualquer executor le.
> Ultima atualizacao: 2026-06-30 - por Claude. **F2.7.8 (fluxo REAL de fotos) — RODADA 3: incidente de prod CORRIGIDO, gates verdes, AGUARDA re-push (o push 4565f3e0 quebrou em prod).** ⭐**INCIDENTE+FIX (diagnostico read-only no banco):** apos o push, "quero fotos do onix" e "Boa tarde" prometeram foto por TEXTO sem midia. Evidencia: `v3_decisions` ambos `action=send_photos` mas `reason_code` do LLM (`send_photos_onix`/`send_vehicle_photos`, nao meu hardcoded) -> o handler NAO interceptou; `v3_effect_outbox` so `send_message`, ZERO `send_media`; `v3_inbox` o turno 13:33 agregou 2 msgs da rajada (unidas por `\n`): "Tambem nao tenho carro pra troca"+"quero fotos do onix". **2 causas (bugs do F2.7.8, deploy ESTAVA no ar):** (1) meu `isNegatedPhotoRequest` via o "nao" da linha de TROCA e negava o pedido de foto da linha seguinte -> null -> LLM fingiu; (2) "Boa tarde" (sem palavra de foto) -> Layer 1 nao dispara e o LLM decidiu send_photos sem trava. **2 FIXES:** Fix A negacao ESCOPADA POR CLAUSULA (delimita `\n . , ; : ! ?`; so nega na mesma clausula e antes da palavra de foto) -> rajada "troca\nquero fotos" dispara; Fix B **LAYER 2** trava pos-LLM (`shouldRepairPhotoPromise({decision,composedText,leadMessage})`+`resolvePhotoPromiseRepair`): decisao que promete foto (action send_photos OU texto) sem `send_media` e ROTEADA pelo resolvedor deterministico -> envia de verdade ou honesto; o LLM nunca mais finge. **P1 do Codex (3.1) FECHADO:** a Layer 2 agora RESPEITA a negacao do lead — se `isNegatedPhotoRequest(leadMessage)` (mesma regra da Layer 1), NAO repara mesmo com send_photos (invariante: nunca midia contra a vontade do lead). 44 testes (era 29) incl. **e2e REGRESSAO** da rajada real + 4 do P1. NAO empurrado (aguarda OK/re-auditoria do Codex). Detalhe no handoff. Anteriores (mesma F2.7.8): Handler DETERMINISTICO `engine/photo-intent.ts` (licao F2.6R: NAO confiar no LLM emitir efeito): o engine DETECTA o pedido de foto (`/foto|imagem/`), RESOLVE o veiculo (modelo na fala do lead + `interpretation.models`; OU ordinal "o segundo" -> N-esimo modelo da ULTIMA oferta do agente via `recentTurns`, ordenado por POSICAO no texto; OU unico da lista — **robusto ao bloqueio do callback `delivered`** que deixa offers.last/foco/photoLedger VAZIOS em prod) com `vehicleKey` SEMPRE do `stock_search` (grounding, regra 7), resolve as fotos (`vehicle_photos_resolve`) e EMITE o EffectPlan `send_media{vehicleKey,photoIds}` + texto curto (`buildPhotoTurnOutput`->`finalize`) — **nunca finge por texto**. Honesto: sem fotos -> "nao encontrei…" SEM send_media (regra 3); ambiguo -> "de qual veiculo?"; ja enviadas (ledger) -> nao reenvia salvo "mais fotos" (regra 6). `dispatchConversation` (while-loop) manda texto (order 0) + midia (order 1) no MESMO turno; dispatcher uazapi resolve URLs e envia imagem real. Hardening F2.7.7 (rule 10): `safeCommitSlots` (PURO, exportado) so commita slots se o preview do reducer passar (senao descarta, nao derruba o turno). 29 testes (`run-f2-7-8-photos`): os 7 casos do dono + e2e (outbox tem `send_media`, nao fingiu) + hardening + 10 adversariais da rodada 1 do Codex. ⭐**RODADA 1 DO CODEX (2 bloqueios de producao FECHADOS):** (fix 1) **negacao de foto** — `isNegatedPhotoRequest` (regra geral: negacao `nao`/`nem`/`sem` ANTES da 1a palavra de foto -> `null`, nunca midia; cobre "nao quero foto"/"sem foto"/"nao manda imagem"/"agora nao, foto depois"; "tem foto ou nao?" segue valido); (fix 2) **anti-reenvio ACCEPTED-SAFE** — `recentlySentPhotos` le `recentTurns` (a fala "Aqui estao as fotos do {modelo}" e gravada no accepted por `withAssistantTurn`), trata pedido repetido como `already_sent` SEM tocar o `photoLedger`/regra de delivered; so reenvia com "mais/outras fotos"/"de novo"/"reenviar"; outro veiculo -> envia. ⚠️**Riscos p/ Codex:** (1) anti-reenvio MITIGADO (fix 2), mas o ledger OFICIAL ainda depende do `delivered` (issue C) — o fix 2 cobre a janela curta de `recentTurns` por NOME do modelo (se a fala saiu da janela, pode reenviar); (2) `stock_search` pega 1º match em modelo multi-ano; (3) texto fixo (naturalidade depois). Sem SQL, sem mudar contrato de estado/tabela (rule 9), v2/bridge/webhook intactos. **Parar p/ auditoria do Codex antes de CRM/handoff.** Anteriores: **F2.7.7 (captura de slots + objetivos) FEITA + VALIDADA no WhatsApp (nome "Douglas" capturado, sem repergunta).** Camada DETERMINISTICA `engine/lead-extraction.ts` (o LLM segue `facts:[]`; o engine injeta as mutacoes, fonte unica, so VALIDAS): NOME (padrao explicito "meu nome é X" OU objetivo de nome pendente + token limpo via stoplist+nao-veiculo; normaliza "dOUGLAS"->"Douglas") + INTERESSE multi-modelo (`slots.interesse` formato documentado "onix, argo", uniao sem apagar) + `resolve_objective` do nome. O engine aplica o extrator num ESTADO-PREVIA (sem bump) ANTES de decidir -> o modelo JA ve o nome capturado e **NAO repergunta no mesmo turno** (falha do print). Bloco inteiro: `TurnInterpretation.extractedEntities.models[]` (aditivo) -> pre-seed consulta Onix E Argo -> compose responde os achados + "nao encontrei X". 17 testes (`run-f2-7-7-slots`). Sem SQL, sem mudar contrato de estado/tabela (rule 9), v2/bridge/webhook intactos. ⭐**AUDITORIA DE FOTOS -> vira F2.7.8:** infra COMPLETA (query `vehicle_photos_resolve`, materializer/dispatcher `send_media`, `photoLedger`) MAS o **prompt do propose nao descreve o efeito `send_media`** -> o modelo responde so texto ("fingindo" foto). Falta: prompt send_media + decisao de foto + ledger anti-reenvio + "nao achei" honesto + testes. ⭐**F2.7.6.1 (hotfix):** a F2.7.6 derrubou o piloto (v3 caia no v2) porque esqueci as RPCs novas (`v3_upsert_conversation_routing`/`v3_find_settled_conversations`) no `RPC_ALLOWLIST` do gateway; corrigido (allowlist + `v3_upsert_conversation_routing` RETURNS boolean + teste de regressao em run-gateway-filter); SQL aplicado por mim na prod (escrita liberada: removido `--read-only`, sob protocolo de validacao); VALIDADO no WhatsApp (rajada "dOUGLAS"+"Quero um onix"+"ou argo" -> MESMO turno -> 1 resposta com oferta formatada). **Parar p/ auditoria do Codex antes de CRM/handoff.** Anteriores: **F2.7.6 (debounce/burst) IMPLEMENTADA + gates verdes; ⚠️AGUARDA o dono rodar a migration SQL antes do push (MCP e read-only).** Debounce no SERVICO V3 (sem Redis, sem setTimeout, sem mexer no v2): `/v1/pilot/turn` agora **so INGERE** (grava `v3_inbox` + roteamento) e responde `{status:"accepted",ingested:true}` -> o bridge mantem `routed: pedro_v3` (contrato intacto, classifica como "accepted"); um **POLLER** de fundo (`runtime/debounce-poller.ts`, tick=`PEDRO_V3_POLL_INTERVAL_MS` def 2000) pergunta ao Postgres quais conversas ASSENTARAM (quietas >= `PEDRO_V3_DEBOUNCE_MS`=6000 OU pendente mais antiga >= `PEDRO_V3_DEBOUNCE_MAX_MS`=12000, anti-starvation) e processa cada uma: `claimBurst(cutoff=now)` agrega TODAS as pendentes num turno (**ordem por received_at**), decide, despacha. Nova tabela `v3_conversation_routing` (agente+numero do lead — o conversation_id e hash do telefone, irreversivel, e o poller precisa do numero p/ despachar async) + RPCs `v3_upsert_conversation_routing`/`v3_find_settled_conversations` (migration `Brain/sql/v3_f2_7_6_debounce.sql`, idempotente, RLS **forcada**, service-role only; roteamento gravado ANTES do insert p/ nunca haver evento orfao). Logica PURA em `engine/debounce-policy.ts` (`isConversationSettled` + `resolveDebounceConfig`). Ingestao separada do processamento: `engine/pilot-ingest.ts` + novo `PilotActiveRoot.processConversation` (o `runTurn` virou ingest+process, comportamento identico nos testes). Dedupe de webhook preservado (evento pending=idempotente sem 2o turno; done=duplicate). Arquivos: `engine/debounce-policy.ts`, `engine/pilot-ingest.ts`, `runtime/debounce-poller.ts` (novos); `domain/ports.ts` (+`ConversationRoutingStore`/`SettledConversation`); `adapters/persistence/{in-memory-store,postgres-store}.ts` (+`upsertRouting`/`findSettledConversations`); `engine/pilot-active-root.ts` (split + status `accepted`); `engine/conversation-engine.ts` (ordem por received_at); `runtime/server.ts` (ingest-only + poller); `tests/run-f2-7-6-debounce.ts` (novo, 24 OK) + `tests/run-sql-schema.ts` (+migration F2.7.6, 72 OK); `Brain/sql/v3_f2_7_6_debounce.sql` (novo); `package.json`. Gates: `test:all` EXIT=0 (24 debounce + 72 SQL + todas as demais), `tsc` limpo, scan limpo; nao toca bridge/webhook/v2/CRM/handoff. ⚠️**PASSO DO DONO: rodar `v3_f2_7_6_debounce.sql` no SQL editor ANTES do push** — o codigo depende dos RPCs (sem eles a ingestao falha -> bridge cai no v2, sem quebra mas v3 fica de fora). Depois: push -> deploy -> validar a rajada "Conheco sim"+"quero um onix" (deve virar 1 turno). ⚠️Risco anotado: conversa com `commit_failed` PERSISTENTE seria re-tentada a cada tick (hot-loop visivel no log; dead-letter por `attempts` fica p/ depois). Proxima: **parar p/ auditoria do Codex** (antes de CRM/handoff). Anteriores: **F2.7.5 (render de ofertas WhatsApp) FEITA + gates verdes (commit/push autorizado pos-gates).** Fase 1 (D/E) validada no WhatsApp (busca estoque + responde Onix/Renegade); problema novo era RENDER: `ResponseRenderer` concatenava vehicle_ref/money_ref SEM separador -> "ONIX2014Ele" / "RENEGADE2016R$ 71.990RENEGADE2018...". **Correcao deterministica (sem if por marca):** nova parte `vehicle_offer_list` (modelo so manda vehicleKeys; o sistema formata) + helper PURO `engine/vehicle-offer-render.ts` (`renderVehicleOfferList`: lista numerada, preco BRL, km BR, campos ausentes omitidos sem buraco, preco 0 -> "preço a confirmar", ano ausente nao inventa, limite 5); `ResponseRenderer` reescrito em SEGMENTOS com separador (anti-grude geral: "voce:ONIX"->"voce: ONIX"; refs adjacentes nao colam) + bloco da lista com linha em branco; grounding mantido (chave fora dos fatos -> falha fechada no render; chave fora do catalogo -> POL-GROUND-STOCK); prompt compose: apresentar estoque SO via `vehicle_offer_list` (nao montar lista manual em texto). `VehicleFact` ganhou `cambio?`/`cor?` opcionais (render "se houver"; fonte de estoque pode preencher depois). Arquivos: `engine/vehicle-offer-render.ts` (novo), `engine/response-renderer.ts` (reescrito), `domain/decision.ts` (+offer_list), `domain/types.ts` (+cambio/cor), `adapters/llm/prompt-bound-conversation.ts` (decoder), `engine/policy-engine.ts` (catalogo da lista), `adapters/llm/openai-chat-model.ts` (prompt), `tests/run-f2-7-5-offer-render.ts` (novo, 23 OK), `package.json`. Gates: `test:all` EXIT=0, `tsc` limpo, scan limpo; nao toca bridge/webhook/v2/CRM/handoff. **Auto-deploy no push -> dono valida no WhatsApp: "tem renegade?" deve listar numerado e legivel.** Proxima = **debounce/burst**. Anteriores: **F2.7.4 Fase 1 (D+E) FEITA + gates verdes (aprovada por Codex; commit/push se gates passarem).** Diagnostico read-only (banco, 08:00 do piloto Aloan): memoria F2.7.4-A OK (recentTurns popula, append_assistant_turn aplica no accepted, outcome_applied_at preenchido), mas a conversa ainda falhava por (A) rajada "Conheco sim"+"quero um onix" caindo em turnos DIFERENTES (sem debounce -> Fase 2); (D) terminal-safe = `POL-GROUND-STOCK` "TextPart contem 'ONIX'" (o modelo citou o veiculo em texto livre SEM rodar stock_search); (E) recentTurns existia mas NAO era surfacado explicitamente ao modelo. **Correcao = invariantes gerais, sem if por frase:** (E) novo `engine/model-context-view.ts` (`deriveModelContext` PURO) injeta no snapshot `turn.context` = {recentTranscript, lastAgentMessage, alreadyIntroduced (recentTurns tem turno do agente OU turnNumber>1), conversationFacts, currentObjective, lastCommercialInterest}; prompt passa a USAR o contexto e a NUNCA reapresentar se alreadyIntroduced. (D) `decision-engine` PRE-SEED: se o lead nomeia veiculo (interpretacao + claims do catalogo na fala), roda `stock_search` ANTES de propor -> o compose ancora (vehicle_ref) ou diz "nao encontrei" + similares reais; (D3) re-tentativa de compose COM feedback do deny (nao mais cega) recupera em vez de cair em terminal-safe; prompt: veiculo SO via vehicle_ref. Arquivos: `engine/model-context-view.ts` (novo), `domain/conversation-model.ts` (+ModelConversationContext/+context no snapshot), `adapters/llm/prompt-bound-conversation.ts` (snapshot injeta context), `adapters/llm/openai-chat-model.ts` (prompts propose+compose), `engine/decision-engine.ts` (pre-seed + retry-guidance), `tests/run-f2-7-4-grounding-context.ts` (novo, 23 OK), `package.json`. Gates: `test:all` EXIT=0 (todas as suites + 23 novas), `tsc` limpo, scan de segredo/log/rede limpo (sem I/O novo); offline v2 NAO exigido (nao toquei bridge/webhook/v2). **Auto-deploy no push -> dono valida no WhatsApp: rajada responde sobre Onix primeiro, nao pede nome ignorando, nao reapresenta, sem "Desculpe a lentidao"; recentTurns segue populando.** Proxima = **Fase 2 (debounce/burst real)**; depois parar p/ Codex antes de CRM/handoff/follow-up. Anteriores: **F2.6N: ROOT CAUSE do "v3 nao responde" achado e corrigido.** Era DOUBLE-ENCODING no `SupabaseServiceGateway.encodeFilter` (`encodeURIComponent` + `URLSearchParams` re-encodava -> `event_id` "uazapi:hash" virava "%253A" -> `get()` nao casava -> "claimed inbox record missing" -> turno falhava sempre -> fallback v2). Fix: `encodeFilter` retorna valor CRU (URLSearchParams encoda 1x). Teste `run-gateway-filter.ts` (5). Gates: test:all EXIT=0, tsc limpo, offline v2 418. (F2.6L/M tornaram visivel via `v3_inbox.last_error`; chave OpenAI ja descartada.) **Auto-deploy no push -> dono manda "tem onix" -> verifico v3_inbox done + outbox + resposta do v3.** `PEDRO_V3_PILOT_MODE` active. (historico abaixo.) Diagnostico do "v3 nao responde": (a) AGORA `PEDRO_V3_PILOT_MODE` nao esta `active` (teste real -> v2, 0 evento novo no v3_inbox); (b) quando esteve active, o turno falha DEPOIS do ingest (5 eventos pending/attempts=5/outbox=0). **Chave OpenAI da plataforma TESTADA e VALIDA** (GET /models 200 + chat gpt-4.1-mini 200) -> descartada; falha e runtime. F2.6L grava o motivo sanitizado em `v3_inbox.last_error` (sanitize-error.ts + RPC `v3_record_inbox_error` + server.ts) p/ diagnosticar pelo banco. **PASSOS DO DONO**: rodar `Brain/sql/v3_f2_6l_inbox_error.sql` + redeploy do servico v3 + `PEDRO_V3_PILOT_MODE=active` + avisar -> leio o last_error -> corrijo a raiz. Gates: test:all EXIT=0, tsc limpo, offline v2 418 OK. Anteriores: F2.6H APROVADA; F2.6I/J/K (instance_id `6476a393`, BYOK por tenant, grandfather/plataforma). **PEDRO_V3_PILOT_MODE OFF; sem deploy/db push/rotacao.** (historico abaixo.) v3 com o MESMO 3-tier do v2: client key propria -> grandfathered usa chave da PLATAFORMA (Vault, nova RPC `get_platform_ai_key`) -> conta nova fail-closed. `BYOK_GRANDFATHER_CUTOFF=2026-06-16T03:00:00Z` (igual v2); grandfather le `profiles.created_at` fail-open. **NAO setar `OPENAI_API_KEY` no EasyPanel.** Gates: `test:all` EXIT=0 (+26 adversariais), `tsc` limpo, offline v2 **417 OK**. **PASSO MANUAL DO DONO**: rodar `Brain/sql/v3_f2_6k_platform_ai_key.sql` + cadastrar secret `platform_openai_api_key` no Vault (mesma chave do v2). Anteriores: F2.6H APROVADA (c1f216b7); F2.6I prep (Aloan `instance_id`=NULL -> instancia real `6476a393`); F2.6J BYOK por tenant. Pre-ativacao pendente: secret platform no Vault + `instance_id` + `messages_update` + ENVs/deploy. **PEDRO_V3_PILOT_MODE OFF; sem deploy/db push/rotacao.** (historico abaixo.)

## Fase atual

**F2.5.3 concluida por Codex.** O Pedro v3 agora possui adapters de leitura do v2 por contrato de banco injetavel: `V2DatabaseReadGateway` e `V2DatabaseCredentialProvider`. Eles nao importam SDK Supabase, nao abrem rede e nao fazem escrita; apenas definem o contrato seguro que um wrapper real devera cumprir.

**Gates locais:** 67 Kernel + 96 Fase 2 + 34 SQL + 21 Adapter Postgres + 127 Read-side = **345 OK | 0 FALHA**; `tsc --noEmit` limpo.

**Garantias F2.5.3 aplicadas:** leituras sempre filtradas por tenant+agent quando aplicavel; metadata de estoque nao seleciona `api_key_encrypted`; CRM nao seleciona `cpf`/`birth_date`; CredentialProvider resolve segredo somente no ponto de uso e falha fechado em provider/cross-tenant; erro de banco vira `READ_SOURCE_FAILURE` sanitizado; sem WhatsApp, sem CRM-write, sem handoff, sem agenda e sem Supabase real.

**Pendencia operacional mantida:** a chave Supabase `service_role` exposta no scratch antigo ainda precisa ser rotacionada/revogada antes de qualquer canary/producao real. Mantida por decisao do dono para nao travar as fases offline.

**Proxima etapa sugerida:** F2.5.4 - wrapper real do client Supabase read-only + decryptor seguro ou canary shadow controlado, somente depois da rotacao/credencial segura e com EffectGate OFF.
## Melhorias e Garantias Aplicadas (Fase 1.5)

1. **Grounding estrito do Texto Livre (`TextPart`)**:
   - Respostas comerciais (`search_stock`, `send_photos`, `answer_vehicle_question`) nÃ£o podem citar veÃ­culos de marcas/modelos em texto livre.
   - Qualquer citaÃ§Ã£o detectada pelo `ClaimExtractor` em `TextPart` constitui uma violaÃ§Ã£o (`POL-GROUND-STOCK`), disparando o modo seguro de falha fechada (`terminalSafe`).

2. **DetecÃ§Ã£o DinÃ¢mica com `ClaimExtractor`**:
   - O `ClaimExtractor` foi injetado na assinatura de `TurnContext`. Ele Ã© o responsÃ¡vel oficial por rastrear alegaÃ§Ãµes de veÃ­culos em texto bruto.
   - Removido qualquer parsing de intenÃ§Ãµes baseado em `msg.includes` ou `rawMessage.includes` no motor interno.

3. **AdequaÃ§Ã£o do `TenantCatalog`**:
   - A tipagem do `TenantCatalog` no domain `decision.ts` foi reestruturada para suportar catÃ¡logo dinÃ¢mico via `entries: CatalogEntry[]` (contendo aliases e vehicleKey).
   - O `PolicyEngine` e os adaptadores de interpretaÃ§Ã£o agora utilizam puramente esta estrutura.

4. **Isolamento de Interpretadores (Adapters)**:
   - O arquivo `turn-interpreter.ts` (contendo `CatalogEntityExtractor` e `interpretTurn`) foi migrado de `src/engine/` para `src/adapters/turn-interpreter.ts` para separar as ferramentas de parsing de strings do motor centralizado puro.
   - `decision-engine.ts` nÃ£o possui qualquer importaÃ§Ã£o ou dependÃªncia direta de `turn-interpreter.ts`.

5. **MoneyRole Ã— MoneySource**:
   - A matriz rÃ­gida de relacionamentos monetÃ¡rios foi validada. Apenas fontes do tipo `vehicle_fact` alimentam `vehicle_price`.
   - PapÃ©is como `installment`, `down_payment` e `budget` estÃ£o estritamente amarrados Ã s suas respectivas fontes em `slot_value` (`entrada`, `parcelaDesejada`, `faixaPreco`). Qualquer violaÃ§Ã£o falha fechado.

6. **ValidaÃ§Ã£o do Reducer**:
   - O mÃ©todo `applyDecision` no `state-reducer.ts` agora exige `expectedTurnId` e `expectedNow` em sua assinatura.
   - MutaÃ§Ãµes que possuem `sourceTurnId` divergente ou cujo valor de slots Ã© invÃ¡lido (como faixaPreco invÃ¡lido) sÃ£o atomicamente rejeitadas pelo reducer.

## Kernel implementado (`Agent/`) â€” sem I/O

```
Agent/
  package.json, package-lock.json, tsconfig.json, .gitignore
  src/domain/   types.ts Â· context.ts Â· llm.ts Â· conversation-state.ts Â· decision.ts
  src/engine/   state-reducer.ts Â· policy-engine.ts Â· decision-engine.ts Â· finalizer.ts Â· catalog-utils.ts
  src/adapters/ llm/fake-llm.ts Â· turn-interpreter.ts
  tests/run.ts
```

## Testes (L1 + L4) â€” verdes

- `npm test` (`npx tsx tests/run.ts`) -> **67 OK | 0 FALHA** (corrigido na F2.0.1; valor anterior 54 estava desatualizado).
- `npx tsc --noEmit` â†’ **0 Erros de CompilaÃ§Ã£o**.
- Cobrem: 
  - Reducer bÃ¡sico, durÃ¡vel e com igualdade exata de `effectId`.
  - RejeiÃ§Ã£o de efeito forjado com mesmo sufixo mas turnId divergente.
  - Interpretador semÃ¢ntico diferenciando respostas de objetivos pendentes (troca/pagamento) de mudanÃ§as explÃ­citas de direÃ§Ã£o (mudar para sedan).
  - ValidaÃ§Ã£o de ciclos, dependÃªncias fantasmas e planIds duplicados nos planos.
  - Grounding com extraÃ§Ã£o monetÃ¡ria isolando parcelas de preÃ§os do veÃ­culo e bloqueio de alucinaÃ§Ãµes de marcas ("Audi Q5") nÃ£o consultadas.
  - Testes adversariais com marcas sintÃ©ticas (`Zeekr`, `Tesla`, `Volvo`, `Roma`).
  - Erros e timeouts de todas as etapas e globais capturados e retornando TurnDecisions consistentes emitidas pelo Finalizer.
  - 4 turnos encadeados multiturno integrados sem quebras de estado.

## Bloqueios / aguardando

- Nenhum. Pronto para prÃ³ximas diretivas de integraÃ§Ã£o de I/O ou deploy.

## Regras ativas

- `Agent/` tem cÃ³digo funcional simulado. Sem I/O real (banco, Postgres `v3_*`, CRM ou Uazapi real).
- O v2 permanece intacto e em execuÃ§Ã£o (somente leitura para o v3).

---

## Atualização Codex — Fase 1.5.1 — 2026-06-27

Codex assumiu a execução após término dos créditos do Antigravity e fechou as lacunas apontadas na auditoria da Fase 1.5.

Correções aplicadas:
- `catalog-utils.ts`: normalização canônica de catálogo agora remove acentos, transforma hífen/pontuação em separadores, compacta espaços e preserva `+` como `plus` para evitar que `C++` vire apenas `c`.
- `turn-interpreter.ts` em `adapters`: detecção de marca/modelo passou a usar termos completos normalizados do `TenantCatalog`, suportando aliases, modelos multi-palavra e hifenizados.
- `tests/run.ts`: suíte ampliada de 54 para 67 testes, cobrindo lacunas que a auditoria encontrou.

Novos cenários provados:
- `confidence > 1`, `sourceTurnId` errado, `faixaPreco.max` negativo, `min > max` e `veiculoTroca` vazio são rejeitados atomicamente.
- `vehicle_ref` com `field: "preco"` falha fechado.
- `money_ref` com `installment` vindo de `vehicle_fact` falha fechado.
- `Zeekr X` em texto livre usando preço real de outro carro gera `deny`.
- Catálogo aceita chave hifenizada contra marca/modelo multi-palavra (`Land Rover` / `Range Rover Evoque`).
- Catálogo aceita uppercase/lowercase canônico (`FIAT` / `fiat`).
- Normalização preserva `C++` como `c plus plus`.
- Extractor reconhece `Range Rover Evoque` multi-palavra e `C++` sem quebrar por metacaractere.

Validação executada:
- `npm.cmd test` -> `67 OK | 0 FALHA`.
- `npm.cmd exec -- tsc --noEmit` -> sem erros.
- `rg` no `src/engine` e `src/domain` para `msg.includes`, `rawMessage.includes`, `priceClaims`, `mentionsVehicleKeys` -> sem achados.
- `rg` para `field: "preco"`/`field: 'preco'` em `src` -> sem achados.

Status: Fase 1.5.1 aprovada para auditoria final. Próximo passo recomendado: Claude não deve mexer no kernel sem motivo; deve partir para planejamento da Fase 2 (I/O/adapters/outbox) com autorização explícita e mantendo todos os testes verdes.

---

## Atualização Claude — Plano da Fase 2 entregue — 2026-06-27

Claude retomou (créditos do Antigravity acabaram). Baseline reconfirmado no ambiente: `npx tsx tests/run.ts` -> **67 OK | 0 FALHA**; `tsc --noEmit` limpo. **Kernel NÃO foi tocado.**

Entregue: **`Brain/07-PLANO-FASE-2.md`** — plano curto da Fase 2 (camada N8N-like real) respondendo aos 6 pontos do Codex: (1) arquivos a criar (ports/effect-intent/conversation-engine/effect-materializer/outbox-dispatcher/effect-outcome-commit/reconciler/in-memory-store/fake-dispatchers/run-phase2) sem tocar o kernel; (2) tabelas `v3_*` (já em `02 §4`), entregues como SQL PROPOSTA p/ o dono rodar; (3) tudo fake/in-memory primeiro (ports + InMemoryStore + fake dispatchers, EffectGate OFF); (4) hexagonal, sem driver/rede, adapters reais só em sub-fase autorizada; (5) testes R2-1..R2-9/R3-1..R3-8 end-to-end no engine in-memory; (6) aditivo — 67 verdes preservados + `tsc` limpo a cada handoff. **Sem mudança breaking de contrato do kernel** (tipos novos são aditivos em `domain/effect-intent.ts`).

**Status: aguardando auditoria do Codex do plano + autorização do dono p/ iniciar a F2.0** (nenhum I/O/banco/deploy nesta etapa).

---

## Atualização Claude — F2.0 (persistência in-memory) IMPLEMENTADA — 2026-06-27

Autorizada e concluída a **F2.0** (escopo estrito). **Sem ConversationEngine, dispatcher, reconciler, SQL, provider, banco, deploy. Kernel intocado.**

**Arquivos criados/alterados (só os do escopo):**
- `Agent/src/domain/effect-intent.ts` — tipos de persistência aditivos: `EffectStatus`, `ProviderCapability`, `EffectIntent`, `OutboxRecord`, `InboxRecord`, `TurnEventRecord`, helper `redact`.
- `Agent/src/domain/ports.ts` — interfaces de I/O puras: `Clock`, `IdGen`, `LeaseStore`, `InboxStore`, `StateStore`, `OutboxStore`, `UnitOfWork`, `Persistence`. Nenhuma implementação.
- `Agent/src/adapters/persistence/in-memory-store.ts` — `InMemoryPersistence` (Maps + UnitOfWork atômico + CAS), `FakeClock`, `FakeIdGen`. SEM rede/driver.
- `Agent/tests/run-phase2.ts` — 19 testes provando os 8 pontos.
- `Agent/package.json` — scripts `test:phase2` e `test:all`.

**8 pontos provados (19 testes):** (1) inbox dedupe atômico = o próprio insert; (2) claim/lease — 2 workers, só um vence + claim marca o evento; (3) cutoff — msg nova fica p/ próximo turno; (4) lease release no sucesso E no erro/finally; (5) CAS — commit com versão antiga falha; (6) UnitOfWork tudo-ou-nada — parte falha → nada persiste; (7) outbox store básico — records `pending` com effectId/idempotencyKey/order/dependsOn + idempotencyKey UNIQUE, sem dispatch; (8) determinismo — FakeClock/FakeIdGen reproduzíveis.

**Gates (todos verdes):** `npm test` → **67 OK** (kernel preservado) · `npm run test:phase2` → **19 OK** · `tsc --noEmit` → limpo · `rg fetch|http|postgres|pg|supabase src` → só 1 comentário no `ports.ts` (nenhum I/O real) · `rg msg.includes|rawMessage.includes src/engine src/domain` → **0 achados** (os existentes ficam só no parser `adapters/turn-interpreter.ts`).

**Próximo:** F2.1 (effect-materializer + conversation-engine + commit do ciclo) — só após auditoria do Codex.

---

## Atualização Claude — F2.0.1 (correções pós-auditoria) — 2026-06-27

Auditoria da F2.0 aprovou os gates, mas pediu 3 correções pequenas antes da F2.1 (sem iniciar ConversationEngine). Feitas:

1. **`withLease` assíncrono** — contrato em `ports.ts` agora `fn: (lease) => T | Promise<T>): Promise<T>`; `InMemoryPersistence.withLease` usa `await fn` dentro do try/finally. Testes: o lease **NÃO** é liberado enquanto a Promise está pendente; libera no **resolve** E no **reject**.
2. **Recuperação de inbox `claimed`** (menor solução coerente com `02 §9`): novo `InboxStore.releaseClaim(eventIds, claimedBy, turnId)` devolve o claim p/ `pending` (turno falhou antes do commit), e só libera o claim do worker/turno correto. Além disso, `UnitOfWork.markInboxDone(eventIds, claimedBy, turnId)` agora **valida**: só marca `done` evento que está `claimed` pelo MESMO worker/turno (commit rejeita se divergir). Testes: claim→releaseClaim volta p/ pending + re-claimável; releaseClaim com owner/turno errado não libera; markInboxDone com turno errado é rejeitado, com o correto vira `done`.
3. **Brain/01 corrigido** — o trecho stale "54 OK" virou **67 OK** (linha de validação da seção Codex).

**Gates F2.0.1 (todos verdes):** `npm test` → **67 OK** (kernel preservado) · `npm run test:phase2` → **27 OK** (era 19; +3 lease async, +5 recuperação) · `npm run test:all` → ambos · `tsc --noEmit` → limpo · `rg fetch|http|postgres|pg|supabase src` → só o comentário do `ports.ts` · `rg msg.includes|rawMessage.includes src/engine src/domain` → **0**.

**Escopo respeitado:** sem ConversationEngine/dispatcher/reconciler/SQL/provider/banco/deploy; v2 intocado; kernel intocado. **Parado para auditoria da F2.0.1.** Próximo (se aprovado): F2.1.


---

## Atualizacao Codex - F2.1 (ConversationEngine in-memory) - 2026-06-27

Codex assumiu a execucao apos termino dos creditos do Claude/Antigravity e concluiu a **F2.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/effect-materializer.ts` - converte `TurnDecision.effectPlan` + `RenderedResponse` em `OutboxRecord[]` com `status=pending`, `idempotencyKey=effectId`, payload redacted e sem dispatch.
- `Agent/src/engine/conversation-engine.ts` - orquestra um turno atomico: lease -> cutoff -> claimBurst -> load/create state -> `runTurn` -> `applyDecision` -> materializa outbox -> UnitOfWork CAS -> eventos/decisao/outbox/inbox done.
- `Agent/tests/run-phase2.ts` - F2.1 adicionada aos testes da Fase 2.

Garantias provadas na F2.1:
- Sem inbox claimavel retorna `no_op`.
- Ciclo completo commita estado, decisao, eventos, outbox e marca inbox `done` somente no commit.
- Outbox nasce `pending`, sem receipt, sem dispatch e com `effectId/idempotencyKey` deterministico.
- Payload do efeito nasce `redacted` e usa o texto renderizado pelo `ResponseRenderer`.
- Falha antes do commit libera o claim para `pending` e nao persiste decision/outbox.
- Conflito CAS falha, libera claim e nao vaza decision/outbox do turno.
- Dedupe de inbox impede segundo processamento do mesmo eventId.
- Cutoff do engine deixa mensagem futura pendente para o proximo turno.

Gates executados:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1 41 OK | 0 FALHA**.
- `npm.cmd exec -- tsc --noEmit` -> sem erros.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentario em `domain/ports.ts`; nenhum I/O real.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Escopo respeitado:
- Sem dispatcher, reconciler, SQL, provider real, banco, migration ou deploy.
- Kernel preservado; F2.1 consome contratos existentes.
- v2 intocado.

Proximo passo recomendado: **F2.2 - OutboxDispatcher fake + EffectOutcomeCommit in-memory** (Concluido na F2.2.1).

---

## Atualizacao Antigravity - F2.2 / F2.2.1 (OutboxDispatcher e EffectOutcomeCommit in-memory) - 2026-06-27

Antigravity assumiu a execucao da **F2.2 / F2.2.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/outbox-dispatcher.ts` [NEW] - Realiza a varredura e despacho de efeitos, respeitando dependências explícitas (`dependsOn`) e linearidade implícita (`order`). Se uma dependência falhar ou for pulada, os dependentes são marcados como `"skipped"` em cascata.
- `Agent/src/engine/effect-outcome-commit.ts` [NEW] - Aplica os resultados de efeitos de forma transacional (CAS) e idempotente. Diferencia `"accepted"` (não altera o estado conversacional, `outcomeAppliedAt` continua `null`) de `"delivered"` (atualiza estado via `applyEffectOutcome` e define `outcomeAppliedAt`).
- `Agent/src/domain/ports.ts` [MODIFY] - Adicionado o método `updateOutbox` na interface `UnitOfWork`.
- `Agent/src/adapters/persistence/in-memory-store.ts` [MODIFY] - Implementada a gravação de updates de outbox record na `UnitOfWork` do `InMemoryPersistence`, validando a imutabilidade dos campos estruturais (`effectId`, `idempotencyKey`, `conversationId`, `turnId`, `planId`, `kind`) no `commit()`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionada a suíte de testes F2.2 (Testes 11 a 14) e F2.2.1 (Testes 15 a 17).

Garantias provadas na F2.2 / F2.2.1:
- **dependsOn e order**: Respeito à ordem de execução e dependências explícitas e implícitas.
- **Skipped em cascata**: Propagação de `"skipped"` se a dependência falhar.
- **Diferenciação de receipts**: `"accepted"` não muda estado conversacional e mantém `outcomeAppliedAt = null`. `"delivered"` aplica reducer conversacional e preenche `outcomeAppliedAt`.
- **Validações rígidas no commit**: Mismatch de IDs no `commitEffectOutcome` aborta o commit; updates de outbox inexistentes ou modificando chaves imutáveis no UoW são rejeitados no `commit()`.
- **CAS real concorrente**: Simulação de CAS real através de interceptação prova que atualizações de estados concorrentes são barradas, sem aplicação parcial.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1 65 OK | 0 FALHA** (132 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilação.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentário explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.3 - Reconciler / Job Queue in-memory** (Concluido).

---

## Atualizacao Antigravity - F2.3 / F2.3.1 (Reconciler e EffectGate in-memory) - 2026-06-27

Antigravity assumiu a execucao da **F2.3 / F2.3.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/receipt-policy.ts` [NEW] - Define em código se o efeito é crítico conversacionalmente (`isCriticalForConversationState`), se exige `"delivered"` ou `"accepted"` (`requiredReceiptFor`) e avalia se dependências prioritárias foram de fato satisfeitas (`isEffectSatisfiedForDependency`).
- `Agent/src/engine/effect-gate.ts` [NEW] - Proporciona o controle em memória para alternar entre Active e Shadow Mode.
- `Agent/src/engine/reconciler.ts` [NEW] - Realiza a varredura e conciliação de registros presos em `"processing"`, incertos em `"outcome_uncertain"` e timeouts de `"accepted"`. Limita retentativas (`maxAttempts`) movendo registros excedentes para dead-letter terminal (sem mutar estado conversacional).
  - **F2.3.1**: O reconcilador foi ajustado para aplicar a política e **não** lançar timeout de entrega (dead-letter) em efeitos não-críticos (como `send_message` sem `onSuccess`), pois estes exigem apenas receipt nível `"accepted"`.
- `Agent/src/engine/outbox-dispatcher.ts` [MODIFY] - Injetado o `EffectGate` e a verificação do Shadow Mode (onde os records viram `"skipped"` com `lastError = "shadow_mode_gate_active"`, significando consumido operacionalmente pelo gate). As dependências passaram a ser validadas estritamente pela política do `receipt-policy.ts`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionados os testes 18 a 24 da Fase 2.3/2.3.1, cobrindo reconciliação por capability, retentativas máximas (dead-letter), timeouts de accepted apenas para efeitos críticos, liberação normal de accepted não-críticos antigos e o funcionamento auditável do Shadow Mode.

Garantias provadas na F2.3 / F2.3.1:
- **Matriz de receipts em código**: Efeitos críticos (com onSuccess, crm_write, handoff, etc.) exigem estritamente `"delivered"` para desbloquear dependentes. Efeitos informais exigem apenas `"accepted"`.
- **Timeout de accepted seletivo**: O timeout e transição para falha/dead-letter em `"accepted"` preso aplica-se apenas a efeitos críticos que dependem de `"delivered"`.
- **Reconciliação segura**: Records `idempotent` sofrem retry seguro sob limite de `maxAttempts`. Records `queryable` consultam status (`reconcile`) antes de qualquer decisão. Records `none` entram diretamente em dead-letter terminal sem avançar o estado conversacional.
- **Shadow Mode auditável**: Bloqueia chamadas de dispatch real. Mantém decision/outbox intactos e legíveis para comparações.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1/F2.3/F2.3.1 83 OK | 0 FALHA** (150 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilação.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentário explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.4 - Schema SQL (v3_schema.sql) + ADR de mapeamento**. Mapeamento lógico de tabelas e ports do Pedro v3 para o banco Supabase, preparando a infraestrutura para a futura transição de adapters reais.

---

## Atualizacao Codex - F2.4 (Schema PostgreSQL/Supabase) - 2026-06-27

Codex concluiu o schema duravel do Pedro v3 sem executar nada no Supabase e sem tocar o v2.

Entregas:
- `Brain/sql/v3_schema.sql`: 12 tabelas `v3_*`, indices, RLS, triggers de integridade e RPCs atomicas.
- `Brain/sql/v3_verify_after_install.sql`: verificacao somente leitura para o dono rodar apos instalar.
- `Brain/decisions/ADR-007-mapeamento-postgres-v3.md`: contrato port -> tabela/RPC.
- `Agent/tests/run-sql-schema.ts`: teste de integracao em PostgreSQL embutido.

Validacao local:
- `npm.cmd run test:sql` -> **25 OK | 0 FALHA**.
- O teste executa o DDL real e prova dedupe, redaction, lease, claim, CAS, commit atomico, outbox, accepted/delivered, EffectOutcomeCommit idempotente, rollback, imutabilidade e RLS do cofre.

Status: **F2.4 pronta para instalacao pelo dono**. Proximo gate: executar `v3_schema.sql` no SQL Editor, depois `v3_verify_after_install.sql`, e enviar o resultado ao Codex. F2.5 permanece bloqueada ate essa verificacao.


---

## Atualizacao Codex - F2.4 instalada no Supabase - 2026-06-27

O dono executou o schema e o verificador no Supabase. Resultado remoto: **44 checks, 44 ok=true, 0 falhas**.

Confirmado: 12 tabelas, 12 RPCs, RLS habilitado e forcado, colunas criticas do outbox, permissao de commit para service_role, cofre sem SELECT para authenticated e isolamento integral do Pedro v2.

Status: **F2.4 instalada e aprovada**. A F2.5 (adapter Postgres real atras dos ports) esta liberada para implementacao controlada. Providers reais e modo ativo continuam bloqueados.


---

## Atualizacao Codex - F2.5.0 Adapter Postgres de turnos - 2026-06-27

Concluida a primeira fatia do adapter real. Ports aceitam I/O assincrono, engines aguardam persistencia e o novo `PostgresPersistence` mapeia inbox, lease, estado, leitura de outbox e commit atomico do turno para o Supabase.

Seguranca: mutacao de outbox no adapter real continua bloqueada por `postgres_outbox_update_not_enabled_f2_5_0`; nenhum provider, WhatsApp, CRM ou deploy foi ligado.

Gates: 67 Kernel + 83 Fase 2 + 25 SQL + 13 adapter = **188 OK | 0 FALHA**; TypeScript limpo.

Proximo: F2.5.1, com ports especificos para claim/result/retry/skip/outcome do outbox e alinhamento de `terminalAt` no fake.
---

## Atualizacao Codex - F2.5.1 (Outbox Postgres seguro) - 2026-06-27

Entregue claim atomico por conversa, persistencia de result/receipt, retry/requeue, skip/fail protegidos, EffectOutcomeCommit e reconciliacao sobre o adapter Postgres. Toda operacao administrativa compara status, receipt e processing token esperados; snapshot stale falha fechado.

Invariantes novos:
- `delivered` sobrevive a conflito CAS e nunca volta para `pending`.
- Reconciler aplica memoria pendente sem repetir o efeito externo.
- Excecao desconhecida de dispatch vira `outcome_uncertain`, nao uma alegacao falsa de falha.
- Falha conhecida retryable recebe janela e volta a fila somente quando devida.
- `failed`/`skipped` usam `terminalAt`; nao falsificam `outcomeAppliedAt`.
- Callback `accepted` atrasado nao rebaixa `delivered`.
- Writer stale e token forjado nao sobrescrevem estado mais novo.
- Efeito terminal nao pode ser reaberto.

SQL:
- `Brain/sql/v3_f2_5_1_outbox_patch.sql` e o patch incremental para o Supabase existente.
- `Brain/sql/v3_schema.sql` incorpora a F2.5.1 para instalacoes novas.
- RPCs globais/sem guarda antigas perdem `EXECUTE` para `service_role`.
- `Brain/sql/v3_verify_after_install.sql` verifica as novas RPCs e privilegios.

Validacao: `cmd /c npm.cmd run test:all` -> **214 OK | 0 FALHA**; `npm.cmd exec -- tsc --noEmit` -> limpo. Nenhum provider, webhook, CRM, Uazapi, deploy ou escrita remota foi executado.
---

## Atualizacao Codex - F2.5.1 verificada no Supabase - 2026-06-28

O dono executou o patch incremental e o verificador read-only no Supabase. Resultado remoto: **48 checks, 48 ok=true, 0 falhas**.

Confirmado remotamente:
- novas RPCs de claim por conversa e writers guarded;
- `service_role` com acesso apenas as rotas protegidas;
- RPCs globais/sem guarda antigas revogadas;
- 12 tabelas com RLS habilitado e forcado;
- cofre sem SELECT para authenticated;
- isolamento integral do Pedro v2.

Status: **F2.5.1 aprovada e encerrada. F2.5.2 liberada**, ainda obrigatoriamente em shadow e sem envio WhatsApp/CRM/handoff/agenda.

---

## Atualização Claude — Auditoria read-side + Plano F2.5.2 entregue — 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` → **214 OK | 0 FALHA**; `tsc --noEmit` limpo. **Nada alterado em Agent/, v2 ou banco** (auditoria read-only via código vivo + Supabase MCP só-leitura).

Entregue: **`Brain/08-PLANO-F2.5.2-READ-SIDE.md`** (16 pontos) com o inventário FACTUAL das fontes vivas.

**Fontes vivas confirmadas (por import/query/runtime):** config+prompt = `wa_ai_agents`(+`agent_funnel_config`, `selectActiveAgent`); estoque = **API EXTERNA** por tenant via `platform_integrations` (`searchPedroStock`: RevendaMais feed > BNDV GraphQL); fotos = campo `pictureJs` do item de estoque (não é tabela); CRM = `ai_crm_leads`; KB = `agent_knowledge_bases`/`knowledge_chunks`.

**Binding do `douglasaloan@gmail.com` (SQL):** tenant `user_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0`; agente **"Aloan"** `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185` (ativo).

**Divergências vs inventário anterior (código venceu):** (a) agente é **"Aloan"**, não "Sara"; (b) **`instance_id=NULL`** (sem WhatsApp ligado — bloqueio só da fase ativa); (c) **BNDV e RevendaMais ambos ativos** → RevendaMais vence pela precedência viva; (d) `use_funnel_config=false` → prompt = `system_prompt` cru; `company_name=""`; (e) **estoque/fotos são HTTP externo**, então o read-side precisa de fetch read-only (distinto dos EffectDispatchers, que seguem OFF).

**Status: aguardando auditoria do Codex do plano `08` + decisões do dono (§16)** antes de implementar a F2.5.2. Nenhum I/O de implementação foi feito.

---

## Atualização Claude — Plano F2.5.2 revisado (R1) — 2026-06-28

Direção da F2.5.2 aprovada pelo Codex; **implementação NÃO**. Apliquei as 12 correções obrigatórias em `Brain/08` (seção **REVISÃO R1**), com investigação read-only adicional do v2. **Agent/ intocado; nada implementado.**

Investigação que fundamentou a R1: RevendaMais raw é `Record<string,any>` e **descarta id externo**; `category` do feed = AUTOMOVEL/MOTO (não carroceria); BNDV GraphQL vivo **não pede id nem carroceria**; carroceria hoje = regex de listas manuais (`getVehicleSubcategory`, a NÃO copiar); fotos = `[{Link,Principal}]` com URL possivelmente assinada.

Correções no `08` (R1-1..R1-12): identidade `source+externalVehicleId` (fingerprint de atributos não-voláteis se faltar; colisão→`ambiguous`, sem foto auto); contrato de `photoId` (hash do path estável, resolúvel pós-restart/re-assinatura); preço/ano ausentes fail-closed (mini-ADR se mudar `VehicleFact`); `VehicleType` com confiança+proveniência (`unknown` nunca vira SUV; `broad` não relaxa rígido); segurança do fetch (HTTPS/allowlist/anti-SSRF/limite/timeout/retry-só-GET/sem-credencial-em-log); `CredentialProvider`/`SecretRef` (api_key_encrypted nunca em config/estado/log); CRM sem cpf/birth_date + `leadId`=UUID + exige tenant+agent+lead; tenant/agente explícitos (sem "primeiro agente ativo"); KnowledgeSource removida do escopo (sem `knowledge_search` no contrato); prompt carregado/validado mas sem integração efetiva até LLM; cache LRU+single-flight+Clock injetável (não depender de `last_sync_at`); testes adversariais. **Slices F2.5.2A–D.** **Decisões do dono aplicadas** (fetch read-only OK c/ controles; não conectar instância; RevendaMais principal; **sem fallback silencioso p/ BNDV**; prompt cru; não importar v2).

**Status: revisão R1 aprovada pelo Codex.**

---

## Atualização Claude — F2.5.2A IMPLEMENTADA — 2026-06-28

R1 aprovada; **F2.5.2A implementada** (contratos read-only + carregamento seguro de config + `CredentialProvider`/`SecretRef` + fakes). **Sem HTTP/CRM/QueryRunner/LLM/rede; Kernel/v2/banco intocados.**

Criados em `Agent/`: `src/domain/read-ports.ts`, `src/domain/credential-provider.ts`, `src/adapters/read/v2-read-gateway.ts`, `src/adapters/read/tenant-config-source.ts`, `src/adapters/read/fakes/{fake-v2-read-gateway,fake-credential-provider}.ts`, `tests/run-read-side.ts`; `package.json` (`test:read` + `test:all`).

Garantias: tenant+agente explícitos (sem "primeiro ativo"); gateway com métodos específicos validando propriedade; `TenantRuntimeConfig` readonly **sem credencial** (só `SecretRef` opaco de 4 campos); prompt sem fallback e sem vazar conteúdo em erro; RevendaMais>BNDV sem fallback silencioso; `CredentialProvider` não chamado no load (provado por spy); erros tipados fail-closed.

Gates: **`test:all` = 242 OK | 0 FALHA** (214 + 28); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes da fatia (canários só no teste). `08` consolidado (R1 autoritativa, trechos antigos marcados DEPRECATED).

**Status: F2.5.2A auditada — gerou F2.5.2A.1 (endurecimento).**

---

## Atualização Claude — F2.5.2A.1 (endurecimento contratual) — 2026-06-28

Codex auditou a A e pediu 9 endurecimentos contratuais (sem iniciar B). Implementados nos arquivos da fatia:

1. **2 camadas de propriedade** — `TenantConfigSource` revalida `id`/`tenantId` do agente, funil e cada integração (não confia só no gateway); divergência → `SOURCE_OWNERSHIP_MISMATCH`.
2. **Erros do gateway** — `tryGateway` captura exceção de cada chamada → `READ_SOURCE_FAILURE` fail-closed; **nunca propaga `error.message`** (teste com canário token/prompt não vaza).
3. **Imutabilidade real** — arrays clonados + `Object.freeze` recursivo (config/arrays/SecretRef frozen; mutar seed pós-load não altera config).
4. **versionStamp composto** — agente + funil(quando usado) + provider + integrationId + integration.updatedAt (sem prompt/segredo).
5. **SecretRef tipado** — `provider` união fechada; `makeSecretRef` valida contra **allowlists reais** + ids não-vazios, rejeitando **sem ecoar o valor**.
6. **CredentialProvider fail-closed** — `resolve` discriminado (`SECRET_NOT_FOUND`/`OWNERSHIP_MISMATCH`/`PROVIDER_MISMATCH`); fake não devolve material "default".
7. **Validação de metadata** — rejeita id vazio/tenant divergente/provider desconhecido/duplicado/timestamp inválido (sem normalizar silenciosamente).
8. **Testes adversariais** — gateway mentiroso (agente/funil/integração de outro tenant), erro com segredo, imutabilidade, versionStamp, makeSecretRef, resolve fail-closed, metadata inválida.
9. **`Brain/08` consolidado** — reescrito como **especificação ÚNICA**; trechos obsoletos (`marca|modelo|ano`/índice, KnowledgeSource, CPF, `last_sync_at` base, listas do v2) **removidos**, não só marcados.

Gates: **`test:all` = 268 OK | 0 FALHA** (214 + **54** read-side); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes (canários só no teste).

**Status: aguardando auditoria do Codex da F2.5.2A.1. NÃO iniciar B/C/D.**
---

## Atualizacao Codex - auditoria final F2.5.2A/A.1 - 2026-06-28

Codex retomou apos o limite de creditos do Claude, leu integralmente os contratos, adapters, fakes, 54 checks read-side, Brain/08 e handoff. A regressao foi executada novamente:

- `cmd /c npm.cmd run test:all` -> **268 OK | 0 FALHA**.
- `npm.cmd exec -- tsc --noEmit` -> limpo.
- Gate estatico -> nenhum `fetch`, Uazapi, EffectDispatcher, escrita CRM, Supabase/Postgres real ou import do v2 nas fontes A/A.1.

Invariantes confirmados: propriedade revalidada em duas camadas; erros do gateway sanitizados; config e arrays frozen; `versionStamp` inclui fontes efetivas; `SecretRef` usa allowlists e nao carrega segredo; CredentialProvider falha fechado; metadata invalida/cross-tenant e rejeitada; Brain/08 possui especificacao unica consolidada.

**Resultado: F2.5.2A/A.1 APROVADAS. F2.5.2B liberada sob os gates do Brain/08.**

---

## Atualização Claude — F2.5.4A (wiring Supabase read-only + canary shadow) — 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` → **345 OK | 0 FALHA**; `tsc` limpo (bate com o esperado). Implementada **somente a F2.5.4A** (infra segura; **sem canary remoto, sem EffectGate ativo, sem provider real**).

**Auditoria read-only do v2 (crítico):** `api_key_encrypted` do `platform_integrations` é **PLAINTEXT** (provado: `parseCredentials`=`JSON.parse`/raw; `mediaContext`/`metaSender` usam o valor direto como token). Logo **não há formato criptográfico a comprovar e não se inventou decryptor** → ver **`Brain/decisions/ADR-008`**. Risco registrado: segredos em repouso são plaintext + `service_role` exposta pendente de rotação (pré-requisito do canary remoto).

**Implementado:**
- `Agent/src/adapters/read/supabase-read-database.ts` — `SupabaseReadConfig` (HTTPS+host allowlist+chave em `#privado`, não serializável) + `SupabaseReadOnlyDatabase implements V2ReadDatabase` (PostgREST GET-only via `HttpTransport` injetável; allowlist de tabela/coluna; filtro de tenant obrigatório; redirect recusado; timeout; content-type JSON; erros `SUPABASE_READ_FAILURE` sanitizados; **escrita impossível pelo contrato**).
- `Agent/src/adapters/read/v2-api-key-reader.ts` — `V2PlaintextApiKeyReader implements SecretDecryptor` (leitor de plaintext provado, fail-closed, sem log de segredo).
- `Agent/src/engine/canary-shadow-root.ts` — `CanaryShadowRoot` (tenant/agente explícitos; `mode="shadow"` obrigatório; aborta com gate ativo; monta stack read-only real + QueryRunner; roda via `runShadowHarnessTurn` com EffectGate OFF e sem dispatcher externo; defesa final contra dispatch).
- `Brain/decisions/ADR-008` · `Agent/tests/run-canary-wiring.ts` (33 checks) · `package.json` (`test:canary`).

**Gates:** `test:all` → **378 OK | 0 FALHA** (67+96+34+21+127+**33**); `tsc` limpo; `rg` → `service_role` só em comentário (sem JWT hardcoded); `fetch(` só no `http-client`/`transport.fetch` (adapter); nenhum write (`.delete` = Map/Set); sem Uazapi/WhatsApp/CRM-write/EffectDispatcher/`msg.includes`/`cpf`/`birth_date`/log de segredo nos arquivos novos.

**Bloqueado:** canary remoto, EffectGate ativo, providers reais — até rotação da `service_role`. **Parado para auditoria do Codex (F2.5.4A). NÃO iniciar F2.5.4B/canary remoto sem autorização.**

---

## Atualização Claude — F2.5.4A.1 (correções da auditoria) — 2026-06-28

Codex **reprovou** a F2.5.4A (bloqueadores P1/P2/P3). Implementada **só a F2.5.4A.1**. Baseline reconfirmado (378 OK, tsc limpo) antes de alterar.

**P1 — segredo:** allowlist global trocada por **MATRIZ ESTRITA** por `(tabela, operação, colunas, filtros)` em `SupabaseReadOnlyDatabase`. `api_key_encrypted` só em `platform_integrations`/**selectOne** com `id+user_id+is_active=true` (projeção do CredentialProvider); **proibido** em `selectMany`, outra tabela ou misturado a colunas comerciais → fail-closed.
**P1 — canary vinculado ao agente:** `CanaryShadowRoot.create` agora **async** e carrega/valida `V2TenantConfigSource` antes de expor `runQuery`/`runTurn` (agente existe/ativo/dono/prompt válido/provider válido; senão `CanaryConfigError`). Guarda `TenantRuntimeConfig` **frozen** (`tenantConfig`); prompt como fonte autoritativa (`authoritativePromptText`), **`promptBoundToLlm=false`** (ligação prompt→LLM é fase posterior; não alegada).
**P2 — corpo/projeção:** limite de bytes (content-length + stream real), rejeição atômica de linha malformada, **projeção local** só das colunas pedidas (descarta extras). **P2 — chave:** removido `authHeaders()` público; chave em `#apiKey` privado (não recuperável por API pública/`JSON.stringify`). **P3:** testes renomeados para "transporte PostgREST fake"/"wrapper concreto" (sem alegar "Supabase real").

**Testes:** `run-canary-wiring.ts` 33→**52 checks** (18 adversariais exigidos + extras). **`test:all` = 397 OK | 0 FALHA** (345 não-canary intactos + 52 canary); `tsc` limpo; `rg` sem JWT/fetch-fora-de-adapter/write/EffectDispatcher/Uazapi/CRM-write/`msg.includes`(novos)/`cpf`/`birth_date`/log de segredo.

**Bloqueado:** canary remoto, prompt→LLM, providers — até rotação da `service_role`. **Parado para nova auditoria do Codex (F2.5.4A.1). NÃO avançar para F2.5.4B.**

---

## Atualizacao Codex - F2.5.4A.2 (timeout end-to-end) - 2026-06-28

Codex fechou o ultimo bloqueador da auditoria do wiring Supabase: o mesmo deadline agora cobre fetch, headers e leitura completa do corpo. Stream travado e `cancel()` que nunca resolve falham dentro do prazo com `SUPABASE_READ_FAILURE`, sem deixar o turno pendurado.

Gates: `test:canary` = **54 OK | 0 FALHA**; `test:all` = **399 OK | 0 FALHA**; TypeScript limpo; nenhum I/O remoto ou efeito externo.

**Resultado: F2.5.4A/A.1/A.2 APROVADAS LOCALMENTE.** Proxima fatia: F2.5.4B offline (prompt -> LLM e composicao conversacional real do canary). Canary remoto segue bloqueado ate a rotacao da service_role.
---

## Atualizacao Codex - F2.5.4B (composicao conversacional) - 2026-06-28

F2.5.4B concluida e aprovada localmente. O `CanaryShadowRoot` agora vincula o prompt validado do portal a interpret/propose/compose, prepara interpretacao/catalogo/claims dentro do lease apos carregar o estado e nao aceita mais contexto conversacional inventado pelo chamador.

Provas principais: tool loop real (modelo pede `crm_read` e recebe o fato antes da decisao), uma decisao final, memoria central visivel no turno seguinte, decoder runtime de mutacoes/outcomes/resposta, erros do provider sanitizados e terminal-safe sem silencio.

Gates: `test:canary` = **69 OK | 0 FALHA**; `test:all` = **414 OK | 0 FALHA**; TypeScript limpo; zero provider/rede/efeito real.

**Resultado: F2.5.4B APROVADA LOCALMENTE.** Proximo: F2.5.5 adapter real de modelo + extracao semantica independente, ainda gated; depois rotacao da service_role e canary remoto read-only/shadow.
---

## Atualizacao Codex - F2.5.5 (adapter de modelo estruturado + claims independentes) - 2026-06-28

F2.5.5 concluida localmente. Foi criado um adapter provider-agnostic para modelo estruturado com transporte HTTP injetavel (`StructuredJsonConversationModel`) e uma camada de claims automotivos independente (`LexiconAutomotiveClaimExtractor` + `CompositeClaimExtractor`). Nada chama rede por conta propria: nao existe `fetch` real no adapter novo, e o transporte de testes e fake.

Garantias principais: endpoint HTTPS + host allowlist + apiKey obrigatoria; segredo fica em campo privado e nao aparece em `JSON.stringify`; timeout independente do transporte cooperar; content-type/tamanho/JSON/shape validados; URL com credencial/query e limites numericos invalidos falham fechado; erro de provider vira erro tipado sanitizado; payload do provider segue como `unknown` e ainda passa pelo decoder autoritativo do `PromptBoundConversationAdapter`.

O `ConversationTurnContextPreparer` agora pode combinar o catalogo vivo do tenant com um extrator semantico independente. Isso fecha a brecha em que um veiculo inventado fora do estoque/catalogo nao era detectado pelo extractor baseado somente no catalogo.

Gates finais apos autoauditoria: `test:model` = 26 OK | 0 FALHA; `test:all` = 440 OK | 0 FALHA; `tsc --noEmit` limpo; auditoria estatica sem rede real, Supabase, Uazapi, WhatsApp, EffectDispatcher, service_role ou api_key_encrypted nas fontes novas. Achados de `handoff`/`crm_write` continuam apenas como enums/validacao de contrato no decoder.

Resultado: F2.5.5 APROVADA LOCALMENTE. Proximo passo: F2.5.6, adapter HTTP especifico do provedor LLM real do piloto, ainda offline/fake-first. Depois: rotacao/revogacao da service_role exposta e canary remoto read-only/shadow com credencial nova. EffectGate ativo, WhatsApp, CRM-write, handoff e agenda continuam bloqueados.
---

## Atualizacao Codex - F2.5.6 (OpenAI Chat Completions adapter) - 2026-06-28

F2.5.6 concluida localmente. Foi criado o adapter especifico OpenAI Chat Completions (`Agent/src/adapters/llm/openai-chat-model.ts`) para usar o modelo default do piloto `gpt-4.1-mini`, normalizando `openai/gpt-4.1-mini` e falhando fechado para modelos de outro provider. O adapter fala com o contrato OpenAI `/v1/chat/completions` via transporte injetavel, sem `fetch` real embutido, sem ler `OPENAI_API_KEY` do ambiente e sem fallback automatico para Anthropic/DeepSeek.

Garantias principais: endpoint HTTPS + host allowlist + path fixo `/v1/chat/completions`; rejeita query/hash/credencial embutida; segredo fica em `#apiKey` e nao aparece no body nem em `JSON.stringify`; `response_format` exige JSON; prompt do portal entra no `system`; payload estruturado entra no `user`; timeout aborta transporte travado; erro de provider e sanitizado; resposta invalida/shape estranho falha fechado; decoder autoritativo continua sendo o `PromptBoundConversationAdapter`.

Gates finais: `test:openai` = **32 OK | 0 FALHA**; `test:all` = **472 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica nas fontes novas sem rede real, Supabase, Uazapi, WhatsApp, EffectDispatcher, CRM-write, handoff, agenda, `service_role` ou `api_key_encrypted`.

Resultado: F2.5.6 APROVADA LOCALMENTE. Proximo passo: F2.5.7 wiring controlado do adapter OpenAI no canary/bootstrap real, ainda shadow, com chave OpenAI injetada de forma segura. Antes de qualquer canary remoto: rotacionar/revogar a `service_role` exposta e usar credencial nova. EffectGate ativo, WhatsApp, CRM-write, handoff e agenda continuam bloqueados.
---

## Atualizacao Codex - F2.5.7 (OpenAI canary root wiring) - 2026-06-28

F2.5.7 concluida localmente. O CanaryShadowRoot agora aceita modelFactory(runtimeConfig), permitindo carregar o agente, o prompt e o modelo do tenant antes de materializar o adapter OpenAI. Foi criado Agent/src/engine/openai-canary-root.ts com OpenAiRuntimeSecret, createOpenAiModelFactory e createOpenAiCanaryShadowRoot.

Garantias principais: chave OpenAI encapsulada em campo privado e redigida em JSON.stringify; modelo vem do tenant/agente e openai/gpt-4.1-mini e normalizado para gpt-4.1-mini; model=null cai no default gpt-4.1-mini; modelo de outro provider falha fechado, sem fallback silencioso; prompt do portal chega ao system; turno shadow completo roda interpret/propose/compose via adapter OpenAI fake; nenhum EffectOutcome e aplicado e nenhum dispatch real acontece.

Gates finais: test:openai-root = 15 OK | 0 FALHA; test:all = 487 OK | 0 FALHA; tsc --noEmit limpo; package.json validado; auditoria estatica nas fontes novas/alteradas sem fetch real, OPENAI_API_KEY, Deno.env, process.env, Supabase secret, Uazapi, WhatsApp, EffectDispatcher, CRM-write, handoff, agenda ou parsing simplista.

Resultado: F2.5.7 APROVADA LOCALMENTE. Proximo passo: F2.5.8 canary remoto shadow-only, mas isso exige antes rotacionar/revogar a service_role exposta e usar credencial nova. Ate la, chamada remota real para OpenAI/Supabase, WhatsApp, CRM-write, handoff e agenda seguem bloqueados.
---

## Atualizacao Codex - F2.6A (pilot isolation gate) - 2026-06-28

Criado o primeiro alicerce de ativacao real: um gate deterministico de piloto, duplicado nos contratos do Pedro v3 e no webhook vivo do Pedro v2, que so autoriza o par exato `tenant_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0` + `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185`. Email, nome do agente, instancia, fallback de agente e primeiro ativo nao autorizam.

No webhook vivo (`humanizeia`), `PEDRO_V3_PILOT_MODE` aceita `off|shadow|active`, default `off`. Mesmo em `active`, esta fase ainda nao liga o handler ativo do v3; o webhook registra o match e cai para o Pedro v2 para nao deixar lead sem resposta ate os dispatchers reais ficarem prontos. Build v2 bumpado para `2026-06-28-pedro-v3-pilot-gate-v219`.

Gates finais: v2 `offline.ts v3-gate` = 6 OK; v2 `offline.ts` = **405 OK | 0 FALHA**; v3 `test:pilot` = 8 OK; v3 `test:all` = **495 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem rede/segredo/effect dispatcher/CRM-write/handoff/Uazapi nos arquivos novos do gate.

Resultado: F2.6A aprovada localmente. Proxima fase: F2.6B, active runtime/dispatchers reais do piloto, usando este gate como pre-condicao obrigatoria.
---

## Atualizacao Codex - F2.6B (WhatsApp active effects isolado) - 2026-06-28

F2.6B concluida localmente como adapter ativo isolado de WhatsApp. Foi criado `Agent/src/adapters/effects/whatsapp-dispatcher.ts`, que implementa `EffectDispatcher` para `send_message` e `send_media` usando `WhatsAppSendPort` injetado, sem rede embutida, sem Uazapi importada diretamente e sem segredo no adapter.

Garantias: texto invalido falha fechado sem chamar sender; mensagem critica com receipt apenas `accepted` nao atualiza memoria; `delivered` aplica outcome; fotos sao resolvidas no momento do envio via `VehiclePhotoSource`; foto ambigua/ausente falha fechado; idempotency key de midia e escopada por `photoId`; excecoes do sender viram `outcome_uncertain` sanitizado.

Gates finais: `test:active-effects` = **20 OK | 0 FALHA**; `test:all` = **515 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi/segredo/CRM/handoff ativo nos arquivos novos da fatia.

Resultado: F2.6B APROVADA LOCALMENTE. Importante: isso ainda NAO liga o Pedro v3 no WhatsApp real. Proxima fase: F2.6C, sender Uazapi real + politica honesta de receipt (`accepted` vs `delivered`) + depois CRM/handoff/briefing.
---

## Atualizacao Codex - F2.6C (Uazapi sender isolado) - 2026-06-28

F2.6C concluida localmente. Foi criado `Agent/src/adapters/effects/uazapi-whatsapp-sender.ts`, um `WhatsAppSendPort` para Uazapi com transporte HTTP injetado, sem `fetch` direto, sem import do sender v2 e sem segredo no estado/config/outbox.

O contrato de credenciais foi ampliado para `provider="uazapi"` e `purpose="whatsapp_instance"`, mantendo o segredo como `SecretRef` opaco e resolvido somente no ponto de envio. O fake de credenciais foi ajustado para o provider novo.

Garantias: base URL HTTPS + host allowlist; telefone normalizado; texto usa endpoints compativeis com v2; midia exige HTTPS; corpo de erro remoto nao e propagado; token nao aparece em JSON do sender; Uazapi HTTP OK vira receipt `accepted`, nao `delivered`.

Gates finais: `test:active-effects` = **38 OK | 0 FALHA**; `test:all` = **533 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi-v2/segredo/CPF/service_role/env nas fontes de effects.

Resultado: F2.6C APROVADA LOCALMENTE. Proxima fase: F2.6D, wiring do runtime ativo do piloto com leitura segura de `wa_instances` e factory do dispatcher, ainda sem liberar handoff/CRM-write antes dos adapters proprios.
---

## Atualizacao Codex - F2.6D (Pilot WhatsApp runtime factory local) - 2026-06-28

F2.6D local concluida. Foi criado `Agent/src/adapters/effects/pilot-whatsapp-runtime.ts`, que monta o dispatcher ativo do piloto a partir de `TenantConfigSource`, `WhatsAppInstanceSource`, `CredentialProvider`, `UazapiWhatsAppSender`, `VehiclePhotoSource` e `Clock`.

Garantias: agente sem `instanceId` bloqueia; instancia inexistente bloqueia; ownership tenant/instance e revalidada; provider diferente de Uazapi bloqueia; instancia Uazapi propria cria dispatcher e envia via sender fake retornando `accepted`.

Gates finais: `test:active-effects` = **43 OK | 0 FALHA**; `test:all` = **538 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi-v2/segredo/CPF/service_role/env nas fontes de effects.

Resultado: F2.6D APROVADA LOCALMENTE. Proxima fase: F2.6E, leitura real e segura de `wa_instances`/token da instancia do v2 para permitir o primeiro active pilot controlado.
---

## Atualizacao Codex - F2.6E (wa_instances read-side seguro para piloto) - 2026-06-28

F2.6E concluida localmente. A ponte ativa do WhatsApp agora tem leitura segura e tipada da instancia do v2: `wa_instances` entrou na matriz read-only do `SupabaseReadOnlyDatabase`, com metadata separada de segredo, token permitido somente em `selectOne` por `id + user_id`, e bloqueio explicito para leitura em lote ou sem escopo de tenant.

Foram criados `V2WhatsAppInstanceSource` e `V2WhatsAppInstanceCredentialProvider`. A instancia valida ownership por tenant, trata provider ausente como `uazapi` por compatibilidade com o v2, marca providers nao suportados como `unsupported` sem casts forjados, e resolve token apenas via `SecretRef(provider="uazapi", purpose="whatsapp_instance")` no ponto de uso.

Garantias: metadata de instancia nunca seleciona `api_key`/`api_key_encrypted`; credential read exige `id+tenant`; cross-tenant retorna null; provider Meta/unsupported nao resolve token Uazapi; comentario/matriz do Supabase alinhados; runtime ativo continua bloqueando agente sem `instanceId`.

Gates finais: `test:canary` = **74 OK | 0 FALHA**; `test:active-effects` = **50 OK | 0 FALHA**; `test:all` = **550 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem sender v2, service_role, CPF/birth_date, env, console log ou segredo materializado em estado/config/outbox. `fetch` segue encapsulado somente no adapter PostgREST read-only.

Resultado: F2.6E APROVADA LOCALMENTE. Proxima fase: F2.6F, plugar o runtime ativo do piloto ao webhook/entrypoint com `PEDRO_V3_PILOT_MODE=active`, mantendo fallback seguro se o agente Aloan ainda estiver sem `instance_id` conectado. CRM-write, handoff, briefing e agenda continuam bloqueados ate adapters proprios e testes equivalentes.
---

## Atualizacao Codex - F2.6F (active pilot root local) - 2026-06-28

F2.6F concluida localmente. Foi criado `Agent/src/engine/pilot-active-root.ts`, o composition root ativo do piloto: ele valida o escopo exato do Pedro v3 (`tenant_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0` + `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185`), carrega config/prompt/estoque/CRM read-only, prepara contexto conversacional, ingere o inbound no `v3_inbox`, roda `ConversationEngine`, materializa outbox e despacha somente WhatsApp via Uazapi quando o gate da conversa esta ativo.

Garantias novas: agente fora do piloto nao cria root; agente sem `instance_id` falha fechado; webhook duplicado (`eventId` repetido) nao reprocessa nem reenvia; prompt do portal chega ao modelo; receipt Uazapi `accepted` nao inventa entrega nem aplica memoria de resposta; `handoff`/CRM/agenda continuam sem provider ativo e caem em resposta segura, sem transferencia silenciosa.

Foi criada a suite `Agent/tests/run-active-root.ts` e o script `test:active-root`, agora incluido em `test:all`.

Gates finais: `test:active-root` = **10 OK | 0 FALHA**; `test:all` = **560 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem `fetch`, env, `service_role`, CPF/data nascimento, segredo em fonte nova ou fallback por email/primeiro agente.

Resultado: F2.6F APROVADA LOCALMENTE. Ainda NAO esta plugado no webhook vivo do Supabase. Proxima fase: F2.6G, criar o entrypoint/bridge Deno seguro para o `pedro-webhook-v2` chamar o Pedro v3 somente no piloto, mantendo fallback para v2 se bootstrap/commit falhar antes do envio. Depois disso vem deploy controlado com `PEDRO_V3_PILOT_MODE=active` apenas para o agente Aloan.
---

## Atualizacao Codex - F2.6G (servico HTTP + bridge + EasyPanel) - 2026-06-28

F2.6G concluida e aprovada para publicacao com o piloto ainda OFF. O servico Node real, o bridge Deno do webhook v220, dedupe/retry de inbox, contrato anti-resposta-dupla e pacote Docker/EasyPanel foram implementados. O codigo do Pedro v3 foi sincronizado para `humanizeia/services/pedro-v3` para build pelo GitHub/EasyPanel.

Gates: Pedro v3 **579 OK | 0 FALHA**; Pedro v2 offline **414 OK | 0 FALHA**; TypeScript limpo; bundle webhook OK; health local 200; dependencia de runtime atualizada e instalacao final com 0 vulnerabilidades.

Auditoria encontrou bloqueador antes do active: Uazapi send retorna `accepted`, enquanto a memoria autoritativa so avanca com `delivered`. A especificacao oficial oferece `messages_update`, mas o callback ainda nao esta ligado. Para nao recriar repeticao de perguntas, `PEDRO_V3_PILOT_MODE` permanece `off` ate a F2.6H (receipt callback idempotente por providerMessageId). Audio sem texto, CRM-write, handoff, briefing e agenda tambem ainda nao entram no v3 ativo.

Resultado: F2.6G APROVADA PARA PUSH/BUILD, NAO PARA ATIVACAO. Proxima fase obrigatoria: F2.6H.
---

## Atualizacao Claude - F2.6H (receipt callback messages_update) - 2026-06-28

Claude auditou e finalizou a F2.6H (estava no working tree, nao commitada). Fecha o bloqueador do F2.6G:
Uazapi devolve `accepted`, a memoria so avanca com `delivered`; agora o callback `messages_update` promove
o outbox por `providerMessageId` de forma idempotente, sem reenviar. **Piloto continua OFF.**

Verificado nos 6 requisitos (handoff `handoffs/2026-06-28-claude-f2.6h-receipt-callback.md`):
- Endpoint `POST /v1/pilot/receipt` (`pilot-http-app.ts`): bearer igual ao turno (`timingSafeEqual`), escopo
  piloto exato (403), so `delivered`/`read` (400), erros sanitizados, runner real wirado no `server.ts`.
- SQL manual `Brain/sql/v3_f2_6h_receipt_patch.sql`: RPC tenant-scoped `v3_find_outbox_by_provider_message_id`,
  ambiguidade falha fechado (`limit 2` + adapter `!==1`), `revoke public`/`grant service_role`.
- Persistencia: `findOutboxByProviderMessageId` via RPC allowlist; `accepted` nao avanca, `delivered`/`read`
  avanca idempotente (`provider-delivery-receipt.ts` com guarda `duplicate`; `commitEffectOutcome` CAS).
- Uazapi sender: captura `messageid` + `track_id/track_source`; nao reenvia em duplicado.
- Bridge v2: `messages_update` interceptado antes do `fromMe`; identidade hardcoded do piloto; nao inicia
  conversa nova; nao-piloto ignorado; `callPedroV3ReceiptBridge` com timeout/anti-SSRF/sem token no retorno.
  Correcao defensiva: guarda seller × message_update (nao polui inbox do vendedor).
- Build webhook `v220` -> `2026-06-28-pedro-v3-delivery-receipt-v221`.

Gates reais: v3 `test:all` EXIT=0; `tsc --noEmit` limpo; v2 offline **417 OK | 0 FALHA** (3 testes
`v3-bridge` novos); bundle webhook esbuild EXIT=0; scan de segredos/dispatch limpo.

Pendente p/ dono (pre-ativacao, fora desta rodada): rodar o SQL patch; ao conectar a instancia do Aloan,
garantir `messages_update` no webhook (path moderno ja inclui; nao re-sync via `sync-uazapi-webhook`); ENV
`PEDRO_V3_SERVICE_URL`/`PEDRO_V3_BRIDGE_SECRET`; rotacao da `service_role`. `PEDRO_V3_PILOT_MODE` segue OFF.

Resultado: **F2.6H entregue para auditoria do Codex.** Sem deploy, sem `db push`, sem CRM/handoff/agenda.
---

## Atualizacao Claude - F2.6I (prep de ativacao controlada) - 2026-06-28

**F2.6H APROVADA pelo Codex** (commit `c1f216b7`; SQL `v3_f2_6h_receipt_patch.sql` rodado pelo dono:
`index_ok=true`, `function_ok=true`; gates re-rodados verdes). F2.6I = **so documentacao/auditoria da
ativacao**. Nenhuma alteracao de codigo, banco, deploy ou ativacao. `PEDRO_V3_PILOT_MODE` continua OFF.

Entregas (handoff `handoffs/2026-06-28-claude-f2.6i-prep-ativacao.md` + `README.md` operacional):
- **ENVs autoritativas (lidas do `server.ts`)**: servico EasyPanel = `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY`, `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` (CSV, obrigatoria), `PEDRO_V3_BRIDGE_SECRET` (>=32),
  `PEDRO_V3_OPENAI_MODEL`/`PORT` (opcionais). Webhook = `PEDRO_V3_PILOT_MODE`, `PEDRO_V3_SERVICE_URL`,
  `PEDRO_V3_BRIDGE_SECRET` (identico). **Correcoes vs missao**: e `PEDRO_V3_BRIDGE_SECRET` (nao `_SERVICE_SECRET`);
  `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` faltava; `PEDRO_V3_PILOT_MODE` e do webhook, nao do EasyPanel.
- **instance_id (BLOQUEIO factual)**: o v3 le `instance_id` singular (`pilot-active-root.ts:140`);
  Aloan tem `instance_id=NULL` -> falha fechado. `instance_ids` aponta p/ `fdd6cbe1` que **nao existe** (orfa).
  Instancia REAL = **`6476a393`** (nome aloan, uazapi, connected, dona=piloto, phone 558597895634). Remediacao =
  o DONO seta `instance_id=6476a393` apos confirmar a linha (SQL no handoff). Nao inventei instancia.
- **messages_update**: validar via `GET /webhook/find/aloan`; sync pontual so da instancia piloto preparado
  (nao executado, sem script runnable commitado); nao usar `sync-uazapi-webhook` (removeria o evento).
- **Checklist ativacao** (off->shadow->active) + **rollback** (PILOT_MODE=off volta 100% ao v2) documentados.

Gates: nenhum codigo alterado nesta fatia (so docs) -> gates da F2.6H seguem validos; `git status` limpo
fora de docs. Build webhook segue `v221`.

Resultado: **F2.6I entregue para auditoria do Codex.** Bloqueios p/ ativar: setar `instance_id`,
`messages_update` na instancia, ENVs/deploy. `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6J (chave OpenAI BYOK por tenant) - 2026-06-28

Codex achou bloqueador pre-ativacao: `server.ts` exigia `OPENAI_API_KEY` global. O produto e BYOK —
a chave vem do perfil do tenant, como o v2 (`_shared/aiKeys.ts` -> RPC `get_client_ai_key`). Corrigido.

- **Removida** a env global `OPENAI_API_KEY` do servico (campo `#openAiKey` + `requiredEnv` fora).
- **Novo** `Agent/src/adapters/read/tenant-openai-key.ts` -> `resolveTenantOpenAiSecret({gateway, tenantId})`
  chama a mesma RPC service-role do v2 `get_client_ai_key(p_user_id, p_provider="openai")` (adicionada ao
  allowlist do gateway). Resolvida POR TENANT no `run()`, sem fallback global/plataforma.
- **Fail-closed + sanitizado**: sem chave do tenant -> `OPENAI_KEY_NOT_FOUND` -> `PILOT_BOOTSTRAP_FAILED`
  (ingested=false, sem dispatch/dupla); erro de leitura -> `OPENAI_KEY_LOOKUP_FAILED` (nao vaza corpo/segredo).
- **Sem vazamento**: chave volta so embrulhada em `OpenAiRuntimeSecret` (opaca; `toJSON` nao expoe;
  liberada so via `materialize` no header). `PEDRO_V3_OPENAI_MODEL` segue como NOME do modelo, nao credencial.
- **Docs**: README sem `OPENAI_API_KEY` nas obrigatorias + nota BYOK; handoff F2.6I corrigido.

Gates: `test:all` EXIT=0 (+ `TENANT OPENAI KEY: 18 OK` adversariais); `tsc` limpo; offline v2 **417 OK**;
bundle N/A (nao toquei webhook/bridge); scan: `OPENAI_API_KEY` fora das fontes v3, sem log de segredo.

Pre-requisito pre-ativacao: o tenant piloto precisa ter chave OpenAI cadastrada no perfil (Vault) —
`get_client_ai_key(ecb26258,'openai')` nao-vazio. Handoff `handoffs/2026-06-28-claude-f2.6j-byok-openai-por-tenant.md`.

Resultado: **F2.6J entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6K (grandfather BYOK + chave da plataforma) - 2026-06-29

Bloqueador (dono/Codex): a conta piloto NAO tem chave OpenAI propria — usa a da PLATAFORMA (grandfathered),
como Bruno/Wander. A F2.6J deixou o v3 so com `get_client_ai_key` -> quebraria contas grandfathered.

Correcao: mesmo 3-tier do v2 (`_shared/aiKeys.ts`) no resolver `tenant-openai-key.ts`:
1. client key propria (`get_client_ai_key`); 2. GRANDFATHERED sem propria -> chave da PLATAFORMA; 3. nova
sem propria -> fail-closed. `BYOK_GRANDFATHER_CUTOFF=2026-06-16T03:00:00Z` (mesma do v2); grandfather le
`profiles.created_at` com **fail-open** (igual `isAccountGrandfathered`).

Caminho backend SEGURO da chave da plataforma (sem env no EasyPanel): nova RPC service-role
`get_platform_ai_key(p_provider)` lendo do **Vault** (`vault.decrypted_secrets`) — SQL MANUAL em
`Brain/sql/v3_f2_6k_platform_ai_key.sql` (nao executado). Gateway: allowlist + RPC `get_platform_ai_key`
e tabela `profiles` (so `created_at`). Chave nunca em env/log/estado/outbox/erro/JSON (so via `materialize`).

Gates: `test:all` EXIT=0 (+ `TENANT OPENAI KEY: 26 OK` adversariais, incl. fail-open de profile, cross-tenant,
boundary do cutoff, no-leak client+platform); `tsc` limpo; offline v2 **417 OK**; bundle N/A; scan limpo.

PASSO MANUAL DO DONO (pre-ativacao): rodar `v3_f2_6k_platform_ai_key.sql` + cadastrar o secret
`platform_openai_api_key` no Vault (a mesma chave do `OPENAI_API_KEY` do v2). Sem isso, conta grandfathered
cai em fail-closed (degrada pro v2). Handoff `handoffs/2026-06-29-claude-f2.6k-grandfather-platform-key.md`.

Resultado: **F2.6K entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6L (observabilidade da falha de turno) - 2026-06-29

Dono reportou: print mostra o v2 respondendo na conta Aloan (v3 nao pegou). Diagnostico read-only:
- AGORA o webhook NAO roteia pro v3 (teste real na instancia aloan: sem `routed:pedro_v3`, 0 evento novo no
  v3_inbox, v2 respondeu) -> `PEDRO_V3_PILOT_MODE` nao esta `active`.
- Quando ESTEVE active: 5 eventos no v3_inbox `pending`/`attempts=5`/sem claim/sem last_error/outbox=0 -> o
  turno falha DEPOIS do ingest, antes de produzir saida, e cai no v2.
- Pre-reqs OK (instance_id, secret no Vault, RPC, grandfathered). **Chave OpenAI DESCARTADA**: testei a chave
  da plataforma (Vault) contra a OpenAI -> GET /models 200 + chat gpt-4.1-mini 200 (valida). A falha e runtime.

F2.6L: tornar a falha diagnosticavel pelo BANCO (o erro hoje so existe no log do EasyPanel).
- `sanitize-error.ts` (sanitizeTurnError: name:code:msg truncado, redige sk-/JWT/Bearer) +
  `server.ts` grava o motivo sanitizado em `v3_inbox.last_error` no catch do turno (best-effort, so ingerido) +
  RPC manual `v3_record_inbox_error` (Brain/sql/v3_f2_6l_inbox_error.sql, tenant-scoped, service-role) +
  allowlist no gateway + `run-sanitize-error.ts` (7 testes).
Gates: test:all EXIT=0 (+ SANITIZE ERROR 7, TENANT OPENAI 26); tsc limpo; offline v2 418 OK; scan limpo.

PASSOS DO DONO p/ revelar a raiz: (1) rodar `v3_f2_6l_inbox_error.sql`; (2) redeploy do servico v3 no
EasyPanel; (3) `PEDRO_V3_PILOT_MODE=active`; (4) avisar -> eu disparo 1 turno e LEIO `v3_inbox.last_error` ->
raiz -> corrijo. (Alternativa: colar o log do servico v3 no EasyPanel.) Handoff
`handoffs/2026-06-29-claude-f2.6l-observabilidade-falha-turno.md`.

Resultado: **F2.6L entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6M (surfacar commit_failed do engine) - 2026-06-29

Diagnostico avancou: log do servico v3 (EasyPanel) mostrava SO `pedro_v3_service_started` (3 deploys),
sem turno e sem erro; `v3_inbox.last_error` vazio mesmo apos o F2.6L. **Raiz da invisibilidade**: o
`conversation-engine.ts` (catch ~214) **falha GRACIOSAMENTE** — libera o claim e RETORNA
`{status:"commit_failed", reason:<msg do erro>}` SEM lancar e SEM logar. Logo o `catch` do server.ts (F2.6L)
nunca dispara, e o `reason` so vivia no retorno.

Fix F2.6M (server.ts, fora do engine puro): apos `root.runTurn`, se `result.status==="commit_failed"`,
**loga** `pedro_v3_turn_commit_failed` (console.error -> EasyPanel) + **grava** o reason sanitizado em
`v3_inbox.last_error` (RPC F2.6L). Agora a falha aparece NO LOG e NO BANCO. Sanitizado; best-effort no banco.

Gates: test:all EXIT=0; tsc limpo; offline v2 418 OK. EasyPanel faz auto-deploy no push.
Proximo: dono manda 1 "tem onix" apos o auto-deploy -> leio `v3_inbox.last_error` (ou o log) -> corrijo a raiz real.

Resultado: **F2.6M no ar pelo auto-deploy.** `PEDRO_V3_PILOT_MODE` segue active (piloto); sem db push/rotacao.
---

## Atualizacao Claude - F2.6N (ROOT CAUSE: double-encoding no filtro PostgREST) - 2026-06-29

O F2.6M revelou o `last_error` real: **`Error: claimed inbox record missing`** (`conversation-engine.ts:128`).
Investiguei: `claimBurst` claima N eventos mas `get(eventId)` devolve null -> mismatch -> falha todo turno.

**Raiz**: DOUBLE-ENCODING no `SupabaseServiceGateway.encodeFilter`. O `event_id` real e `uazapi:<hash>`
(com `:`). `encodeFilter` fazia `encodeURIComponent` -> `%3A`, e o `URLSearchParams.toString()` re-encodava
o `%` -> `%253A`. O PostgREST entao procurava `event_id="uazapi%3A<hash>"` literal -> nao casava ids com `:`
-> `get()=null` -> "claimed inbox record missing" -> turno falha sempre -> sem resposta -> fallback v2.
Passou despercebido pq RPCs mandam args no body JSON (sem esse encoding) e os testes usavam ids sem `:`.

**Fix**: `encodeFilter` retorna `eq.${String(value)}` (cru); o `URLSearchParams` encoda UMA vez. Teste novo
`run-gateway-filter.ts` (5 checks) prova single-encoding p/ `:`-ids. Gates: test:all EXIT=0 (+ GATEWAY FILTER 5),
tsc limpo, offline v2 418 OK.

Proximo: auto-deploy -> dono manda "tem onix" -> verifico `v3_inbox.status=done` + `v3_effect_outbox` com a
resposta + WhatsApp recebe do v3. Backlog de 6 eventos do conversation `wa:8ed1...` auto-cura no 1o turno.
Handoff `handoffs/2026-06-29-claude-f2.6n-fix-double-encoding-claim.md`.

Resultado: **F2.6N no ar pelo auto-deploy — provavel destravamento do piloto.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6O (enriquecer HTTP_FAILURE do gateway) - 2026-06-29

Pos-F2.6N: o "claimed inbox record missing" SUMIU (fix do encoding pegou), mas o turno agora avanca e
falha em `Error: HTTP_FAILURE` (uma chamada ao gateway Supabase retornou nao-2xx — provavel `load`
de v3_conversation_state OU o `commit` v3_commit_turn, que NUNCA eram exercitados antes pq o get() quebrava).
Os logs da API (get_logs) sao dominados por v2/portal/crons e nao isolam a chamada do servico v3.

Fix F2.6O: `SupabaseServiceGatewayError` ganha `detail` e o throw de `!response.ok` agora inclui
**metodo + rota + status** (ex.: "HTTP_FAILURE POST /rest/v1/rpc/v3_commit_turn 400") — sem query/segredo.
Assim o `v3_inbox.last_error` (via F2.6M) vai dizer EXATAMENTE qual chamada falhou e o status.
Teste `run-gateway-filter.ts` (+2 checks: inclui status/rota/metodo; nao vaza service-role-key). Gates:
test:all EXIT=0, tsc limpo, offline v2 418.

Proximo: auto-deploy -> dono manda "tem onix" -> leio o `last_error` enriquecido -> corrijo a chamada exata.

Resultado: **F2.6O no ar pelo auto-deploy.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6P (2a ROOT CAUSE: falso-positivo de CPF barra o commit) - 2026-06-29

F2.6O revelou o ponto exato: **`HTTP_FAILURE POST /rest/v1/rpc/v3_commit_turn 400`**. Log do Postgres:
**`v3_turn_events_payload_ck` violado**. Provado no banco: o payload do evento `turn_claimed` inclui os
`event_ids` do uazapi (hash hex 64 chars); um hash com **11 digitos seguidos** (`77842555836`) batia no
heuristico de CPF de `v3_payload_is_redacted` -> check rejeita -> 23514 -> PostgREST 400 -> turno falha sempre.
As bordas `[^0-9]` tratavam letras hex como delimitador. Nunca rodou contra Postgres real (get() quebrava antes).

**Fix**: `v3_payload_is_redacted` usa **word-boundary `\y`** no regex de CPF. Hash (grudado em alfanumerico)
nao casa; CPF real (formatado OU cru, cercado por borda) continua barrado. `v3_schema.sql` atualizado +
migration `sql/v3_f2_6p_redaction_cpf_boundary.sql` (DONO roda no SQL Editor — fix e no BANCO). Teste
run-sql-schema.ts +3. Gates: test:all EXIT=0, SQL 41 OK, tsc limpo, offline v2 418.

⚠️ Risco residual (PRE-EXISTENTE, fora do escopo): o check ainda barra telefone BR (11 digitos)/protocolo que
o agente escreva no texto, e e FATAL. Revisitar com Codex (so CPF formatado? nao-fatal?). Handoff
`handoffs/2026-06-29-claude-f2.6p-fix-cpf-false-positive.md`.

Proximo: dono roda a migration + manda "tem onix" -> commit suceder -> v3 RESPONDE (status=done + outbox + msg).

Resultado: **F2.6P pronto — codigo commitado; AGUARDA o dono rodar a migration SQL.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6Q (3a ROOT CAUSE: envio uazapi + observabilidade do dispatch) - 2026-06-29

Dono rodou o SQL do F2.6P + testou: **commit PASSOU** (`v3_inbox` 11 eventos `done`, backlog auto-curado) e o
v3 gerou um `send_message`. MAS ficou `outcome_uncertain` com receipt `sender_text_exception` -> o ENVIO
estourou. Investiguei: `INSTANCE_SECRET_COLUMNS` (credential provider) selecionava **`api_key`**, coluna que
**NAO existe** em `wa_instances` (so `api_key_encrypted`, confirmado no information_schema) -> `select=...,api_key`
-> PostgREST 400 -> gateway de leitura lanca -> o `catch {}` VAZIO do dispatcher devolvia so "sender_text_exception".

**Fix**: (1) remover `api_key` de INSTANCE_SECRET_COLUMNS (token mora em `api_key_encrypted`); (2) observabilidade:
`safeErrLabel` poe um rotulo SEGURO no reason (name+code do erro, NUNCA a mensagem -> sem vazar token) + console.error.
Testes +2 (run-active-effects 53 OK). Gates: test:all EXIT=0, tsc limpo, offline 418. **Fix PURO de codigo (sem SQL)**.

Proximo: auto-deploy -> dono manda "tem onix" -> `resolve()` pega o token -> `sendText` POSTa -> outbox
`succeeded`/`accepted` + **mensagem chega no WhatsApp** (resposta REAL, backlog ja limpo).
Pendencias p/ revisitar: resolve-throw deveria ser failed+retryable (nao uncertain); risco CPF/telefone do F2.6P.
Handoff `handoffs/2026-06-29-claude-f2.6q-fix-uazapi-send.md`.

Resultado: **F2.6Q no ar pelo auto-deploy — provavel ultimo tijolo do envio.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6R (alinhar prompt ao contrato de decisao — fim do loop) - 2026-06-29

⭐ **MARCO: o Pedro v3 responde de PONTA A PONTA no WhatsApp do Aloan** (recebe->decide->commita->envia->chega).
As 3 travas de infra cairam (F2.6N encoding, F2.6P CPF, F2.6Q coluna do token). Mas respondia sempre a MESMA
frase de fallback ("Desculpe a lentidao temporaria...") = loop. Causa: `v3_decisions` mostrava
`MODEL_DECISION_INVALID` no `propose`.

Raiz: `operationInstructions("propose")` (openai-chat-model.ts) dizia "return JSON matching DecisionStep/
ProposedDecision" mas **NUNCA descrevia o envelope** -> o modelo nao tinha como produzir -> rejeitado ->
`emitErrorTerminalSafe` (finalizer:309) -> safe-terminal. (Os testes usam modelo FAKE com envelope ja certo.)
Achado: no finalizer, `effectPlan = proposal.proposedEffects` — sem auto-send_message; o modelo PRECISA emitir
o efeito send_message para responder.

Fix: reescrevi `operationInstructions` dos 3 passos (interpret/propose/compose) com o envelope EXATO + exemplos +
a regra do send_message; conservador (`facts:[]`, sem mutacoes de estado neste corte — slot/objetivo e a proxima
iteracao). Observabilidade: `ModelOutputError` ganha `detail` (campo que falhou, ex.: `MODEL_DECISION_INVALID:
proposedEffects`) -> aparece em `v3_decisions.reason_summary`. Teste +1 (run-model-adapter 27 OK). Gates: test:all
EXIT=0, tsc limpo, offline 418, secret scan limpo. **Fix de prompt — validacao real e AO VIVO** (sem SQL).

Proximo: auto-deploy -> dono manda "tem onix" -> leio `v3_decisions`: `action` real (nao error/terminal_safe) +
resposta REAL no WhatsApp. Se falhar, o reason_summary aponta o campo -> itero (pode levar 1-2 rodadas).
Pendencias: facts ricos (slots/objetivos); CPF/telefone (F2.6P); resolve-throw=>uncertain (F2.6Q); avaliar json_schema.
Handoff `handoffs/2026-06-29-claude-f2.6r-decision-envelope-prompt.md`.

Resultado: **F2.6R no ar pelo auto-deploy — deve dar respostas REAIS (fim do loop).** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.1 (anti-filler + responder a pergunta real) - 2026-06-29

✅ F2.6R confirmado AO VIVO: o Aloan respondeu de verdade (apresentou-se, pegou cidade/nome, seguiu funil).
Inicio da **FASE F2.7 (naturalidade/paridade UX com v2)**, ordem do dono: 1) anti-filler+responder-pergunta;
2) testes adversariais; 3) DESENHO do debounce no Brain (parar p/ Codex); 4) digitando depois.

F2.7.1 (etapa 1): regras NO CEREBRO (instrucoes do adapter, sem if por frase, sem if p/ "onix"):
- **propose**: responsePlan.guidance = "responder PRIMEIRO o que o lead perguntou (so facts/state reais), DEPOIS 1
  pergunta de funil se faltar qualificacao" + RULES "ANSWER FIRST" (nunca ignorar pergunta pra empurrar funil; se
  faltar dado, query antes) e "NO EMPTY CONTENT".
- **compose**: "ANSWER FIRST, then qualify" + proibe abrir com afirmacao vazia ("Que otimo"/"Perfeito"/...).
Gates offline: test:all EXIT=0, tsc limpo (⚠️offline usa modelo FAKE -> nao valida comportamento do LLM).

Suite adversarial (autoro+julgo, rodada no piloto ao vivo — dono envia, eu leio v3_effect_outbox+v3_decisions):
A "tem Onix?" no meio da qualificacao; B nome depois pergunta estoque; C "ok/sim/gostei"; D valor/foto/modelo
especifico; E nenhuma resposta abre com filler; F info util + 1 pergunta de funil quando qualificando. So "verde"
quando A-F passam consistente; se falhar, fortaleco a instrucao (1-2 rodadas).
Handoff `handoffs/2026-06-29-claude-f2.7.1-anti-filler-answer-first.md`.

Resultado: **F2.7.1 no ar pelo auto-deploy; aguardando rodada adversarial ao vivo.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.2 (desbloquear estoque: feed http->https) - 2026-06-29

Teste adversarial da F2.7.1 mostrou: anti-filler OK (respostas limpas, sem filler), MAS o agente nao confirmava
estoque (`unable_to_confirm_stock`). Raiz (banco): o feed RevendaMais do Aloan esta cadastrado como
**`http://app.revendamais.com.br`** (dado legado v2); o `SafeHttpClient` rejeitava http (HTTPS_REQUIRED, decisao
de seguranca deliberada) -> estoque 100% bloqueado (sem fallback BNDV).

Fix (aprovado pelo dono): `SafeHttpClient.validateUrl` NORMALIZA http->https (mais seguro que rejeitar; allowlist
de host + anti-SSRF de IP seguem barrando host nao previsto) + `executeSingleFetch` agora baixa a URL JA
normalizada (corrige bug latente: validava uma, baixava a crua). ⚠️REVERTE a decisao "rejeitar http" -> SINALIZADO
p/ re-auditoria do Codex (alternativa: corrigir o dado e manter v3 estrito; implementei o upgrade por ser
resiliente p/ feeds legados). Testes run-read-side 129 OK (+http-normaliza, +http-fora-allowlist-bloqueado,
+safeFetch-baixa-https); test:all EXIT=0, tsc limpo, offline 418.

Pendencias anotadas: fotos http descartadas (parseVehiclePhotos) -> afeta send_photos depois; timeout do propose
(1 ocorrencia, provavel latencia transitoria da OpenAI) -> MONITORAR.
Handoff `handoffs/2026-06-29-claude-f2.7.2-stock-feed-https-upgrade.md`.

Proximo: dono re-roda adversariais (com estoque acessivel) -> julgo A-F -> etapa 3 (DESENHO do debounce, parar p/ Codex).

Resultado: **F2.7.2 no ar pelo auto-deploy; aguardando re-teste com estoque acessivel.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.3 (observabilidade do deny de grounding no compose) - 2026-06-29

Re-teste do dono ("Ola/Conheço/tem onix?/Até 80k?") -> "mesma coisa". Diagnostico em v3_decisions: greeting+
qualify_name OK; o burst AGREGOU "tem onix?"+"Até 80k?" num turno (✅), MAS deu `terminal_safe: "Validação de
resposta falhou repetidamente"` — o `compose` produziu draft estruturalmente valido, porem a **validacao de
grounding** (`PolicyEngine.validateResponse`, decision-engine:131/141) **negou repetidamente** -> terminal-safe.
Provavel: fatos de estoque nao chegaram (F2.7.2 talvez nao deployado no teste, ou feed vazio) OU o modelo citou
algo fora dos fatos. O motivo (gv.violations) era engolido na mensagem generica.

Fix F2.7.3 (so observabilidade, nao muda logica): captura `lastDenyDetail` (JSON dos verdicts deny, bounded 220)
no loop de compose e inclui no reason do `emitTerminalSafe` -> aparece em `v3_decisions.reason_summary`. Assim 1
teste revela QUAL policy/violation negou (stock-vazio? render-ref? overreach?). Gates: test:all EXIT=0, tsc limpo,
offline 418. Handoff: nota aqui (tweak pequeno, padrao F2.6M/O).

⚠️Padrao observado: o cerebro e FAIL-CLOSED (recusa em vez de alucinar) — cada gate (decisao, grounding) e afinado
1x1. Ja passamos decisao(F2.6R)+anti-filler(F2.7.1)+estoque-http(F2.7.2); agora o grounding do compose.
Proximo: confirmar deploy F2.7.2+F2.7.3 -> dono manda 1 "tem onix?" -> leio o motivo exato do deny -> corrijo a raiz
(stock facts e/ou afinar o grounding) -> dai etapa 3 (debounce). Possivel: debounce sobe de prioridade (rajada
fragmenta).

Resultado: **F2.7.3 no ar pelo auto-deploy; aguardando 1 teste p/ ler o motivo do deny.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.4-A (memoria accepted-safe: motor + contrato SQL) - 2026-06-29

⚠️ **ENTREGA FECHADA, SEM ATIVAR NADA**: sem deploy, sem push, sem rodar SQL no banco, `PEDRO_V3_PILOT_MODE` INALTERADO.
Aguarda auditoria do Codex -> dono roda a migration -> so entao push/deploy.

Auditoria (read-only) confirmou **E (combinacao)**: A sem debounce; B fala nao persistida (`recentTurns` VAZIO com
version=16, `on_success=[]`); C delivered nunca aplica (outboxes presos em `accepted`); D grounding. Esta rodada ataca
B+C com o contrato **accepted-safe**.

Contrato (aprovado): `append_assistant_turn` em **accepted** = memoria do que o agente ENVIOU (≠ lead recebeu);
`delivered/read` = confirmacao externa; acoes comerciais (oferta/foco/fotos/objetivo/CRM/handoff/schedule/
mark_message_delivered) seguem exigindo **delivered**. FONTE UNICA: `v3_required_receipt_level(kind,on_success)`.

Motor (rodada A, ja aprovada pelo Codex): effect-policy (ACCEPTED_SAFE_OUTCOME_OPS), effect-materializer (injeta
append_assistant_turn deterministico, fonte unica sem duplicar), conversation-engine (injeta append_lead_turn
deterministico, sem duplicar), effect-outcome-commit + in-memory-store (aplica no nivel exigido; grava receipt antes
de pular outcome ja aplicado -> delivered posterior sobe accepted->delivered sem reaplicar). Testes: run-active-effects
55 OK, run-active-root 17 OK.

Contrato SQL (esta rodada): `v3_schema.sql` + `sql/v3_f2_7_4_accepted_safe_memory_patch.sql` (migration manual
idempotente p/ o dono) — helper + coluna gerada via helper + check (`outcome_applied_at` em accepted so accepted-safe)
+ `v3_commit_effect_outcome` (valida nivel real; delivered posterior idempotente). `v3_record_outbox_result` CONFIRMADO
compativel (transicao accepted->delivered ja valida; ja ramifica em required_receipt_level). Verificador read-only
(JSON ok=true) comentado no fim do patch. Testes pglite REAIS (run-sql-schema) cobrem os 9 casos do Codex.

Gates: test:all EXIT=0; tsc limpo; SQL 64 OK; offline v2 418 OK; scan dos arquivos da rodada LIMPO (sem provider/
dispatch/uazapi/fetch/segredo). Handoff `handoffs/2026-06-29-claude-f2.7.4-a-accepted-safe-memory.md`.

Risco restante: C (callback delivered nao chega no webhook) segue PENDENTE — a memoria nao depende mais disso, mas o
rastreio de ENTREGA + outcomes que exigem delivered seguem parados ate resolver o C (proxima fase). Debounce/grounding/
bloco (resto da F2.7.4) PENDENTES.

Resultado: **F2.7.4-A pronto e gateado, NAO deployado — entregue p/ auditoria do Codex + migration p/ o dono rodar.** `PEDRO_V3_PILOT_MODE` INALTERADO.