# 08 — F2.5.2 READ-SIDE real (shadow) — ESPECIFICAÇÃO ÚNICA AUTORITATIVA

> Status: **Read-side B/C/D + F2.5.3 + F2.5.4A + F2.5.4A.1 implementadas. 397/397 + tsc limpo.** Wiring Supabase read-only com **matriz estrita de leitura** (segredo só em `platform_integrations`/selectOne; §3.6) + corpo limitado/projeção local (§3.5) + canary com config-load real do agente (§3.8) entregues na F2.5.4A.1 (ver `handoffs/2026-06-28-claude-f2.5.4a1-correcoes-auditoria.md`, `…-f2.5.4a-…`, `ADR-008`). Prompt→LLM e canary remoto BLOQUEADOS (rotação da `service_role` pendente).
> Autor: Claude (executor). Base: F2.5.1 (214/214 local + 48/48 Supabase). Consolidado em 2026-06-28.
> Princípio: QueryTools **read-only**, normalizadas para os contratos do v3, **isoladas por tenant**, sem
> acoplar o Kernel a Supabase/v2. Nenhum EffectDispatcher externo. Tudo verificado por código/runtime vivo.
>
> **Este documento é a ÚNICA especificação. Não há rascunho concorrente** — versões antigas
> (`marca|modelo|ano` como key, índice como desempate, KnowledgeSource, seleção de CPF, `last_sync_at`
> como base de cache, cópia de listas do v2) foram **removidas**, não apenas marcadas.

---

## 1. Fontes VIVAS (verificadas por import + query + runtime)

Auditoria no v2 (`humanizeia`, read-only) e no Supabase `seyljsqmhlopkcauhlor` (MCP só-leitura).
Onde doc/memória divergiu do código vivo, **o código venceu**.

| Capacidade | Fonte viva (v2) | Como é lida hoje |
|---|---|---|
| Config + **prompt** | `wa_ai_agents` | `pedro-webhook-v2/index.ts:329` → `selectActiveAgent(agents, instanceId)`; prompt = `system_prompt` cru, OU `agent_funnel_config.generated_system_prompt` quando `use_funnel_config=true` |
| Funil estruturado | `agent_funnel_config` | `bloco1..9` + `generated_system_prompt`; `generate-agent-funnel-prompt` grava e liga `use_funnel_config` |
| **Estoque** | **API externa por tenant** via `platform_integrations` | `stockSearch_20260525_photo_flow.ts::searchPedroStock` → **RevendaMais** (feed JSON, `fetchRevendaMaisVehicles`) **precede** **BNDV** (GraphQL, token) |
| Detalhes do veículo | item de estoque normalizado | `NormalizedVehicle { markName, modelName, versionName, year, km, saleValue, color, fuelName, transmissionName, pictureJs, category }` |
| **Fotos** | campo `pictureJs` do item | JSON `[{Link, Principal}]` (`parseBndvPictures`); fotos NÃO ficam em tabela; `Link` pode ser URL assinada/temporária |
| CRM / lead | `ai_crm_leads` | chave `id` (UUID) + `user_id`/`agent_id`; campos lead/qualificação + `cpf`/`birth_date` sensíveis |
| Identidade/roteamento | `wa_instances` + `selectActiveAgent` + `contactIdentity.ts` | resolve agente por instância; lead por remote_jid/pushName |

**Fatos do estoque (código vivo):** RevendaMais raw = `Record<string,any>` e a normalização **DESCARTA qualquer id externo**; `category` do feed = **AUTOMOVEL/MOTO** (classe, **não** carroceria); BNDV GraphQL **não pede id nem carroceria**; carroceria hoje = `getVehicleSubcategory` = **regex de listas manuais** (a NÃO copiar); `year`/`saleValue` podem ser **null**.

### Vínculo do agente de teste — `douglasaloan@gmail.com` (por SQL)
- tenant `user_id = ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0`; agente **"Aloan"** `agent_id = d4fd5c38-dd37-4da5-a971-5a7b7dfb9185` (`is_active=true`).
- `instance_id = NULL` (sem WhatsApp ligado — bloqueio só da fase ATIVA). `use_funnel_config=false` → prompt = `system_prompt` cru. `company_name=""`.
- estoque: `bndv` e `revendamais` ambos ativos → **RevendaMais é a fonte efetiva** (precedência viva).

## 2. Tabelas/campos read-only realmente usados

- `wa_ai_agents`: `id, user_id, instance_id, name, system_prompt, use_funnel_config, company_name, model, temperature, blocked_categories, sells_motorcycles, sdr_goal, qualification_questions, rag_restricted, is_active, updated_at`.
- `agent_funnel_config`: `agent_id, user_id, generated_system_prompt, updated_at`.
- `platform_integrations`: `id, user_id, platform, api_key_encrypted, is_active, updated_at` (creds atrás do `CredentialProvider`; **metadata sem credencial** sai pro resto).
- `ai_crm_leads`: `id (UUID), user_id, agent_id, lead_name, client_name, vehicle_interest, …` — **`cpf`/`birth_date` NÃO são selecionados na F2.5.2** (ver §3.7).
- Estoque/fotos: **externo** (RevendaMais feed / BNDV GraphQL), não é tabela.
- **Nenhuma RPC nova**; SELECT scoped por tenant + fetch read-only às APIs de estoque.

---

# 3. ESPECIFICAÇÃO (autoritativa)

## 3.1 Identidade estável do veículo
`vehicleKey = source + ":" + (externalVehicleId | fingerprint)`. **`marca|modelo|ano` é insuficiente; índice de array é proibido.**
- Preferência: **`source + externalVehicleId`**. Hoje o id externo é descartado → **1ª tarefa gated da B:** confirmar o campo de id real por inspeção read-only controlada (amostra do feed RevendaMais; introspecção do schema BNDV) e passar a preservá-lo.
- Sem id imutável → **fingerprint determinístico** só de atributos **não-voláteis**: `marca, modelo, versão, ano, cor, combustível, câmbio`. **Nunca** índice, preço ou km.
- **Colisão de fingerprint → `ambiguous=true`**; veículo ambíguo **não dispara fotos automaticamente**.

## 3.2 Contrato de fotos
- `photoId` = **hash determinístico do componente ESTÁVEL da URL** (path canônico, **sem** query/assinatura), escopado ao `vehicleKey`. **Nunca** a URL temporária como identidade.
- `photoId → URL`: o resolvedor **re-resolve a lista atual** do veículo e casa pelo hash; sobrevive a **restart / cache expirado / URL re-assinada**.
- Dispatcher futuro resolve `vehicleKey + photoId` deterministicamente; foto **nunca** cruza veículos.

## 3.3 Preço e ano ausentes (fail-closed)
`NormalizedVehicle` aceita `year/saleValue=null`; `VehicleFact` exige `number`.
- **Sem preço** → não entra em oferta firme; se citado, "**preço a confirmar**" (nunca inventar/R$0). **Sem ano** → não entra como fato de oferta firme.
- Mudar `VehicleFact` (ex.: nullable + `priceStatus`/`yearStatus`) = **mini-ADR + parada ANTES**. Proposta: manter `VehicleFact` estrito e filtrar fora os sem preço/ano da oferta firme.

## 3.4 Categoria/carroceria (confiança + proveniência)
Fontes **não têm carroceria** (RevendaMais `category`=AUTOMOVEL/MOTO; BNDV sem campo).
```ts
type TypedVehicleType = { value: VehicleType; confidence: number; provenance: "source_field" | "derived" | "unknown" };
```
- Confirmar por inspeção se há campo real (`provenance:"source_field"`); senão **classificador principiado** (não a regex do v2) com `confidence`; sem confiança → `unknown`.
- **"quero SUV":** só `value=suv` com confiança alta entra; **`unknown` NUNCA é oferecido como SUV**; aproximação só se a decisão final declarar alternativa e a policy permitir. **`broad` nunca relaxa** categoria/teto rígidos.

## 3.5 Segurança do fetch (adapter HTTP — fatia B)
HTTPS obrigatório · **allowlist de hosts por provider** · bloqueio de localhost/IP privado/link-local/**metadata** (169.254.169.254) · redirects limitados e **re-validados a cada hop** · **limite de bytes** · validação de `content-type` · **timeout via AbortSignal** · retry **só GET idempotente** · erros/logs **sem URL/token/credencial**. **A LLM nunca escolhe URL/host/credencial.**

## 3.6 Credenciais — `CredentialProvider`/`SecretRef`
`api_key_encrypted` **nunca** entra em `TenantRuntimeConfig`, estado, `QueryResult`, evento ou log. O resto do sistema só vê um `SecretRef` **opaco** (`{tenantId, integrationId, provider, purpose}`); o segredo é resolvido **no ponto de uso** (fatia B), sem registrar. `resolve` é **fail-closed** (`SECRET_NOT_FOUND`/`OWNERSHIP_MISMATCH`/`PROVIDER_MISMATCH`); nunca devolve material "default". `makeSecretRef` valida contra **allowlists reais** de `provider`/`purpose` e ids não-vazios, **sem ecoar o valor inválido**.

## 3.7 CRM (read-only)
- **NÃO selecionar `cpf` nem `birth_date`** (read-only não escreve cofre).
- `leadId` canônico = **UUID `ai_crm_leads.id`** (não `remote_jid`).
- Toda leitura exige **`tenantId + agentId + leadId`** e **valida propriedade** (lead pertence ao tenant+agente).

## 3.8 Tenant/agente — explícitos + 2 camadas de propriedade
Carregar com **`tenantId + agentId` EXPLÍCITOS**; **proibido "primeiro agente ativo"**; email só descoberta administrativa, nunca entra no Kernel. **Não confiar só no gateway:** revalidar `id`/`tenantId` nos dados retornados (agente, funil, cada integração); divergência → `SOURCE_OWNERSHIP_MISMATCH` (nunca aproveitar os dados). Exceção do gateway → `READ_SOURCE_FAILURE` fail-closed, **sem propagar `error.message`**.

## 3.9 KnowledgeSource — FORA de escopo
Não existe `knowledge_search` em `QueryInputMap`. **Sem source de KB na F2.5.2.** Se desejado depois → proposta separada com alteração tipada de contrato + policy + testes.

## 3.10 Prompt
Piloto = `system_prompt` cru (`use_funnel_config=false`). Nesta fase é **carregado e validado**, **sem alegar integração** com decisão/compose até o LLM real ligar. Hierarquia: **invariantes/policies do Kernel > políticas do tenant > prompt do portal > heurísticas do LLM**. **Policies do Kernel sempre vencem** o prompt; conteúdo do prompt **nunca** aparece em erro/log.

## 3.11 Cache
`Clock` injetável · **limite de memória + LRU** · **single-flight por (tenant, provider)** · **TTL é a base** (NÃO depender de `last_sync_at`, cuja confiabilidade não foi confirmada — só dica opcional). Config invalida por `versionStamp`. **CRM sem cache.** Testes HTTP reais **fora** do `test:all`. Cache sempre tenant-scoped e desligável por flag.

## 3.12 Mapeamento fonte real → `QueryInputMap`/`QueryOutputMap`
| QueryTool | Input | Fonte → normalização → Output |
|---|---|---|
| `stock_search` | `{ tipo?, precoMax?, modelo?, broad?, excludeKeys? }` | RevendaMais/BNDV → `NormalizedVehicle[]` → filtros cumulativos (tipo §3.4, teto, modelo, `excludeKeys`) → `{ items: VehicleFact[], filtersUsed }` |
| `vehicle_details` | `{ vehicleKey }` | resolve 1 item por `vehicleKey` (§3.1) → `{ vehicle: VehicleFact }` |
| `vehicle_photos_resolve` | `{ vehicleRef }` | §3.2 → `{ vehicleKey, ambiguous, photoIds }` |
| `crm_read` | `{ leadId }` (+ tenant/agent) | `ai_crm_leads` por tenant+agent+id → `{ leadId, name? }` (sem cpf/birth_date) |

`VehicleFact = { vehicleKey, marca, modelo, ano, preco, km?, tipo, photoIds? }`.

## 3.13 `TenantCatalog` dinâmico
Produzido dos **itens de estoque vivos**: por `NormalizedVehicle`, `CatalogEntry { vehicleKey, brand, model, aliases }` (aliases da normalização canônica do `catalog-utils.ts`). **Sem lista hardcoded** de marcas/modelos. Alimenta o `ClaimExtractor`/grounding.

## 3.14 Paginação, `excludeKeys`, "mais opções"
Pool externo completo; seleção/paginação em memória. Filtros cumulativos (tipo, teto, modelo, `excludeKeys`). "mais opções" = nova `stock_search` herdando categoria/faixa + `excludeKeys` = união dos `vehicleKey` já apresentados (`offers.presentedKeys`). Sem repetição.

## 3.15 Timeouts, erros tipados, fallback seguro
Cada QueryTool com timeout (loop do Kernel + timeout próprio do fetch). Erros tipados; estoque indisponível → `items:[]`/`{ok:false}`, **nunca throw pro lead** (Kernel cai em clarify/terminal-safe). **Sem fallback silencioso p/ BNDV** se RevendaMais falhar. QueryTools **estritamente read-only** (sem WhatsApp/CRM-write/handoff/agenda; provado por teste + ausência de import).

---

## 4. Ports & adapters (Agent/src)
- `domain/read-ports.ts` — `TenantConfigSource` (+ na B: `StockSource`, `VehicleDetailSource`, `VehiclePhotoSource`, `CrmReadSource`). **Sem KnowledgeSource.**
- `domain/credential-provider.ts` — `CredentialProvider`/`SecretRef` (§3.6).
- `adapters/read/v2-read-gateway.ts` — gateway read-only do v2 com **métodos específicos** (sem tabela/filtro livre), validando propriedade; separado do `SupabaseV3Gateway` (v3_*/escrita).
- `adapters/read/tenant-config-source.ts` · `stock-source.ts` (B) · `crm-read-source.ts` (C) · `read-query-runner`/`engine/query-runner.ts` (C).
- `adapters/read/fakes/*`. **Reuso da lógica do v2 (rank/excludeKeys/parse de fotos): reescrever; nunca import do v2** (ADR-005).

## 5. `TenantRuntimeConfig` (implementado — readonly, imutável)
`{ tenantId, agentId, agentName, companyName(""→null), instanceId, promptText, promptSource, model, temperature, sdrGoal, qualificationQuestions, sellsMotorcycles, blockedCategories, ragRestricted, stockProvider, stockSecretRef(opaco|null), versionStamp }`. **Sem credencial.** `versionStamp` composto (agente + funil-quando-usado + provider/integração/updatedAt). Arrays clonados + `Object.freeze` recursivo. Kernel recebe via injeção; **nada hardcoded**.

## 6. Testes adversariais obrigatórios
cross-tenant · **2 camadas (gateway mentiroso: agente/funil/integração de outro tenant)** · **erro do gateway com segredo → READ_SOURCE_FAILURE sem vazar** · imutabilidade (frozen + mutar seed não afeta) · **versionStamp muda com funil/provider/integração** · `makeSecretRef` rejeita provider/purpose/ids inválidos sem ecoar · **resolve fail-closed** · metadata inválida (id vazio/provider desconhecido/timestamp/dup) · URL SSRF · redirect IP privado · feed grande/malformado · **credencial fora de erro/log** · 2 unidades mesmo modelo/ano · **colisão fingerprint → ambiguous** · preço/ano ausentes · **SUV com `unknown` não entra** · `excludeKeys` sem repetição · **foto nunca cruza veículos** · cache isolado por tenant · **`broad` nunca relaxa rígido**.

## 7. Critérios de saída da F2.5.2 (completa)
4 QueryTools lendo fonte real read-only → contratos v3 válidos; `TenantRuntimeConfig`+`TenantCatalog` dinâmicos (zero hardcode); precedência RevendaMais; fotos ligadas ao vehicleKey; `excludeKeys` sem repetição; **sem cpf/birth_date**; isolamento por tenant provado; timeouts/fallback seguro; nenhuma QueryTool com efeito; 214 + novos verdes; `tsc` limpo; `rg` sem efeito/rede-indevida/CRM-write/import-v2; shadow estável.

## 8. Fatias (cada uma: testes + tsc + handoff + parada)
- **A** — contratos read-only + `CredentialProvider`/`SecretRef` + `TenantConfigSource` + fakes. **(FEITA + A.1)**
- **B** — estoque + identidade (§3.1) + categoria (§3.4) + catálogo + fotos (§3.2) + adapter HTTP (§3.5).
- **C** — CRM read-only (§3.7) + `QueryRunner`.
- **D** — harness **shadow** (EffectGate OFF; nenhum efeito externo).

## 9. Decisões do dono (aplicadas)
Fetch read-only **aprovado** com os controles §3.5 · instância **não conectar agora** · **RevendaMais principal, BNDV intacto** (não desativar), mas estoque do tenant de teste = RevendaMais · **sem fallback silencioso p/ BNDV** · prompt = `system_prompt` · **não importar v2** nem copiar listas por frase/modelo.

---

# REGISTRO — F2.5.2A + A.1 IMPLEMENTADAS (2026-06-28)

Escopo A/A.1: contratos read-only + carregamento seguro de config + `CredentialProvider`/`SecretRef` + fakes + **endurecimento contratual**. **Sem HTTP/CRM/QueryRunner/LLM/rede; Kernel/v2/banco intocados.**

### Arquivos
- `Agent/src/domain/read-ports.ts` — `TenantAgentRef`, `TenantRuntimeConfig` (readonly), `PromptSource`, `StockProvider`/`SelectedStockProvider`, `ReadConfigError(Code)` (inclui `SOURCE_OWNERSHIP_MISMATCH`, `READ_SOURCE_FAILURE`), `ConfigResult`, `TenantConfigSource`.
- `Agent/src/domain/credential-provider.ts` — `SecretRef` (provider = união fechada), `CredentialProvider` (`resolve` fail-closed/discriminado), `makeSecretRef` (allowlists reais + `SecretRefError`), `SECRET_*_ALLOWLIST`, `SECRET_KEY_DENYLIST`.
- `Agent/src/adapters/read/v2-read-gateway.ts` — `V2ReadGateway` (métodos específicos; rows com `tenantId`; `model/temperature` `unknown`), `assertTenantAgentRef`. Sem impl. real (Supabase → B/C).
- `Agent/src/adapters/read/tenant-config-source.ts` — `V2TenantConfigSource` (2 camadas de propriedade; `tryGateway`→`READ_SOURCE_FAILURE` sem vazar; metadata validada; `versionStamp` composto; `Object.freeze` recursivo + arrays clonados; **não chama `resolve`**).
- `Agent/src/adapters/read/fakes/{fake-v2-read-gateway,fake-credential-provider}.ts` — fakes determinísticos; gateway guarda segredo mas nunca expõe; credential fail-closed.
- `Agent/tests/run-read-side.ts` — **54 checks**. `Agent/package.json` — `test:read` + `test:all`.

### A.1 — endurecimentos provados
2 camadas de propriedade (gateway mentiroso → `SOURCE_OWNERSHIP_MISMATCH`); erro do gateway → `READ_SOURCE_FAILURE` **sem vazar canário token/prompt**; imutabilidade real (config+arrays+SecretRef frozen; mutar seed não afeta); `versionStamp` muda com funil/provider/integração; `SecretRef.provider` união fechada + `makeSecretRef` rejeita inválidos sem ecoar; `resolve` fail-closed (NOT_FOUND/OWNERSHIP/PROVIDER); metadata estrutural rejeitada (id vazio/provider desconhecido/timestamp inválido/duplicado).

### Gates
- `npm run test:all` → **268 OK | 0 FALHA** (214 existentes + **54** read-side). `tsc --noEmit` → limpo.
- `rg` nas fontes da fatia: **sem** fetch/http, Uazapi, EffectDispatcher, escrita CRM, import do v2, `@supabase`/postgres (strings `https://…`/`token` **só no teste**, como canários).

**Parado para auditoria do Codex (F2.5.2A.1). NÃO iniciar B/C/D.**
---

# REGISTRO - AUDITORIA CODEX F2.5.2A/A.1 (2026-06-28)

Codex reexecutou a regressao completa (**268/268**), TypeScript e gate estatico. Contratos, source, fakes e testes foram revisados. A/A.1 aprovadas sem mudanca adicional de codigo.

Para a B, permanecem obrigatorios: inspecao read-only gated antes de fixar identidade/carroceria; decoder runtime validando timestamps e rows externas; credencial resolvida apenas no ponto de uso; HTTP anti-SSRF; nenhuma queda silenciosa RevendaMais -> BNDV; e parada para auditoria antes de C.

---

# REGISTRO - AUDITORIA CODEX F2.5.2B (2026-06-28)

Resultado: **NAO APROVADA. F2.5.2C BLOQUEADA.** A regressao passou com 289/289 e TypeScript limpo, mas os invariantes da B nao foram satisfeitos.

Bloqueios: listas manuais de modelos; vehicleKey com tenantId em vez de source; inspecao real dos campos sem evidencia; HTTP sem policy por provider e com risco de header em redirect; TenantCatalog ausente; carga duplicada/divergente entre estoque e fotos; cobertura adversarial incompleta e DNS real no test:all.

Proximo passo: **F2.5.2B.1**. Nao iniciar C/D, LLM ou efeitos externos.
---

# REGISTRO - AUDITORIA CODEX F2.5.2B.1 (2026-06-28)

Resultado: **REPROVADA. F2.5.2C BLOQUEADA.** Regressao real: 294/294 e TypeScript limpo.

Incidente critico: chave Supabase service_role hardcoded em `Agent/scratch/inspect_real_sources.mjs`. A chave deve ser rotacionada/revogada pelo dono antes de qualquer nova integracao. O script nao foi executado pelo Codex.

Bloqueios confirmados: `buildTenantCatalog` produz chaves provider:id que `isVehicleKeyInCatalog` rejeita; invalidacao concorrente do cache ainda entrega Promise stale; decoder transforma objetos externos em `[object Object]`; StockLoader nao valida propriedade do agente e duplica regras de selecao; a evidencia sanitizada prometida nao foi entregue; faltam testes de timeout/retry/TTL/LRU/single-flight/cross-tenant; nao existe adapter real de V2ReadGateway/CredentialProvider.

Proximo passo: **F2.5.2B.2**, depois de rotacionar a credencial. Nao iniciar C/D ou efeitos externos.
---

# REGISTRO - CODEX F2.5.2B.2 (2026-06-28)

Resultado: **APROVADA TECNICAMENTE EM AMBIENTE LOCAL. F2.5.2C continua bloqueada ate rotacao/revogacao da chave `service_role` exposta pelo scratch antigo.**

Correcoes executadas:
- `Agent/.gitignore`: `scratch/` bloqueado para evitar scripts locais com probes/segredos.
- `Agent/scratch/inspect_real_sources.mjs`: conteudo redigido; nenhum JWT ou `service_role` permanece no arquivo.
- `Agent/src/engine/catalog-utils.ts`: `isVehicleKeyInCatalog` passa a aceitar match exato de `entry.vehicleKey` (`revendamais:101`, `bndv:<id>`) antes da compatibilidade legada `brand|model|year`.
- `Agent/src/adapters/read/cache.ts`: pending flight agora carrega `version` + `flightId`; `invalidate` remove pendentes e incrementa versao; conclusao atrasada so grava/deleta se ainda for o voo atual.
- `Agent/src/adapters/read/stock-normalizer.ts`: decoder fail-closed para campos escalares; id externo so string/number; marca/modelo obrigatorios so string; numero brasileiro tratado; foto invalida nao gera `photoId`.
- `Agent/src/adapters/read/stock-loader.ts`: valida `getOwnedAgent(ref)` e metadata antes de `CredentialProvider.resolve`; provider duplicado/mismatch falha fechado; credencial so e resolvida depois de propriedade confirmada.
- `Agent/tests/run-read-side.ts`: 21 checks novos cobrindo segredo local, catalogo real, decoder malformado, foto invalida, cache concorrente, TTL, LRU, timeout, retry GET, POST sem retry, loader sem agente e provider duplicado.

Gates executados:
- `npm run test:read` -> **101 OK | 0 FALHA**.
- `npm run test:all` -> **315 OK | 0 FALHA**.
- `npx tsc --noEmit` -> limpo.
- `rg` de auditoria: nenhum JWT/service_role vivo no `Agent/src`, `Agent/tests` ou `Agent/scratch`; ocorrencias restantes sao canarios de teste, SQL/testes de schema e comentarios/denylist esperados.

Pendencia obrigatoria antes da F2.5.2C:
- O dono precisa rotacionar/revogar no Supabase a `service_role` que apareceu no scratch antigo. Redigir o arquivo local reduz o dano no workspace, mas nao invalida a credencial exposta.

Proximo passo apos a rotacao: F2.5.2C (CRM read-only + QueryRunner), mantendo ports/adapters, sem efeitos externos e com parada para auditoria antes de shadow.
---

# REGISTRO - CODEX F2.5.2C (2026-06-28)

Resultado: **APROVADA LOCALMENTE.** CRM read-only + QueryRunner implementados sem efeitos externos.

Arquivos criados/alterados:
- `Agent/src/adapters/read/crm-read-source.ts` - `V2CrmReadSource` com validacao de UUID, propriedade tenant+agent+leadId e output seguro.
- `Agent/src/engine/read-query-runner.ts` - `createReadQueryRunner(ref, sources)` para `stock_search`, `vehicle_details`, `vehicle_photos_resolve`, `crm_read`.
- `Agent/src/domain/read-ports.ts` - `CrmLeadSummary` e `CrmReadSource`.
- `Agent/src/adapters/read/v2-read-gateway.ts` - `OwnedCrmLeadRow` seguro e `getOwnedCrmLead` especifico.
- `Agent/src/adapters/read/fakes/fake-v2-read-gateway.ts` - seed/fake de CRM read-only.
- `Agent/tests/run-read-side.ts` - 15 checks novos da F2.5.2C.

Garantias:
- `crm_read` exige `leadId` e a PolicyEngine ja nega chamada vazia.
- `V2CrmReadSource` exige UUID e valida propriedade da row retornada; gateway mentiroso vira erro.
- Cross-tenant/cross-agent retorna `null`/`NOT_FOUND`, sem vazar existencia do lead.
- O QueryRunner nunca propaga exception crua para o motor; retorna `VALIDATION`, `NOT_FOUND` ou `UPSTREAM` sanitizado.
- Output de `crm_read` no contrato de decisao segue minimo: `{ leadId, name? }`; sem `cpf`, sem `birth_date`.
- QueryRunner nao importa nem executa EffectDispatcher, WhatsApp, CRM-write, schedule, handoff ou Supabase real.

Gates:
- `npm run test:read` -> **116 OK | 0 FALHA**.
- `npm run test:all` -> **330 OK | 0 FALHA**.
- `npx tsc --noEmit` -> limpo.
- `rg` de auditoria: achados restantes sao canarios de teste e comentarios/denylist esperados; nenhum efeito externo no QueryRunner.

Pendencia mantida por decisao do dono:
- Rotacionar/revogar a `service_role` exposta no scratch antigo antes de canary/producao.

Proximo passo: **F2.5.2D shadow harness** com EffectGate OFF e comparacao/telemetria, ainda sem efeito externo.
---

# REGISTRO - CODEX F2.5.2D (2026-06-28)

Resultado: **APROVADA LOCALMENTE.** Shadow harness end-to-end implementado com EffectGate OFF e sem efeitos externos.

Arquivos criados/alterados:
- `Agent/src/engine/shadow-harness.ts` - `runShadowHarnessTurn`, comparacao shadow e garantia de dispatchAttempts=0.
- `Agent/tests/run-phase2.ts` - teste 32 cobrindo inbound -> decision -> QueryRunner -> outbox -> shadow skip.
- `Brain/01-STATUS-ATUAL.md`, `Brain/08-PLANO-F2.5.2-READ-SIDE.md`, handoff da fase.

Garantias:
- O harness insere inbound redigido (`redact({ text })`) e usa o mesmo `runConversationTurn` do engine.
- Outbox e materializacao sao reais do v3; provider real nao e chamado.
- `OutboxDispatcher` roda com `InMemoryEffectGate` em modo inactive/shadow.
- Todo efeito do turno fica `skipped` e `outcomeAppliedAt=null`.
- A comparacao falha se action/reasonCode esperados divergirem, se tool obrigatoria nao aparecer, se tool proibida aparecer ou se houver dispatch real.
- Sem rede, sem banco real, sem WhatsApp, sem CRM-write, sem handoff e sem agenda.

Gates:
- `npm run test:phase2` -> **96 OK | 0 FALHA**.
- `npm run test:all` -> **334 OK | 0 FALHA**.
- `npx tsc --noEmit` -> limpo.
- `rg` de auditoria no harness: sem `fetch`, sem Supabase, sem provider real. Achados de `dispatch`/`send_message` em testes sao esperados e controlados.

Pendencia mantida por decisao do dono:
- Rotacionar/revogar a `service_role` exposta no scratch antigo antes de qualquer canary/producao real.

Proximo passo sugerido: F2.5.3 - adapter real read-only/gated para `V2ReadGateway`/`CredentialProvider` e/ou canary shadow controlado, com rotacao de chave antes de tocar infra real.

---

# REGISTRO - CODEX F2.5.3 (2026-06-28)

Resultado: **APROVADA LOCALMENTE.** Adapters V2 read-only por contrato de banco injetavel implementados, sem SDK Supabase, sem rede e sem escrita.

Arquivos criados/alterados:
- `Agent/src/adapters/read/supabase-v2-read-adapter.ts` - `V2DatabaseReadGateway`, `V2DatabaseCredentialProvider`, `V2ReadDatabase` e `SecretDecryptor` injetaveis.
- `Agent/tests/run-read-side.ts` - 11 checks novos da F2.5.3.
- `Brain/01-STATUS-ATUAL.md`, `Brain/08-PLANO-F2.5.2-READ-SIDE.md`, handoff da fase.

Garantias:
- Gateway possui metodos especificos; nao aceita tabela/filtro livre no dominio do agente.
- `getOwnedAgent`, `getOwnedFunnelConfig` e `getOwnedCrmLead` filtram por tenant/agente quando aplicavel.
- Metadata de `platform_integrations` nao seleciona `api_key_encrypted`.
- CRM read-only nao seleciona `cpf` nem `birth_date`, mesmo quando a row fake contem esses campos.
- CredentialProvider seleciona `api_key_encrypted` somente no ponto de uso e passa contexto minimo ao decryptor.
- Provider mismatch e cross-tenant falham fechado antes de decrypt indevido.
- Falha de banco vira `READ_SOURCE_FAILURE` sanitizado via `TenantConfigSource`.
- Sem `@supabase`, sem `createClient`, sem fetch real, sem EffectDispatcher e sem escrita externa.

Gates:
- `npm run test:read` -> **127 OK | 0 FALHA**.
- `npm run test:all` -> **345 OK | 0 FALHA**.
- `npx tsc --noEmit` -> limpo.
- Auditoria `rg`: ocorrencias de `api_key_encrypted` apenas no CredentialProvider e canarios de teste; `cpf`/`birth_date` apenas em canarios/testes; nenhum SDK Supabase real no adapter.

Pendencia mantida por decisao do dono:
- Rotacionar/revogar a `service_role` exposta no scratch antigo antes de qualquer canary/producao real.

Proximo passo sugerido: **F2.5.4** - wrapper real do client Supabase read-only + decryptor seguro e/ou canary shadow controlado com EffectGate OFF, apos rotacao/credencial segura.
---

# REGISTRO - CODEX F2.5.4A.2 (2026-06-28)

Resultado: **APROVADA LOCALMENTE.** Deadline PostgREST cobre a resposta inteira e cancela stream travado. Teste adversarial inclui `cancel()` que nunca resolve.

Gates: **399 OK | 0 FALHA**, TypeScript limpo, zero rede/efeito real. Canary remoto continua bloqueado pela rotacao pendente da service_role.

Proximo: F2.5.4B offline - binding tipado do prompt do tenant ao LLM e composicao completa de interpreter/claims/catalogo, sempre em shadow.
---

# REGISTRO - CODEX F2.5.4B (2026-06-28)

Resultado: **APROVADA LOCALMENTE.** Prompt do portal ligado ao adapter LLM tipado; contexto preparado apos load da memoria; tool loop e memoria multiturno provados; modelo continua sem autoridade sobre politicas/efeitos.

Gates: **414 OK | 0 FALHA**, TypeScript limpo, zero rede/provider/efeito real.

Proximo: F2.5.5 adapter real de modelo e extracao semantica independente; depois rotacao da service_role e canary remoto somente shadow.