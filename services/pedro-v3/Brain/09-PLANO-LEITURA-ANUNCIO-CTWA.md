# 09 — Leitura de Anúncio (CTWA): Diagnóstico Avant (Pedro v2) → Plano de Integração no Pedro v3

> **Status:** Diagnóstico read-only concluído + plano proposto. **Nada foi alterado.** Aguarda auditoria do Codex e decisão do dono antes de qualquer código.
> **Autor:** Claude (executor) · **Data:** 2026-07-01 · **Fonte de verdade:** este documento + `Brain/`.
> **Objetivo do dono:** entender por que a leitura de anúncio falha na Avant (Pedro v2) e **desenhar a leitura de anúncio do Pedro v3** — "a leitura de anúncios é crucial no nosso código".

---

## 0. TL;DR (resumo executivo)

- Analisei **read-only** a conta **Avant Motors** (tenant `7e23b020-0377-4120-a6a4-502701d62208`, agente **"Manu"**, `gpt-4.1-mini`, estoque **RevendaMais**). Janela: **25–28/jun/2026** — 223 turnos, 46 leads, **50 turnos com contexto de anúncio** em **40 leads de anúncio**.
- **Não existe erro "hard".** A coluna `error` dos turn logs é 100% nula e não houve terminal-safe. O que o dono chama de *"erro ao ler o anúncio"* é **degradação de precisão**: o agente cai em abordagem genérica ou pesquisa o estoque com uma *query* poluída.
- **Métrica-chave — primeira leitura por lead de anúncio (40 leads):**
  - **5 (12,5%)** leitura limpa (marca+modelo, às vezes ano).
  - **17 (42,5%)** leram o **modelo certo mas o ANO virou o literal `AAAA`**.
  - **18 (45%)** **não identificaram** veículo nenhum.
- **4 modos de falha, todos com causa-raiz confirmada no código e nos dados** (detalhe na §4). Os dois grandes:
  1. **Bug do placeholder `AAAA`** — o *prompt* de visão usa `AAAA` como exemplo de ano; quando a visão não lê o ano na arte, **ecoa `AAAA` literal** para dentro do `vehicle_query`. `stripYear` só remove anos reais (`19|20\d{2}`), então `AAAA` **vaza para a busca de estoque**. Causa-raiz exata: `adContext_20260525.ts:787`.
  2. **Anúncios institucionais + visão sem retorno** — os anúncios da Avant são **institucionais** (título/corpo/saudação genéricos: *"Encontre o carro ideal…"*, *"Oi! Como podemos ajudar?"*). O carro **não está no texto**; só na imagem. E a visão devolve **confiança 0** em metade dos casos (imagem baixada mas ilegível/showroom, imagem cortada `s540`, *timeout* 4,5s, ou anúncio sem 1 carro único).
- **Plano para o v3:** um **handler determinístico "Ad Intake"** no *chain* de handlers, **em camadas** (Ad-ID → Texto → Visão corrigida → *Grounding* no catálogo), com **recuperação de rajada** e **memória do anúncio no `conversation_state`**. Encaixa na arquitetura hexagonal e na **política de grounding** do v3 (o anúncio vira parte estruturada aterrada, nunca texto-livre não aterrado).
- **Quick wins** portáveis já (baratos) vs **build estratégico** — §6.5.

---

## 1. Escopo, IDs e método

| Item | Valor |
|---|---|
| Conta (tenant `user_id`) | `7e23b020-0377-4120-a6a4-502701d62208` |
| Agente | `03421f26-f4e3-48f1-a791-24fc438e9b3d` — **"Manu"** (agent_type `sdr`, `openai/gpt-4.1-mini`, `is_active=false` no momento) |
| Estoque | **RevendaMais** (`platform_integrations` id `08965d73-…`, `is_active=true`, último sync 2026-06-25) |
| Projeto Supabase | `seyljsqmhlopkcauhlor` |
| Observação | O tenant do **piloto v3** (`ecb26258-…`) usa um **clone do feed RevendaMais da Avant** para testes — mesmo estoque. |

**Fontes de dados (todas read-only):**
- `pedro_v2_turn_logs` — cada turno gravado com `payload` (inclui a chave **`ad_context`** já resolvida + `diagnostics`) e `result` (decisão/`reason`/`reply_source`).
- `ctwa_diag_capture` — **payload cru do Meta** (podado) de toda mensagem que chega com marcadores de anúncio.
- Código Pedro v2 (arquivos/linhas citados abaixo).

**Nada foi alterado.** Todo SQL foi `SELECT`. Nenhum arquivo de produção tocado.

---

## 2. Como o Pedro v2 lê anúncio hoje (pipeline real)

### 2.1 Fluxo

```
uazapi/WhatsApp
  └─▶ supabase/functions/pedro-webhook-v2/index.ts        (Deno.serve)
         ├─ logCtwaDiag(payload)  → ctwaDiag.ts → INSERT ctwa_diag_capture   (só diagnóstico; nunca bloqueia)
         └─▶ orchestrator_20260525_photo_flow.ts
                └─▶ resolvePedroAdContext(payload, text, openaiKey)          ← CÉREBRO DA LEITURA
                      → adContext_20260525.ts  (1034 linhas)
                └─ adContextToMemory(adContext) → interesse.modelo_desejado / reference.origem_anuncio
                └─ routePedroIntent / buildStockFilters → searchPedroStock (RevendaMais/BNDV)
                └─ replyGenerator → resposta
```

### 2.2 Estrutura REAL do payload Meta (CTWA) — capturado da Avant

Payload cru (podado) de um lead real da Avant (`ctwa_diag_capture`), instância `avant`:

```jsonc
message.content = {
  "text": "Sou de Taubaté SP",                 // ← a mensagem do lead
  "title": "📍 Venha conhecer nosso estoque e saia de carro novo!",
  "contextInfo": {
    "ctwaPayload":      "[blob ~536 chars]",
    "conversionData":   "[blob ~536 chars]",
    "conversionSource": "FB_Ads",
    "externalAdReply": {
      "title":              "📍 Venha conhecer nosso estoque e saia de carro novo!",
      "body":               "🚗 Encontre o carro ideal para você na Avant Motors!\n\nVeículos selecionados, procedência garantida…",
      "greetingMessageBody":"Oi! Como podemos ajudar?",     // ← saudação = GENÉRICA (sem carro)
      "sourceID":           "120253981641730460",           // ← AD ID do Meta  ★ sinal determinístico
      "sourceType":         "ad",
      "sourceURL":          "https://fb.me/c9tWuhhGL",
      "mediaURL":           "https://www.facebook.com/story.php?story_fbid=…",
      "mediaType":          2,
      "thumbnailURL":       "https://scontent.fcgh4-2.fna.fbcdn.net/…?cstp=mx1080x1920&ctp=s540x540…",  // ← CORTADA p/ 540
      "originalImageURL":   "https://scontent.fcgh4-2.fna.fbcdn.net/…",  // ← full-res (melhor p/ visão)
      "thumbnail":          "[omitido]"
    }
  },
  "JPEGThumbnail": "[blob ~6472 chars]"   // ≈ 4,8 KB decodificado → ABAIXO do limiar de 12 KB → rejeitado
}
```

**Leitura importante desse payload:** este é um **anúncio institucional** — `title`, `body` e `greetingMessageBody` **não citam nenhum carro**. O único lugar onde poderia haver um veículo é a **imagem** (`originalImageURL`). E há dois sinais fortes e determinísticos ignorados hoje: **`sourceID`** (o *ad_id* do Meta) e **`conversionSource=FB_Ads`**.

### 2.3 Cadeia de inferência e prioridade (em `adContext_20260525.ts`)

| Camada | Função | Confiança | Observações |
|---|---|---|---|
| Saudação CTWA | `inferVehicleFromGreeting` (L641) | **0.95** (autoritativa) | Regex `saber mais sobre / interesse n[oa]/em`. Vence tudo. |
| Texto do anúncio (copy) | `inferVehicleFromAdCopy` (L703) | 0.62–0.94 | *Patterns* "encontrou … por R$", "quer saber mais sobre …?" |
| Texto (dicionário) | `inferVehicleFromText` (L600) | 0.78 / 0.15 | Lista *hardcoded* de ~30 modelos conhecidos. |
| Texto via LLM | `inferVehicleFromAdText` (L819) | variável | `gpt-4o-mini`, só se texto < 0.6. |
| **Visão (imagem)** | `inferVehicleFromImage` (L758) | **0.45+** | `gpt-4o` → *fallback* `gpt-4o-mini`. **Timeout 4.5s.** |
| Prioridade final | `resolvePedroAdContext` (L947-954) | — | **saudação(0.95) > texto-com-ano(≥0.55) > visão(≥0.45) > texto** |

**Parâmetros e salvaguardas (verificados no código):**
- `IMAGE_TIMEOUT_MS = 4500` (`:19`) — 4,5s para baixar+inferir a imagem.
- `MIN_AD_IMAGE_BYTES = 12000` (`:158`) — *thumbnail* embutido < 12 KB é **rejeitado** (filtro anti foto-de-perfil).
- `isGenericFleetQuery` (`:629`) — zera o veículo se a *query* for frase de frota genérica (sem ano/modelo/marca) → cai em abordagem.
- `stripYear` (`:1010`) — remove o ano do `modelo_desejado` antes de buscar (a equipe v2 **já aprendeu que o ano do anúncio é impreciso** — data da arte, não do carro; ver comentário `:936-941`).
- Seleção de imagem (`:930-934`): `fetchedImage.dataUrl || embeddedImage || imageUrlCandidate`.
- Saída `PedroV2AdContext { has_ad_context, source, url, title, description, raw_text, vehicle_query, vehicle_type, summary, confidence, diagnostics }`.

---

## 3. Os dados — o que aconteceu na Avant (evidência dura)

### 3.1 Breakdown por turno (50 turnos com `has_ad_context=true`)

| Resultado da leitura | Turnos | % |
|---|---:|---:|
| **Leitura limpa** (modelo, sem `AAAA`) | 8 | 16% |
| **Modelo OK mas ano = `AAAA`** (visão) | 17 | 34% |
| **Sem veículo** — imagem baixada mas **visão vazia** (`image_confidence=0`) | 17 | 34% |
| **Sem veículo** — **nenhuma imagem** (`no_image_candidate`, rajada/2ª via) | 8 | 16% |
| (dentro de "sem veículo") falso-positivo de anúncio (código FB) | 1 | 2% |

### 3.2 Breakdown por lead (primeira leitura de cada um dos 40 leads de anúncio)

| Primeira leitura | Leads | % |
|---|---:|---:|
| **Limpa** | 5 | 12,5% |
| **`AAAA`** (modelo sem ano) | 17 | 42,5% |
| **Não identificado** | 18 | 45% |

> **Ou seja: em ~87% dos leads de anúncio a leitura chegou degradada ou falha no primeiro contato.** O ano praticamente **nunca** é capturado da imagem.

### 3.3 Amostras reais (do `payload.ad_context` + `result`)

| Data/hora | src | conf | vehicle_query | reply_source | Diagnóstico |
|---|---|---|---|---|---|
| 06-26 09:48 | facebook | 0.78 | `tracker` | `brain_ad_vehicle_reply` | ✅ texto/modelo OK |
| 06-26 09:53 | facebook | 0.90 | `Chevrolet Prisma 1.4 LTZ 2016` | `category_relisted_deterministic` | ✅ leitura completa (raro) |
| 06-27 04:19 | instagram | 0.70 | `Mini Cooper S 2023` | `brain_ad_vehicle_reply` | ✅ com ano |
| 06-26 20:48 | facebook | 0.70 | `Fiat Palio 1.0 **AAAA**` | `brain_ad_vehicle_reply` | ⚠️ visão leu modelo+cor ("cor prata"), ano perdido |
| 06-27 17:24 | instagram | 0.70 | `Honda HR-V 1.8 **AAAA**` | `stock_list_deterministic` | ⚠️ idem |
| 06-28 12:34 | facebook | 0.50 | `Toyota Corolla 2.0 **AAAA** automatico` | `stock_list_deterministic` | ⚠️ idem |
| 06-26 00:25 | facebook | 0.15 | `null` | `ad_generic_abordagem` | ❌ imagem baixada (`scontent.xx.fbcdn.net`) mas `image_confidence=0`, `used_image_inference=false` |
| 06-26 09:52 | facebook | 0.15 | `null` | `vehicle_photos_reply` | ❌ `no_image_candidate` (2ª msg da rajada, texto só "facebook") |
| 06-25 13:12 | facebook | 0.15 | `null` | `ad_generic_abordagem` | ❌ falso-positivo: *"50489 é seu código de confirmação do Facebook"* |

### 3.4 `diagnostics` que provam cada modo

- **`AAAA` (visão rodou, ano perdido):** `used_image_inference=true`, `image_confidence=0.5–0.7`, `image_fetch_ok=true`, `used_explicit_ad_text=false`. `vehicle_query="Fiat Palio 1.0 AAAA"`.
- **Sem veículo com imagem baixada:** `image_fetch_ok=true`, `image_candidate_host="scontent.xx.fbcdn.net"`, **`image_confidence=0`**, **`used_image_inference=false`** → a imagem foi buscada mas a visão não devolveu nada útil.
- **Sem veículo sem imagem:** `image_fetch_ok=false`, `image_fetch_error="no_image_candidate"`, `payload_text_sample` = só `"facebook"` ou um `fb.me/…` → mensagem de rajada que perdeu o `externalAdReply`.

---

## 4. Causa-raiz — os 4 modos de falha

### Modo A — Anúncio sem veículo legível (25 turnos / 45% dos leads)

Dois sub-modos:

- **A1 — Imagem baixada, visão vazia (17 turnos).** A imagem do anúncio (`facebook.com/ads/image/?d=…` / `scontent…fbcdn.net`) **foi baixada** (`image_fetch_ok=true`) mas a visão devolveu **confiança 0** e foi descartada. Causas prováveis, combinadas:
  1. **Anúncio institucional** — o criativo é showroom/logo/colagem, **sem um carro único** → a visão corretamente não identifica 1 veículo. *(Para esses casos, não existe carro a "ler"; o certo é abordar+qualificar, não inventar.)*
  2. **Imagem cortada** — o `thumbnailURL` vem `ctp=s540x540` (baixa resolução); detalhes/selo de ano ilegíveis.
  3. **Timeout de 4,5s** (`IMAGE_TIMEOUT_MS`) apertado para `gpt-4o` em imagem recém-baixada.
  4. **Threshold** — retorno < 0.45 é descartado.
- **A2 — Sem candidato de imagem (8 turnos).** Mensagens de **rajada / 2ª via** ("facebook", "oi", "tenho interesse") que chegam **sem** o `externalAdReply` (o Meta só o anexa na 1ª mensagem). `image_fetch_error="no_image_candidate"`. **É recuperável** (o anúncio existia na 1ª mensagem).

> **Insight de produto:** boa parte dos "leads de anúncio" da Avant vem de **anúncio institucional** (um único anúncio genérico dirigindo todo o tráfego). Para esses, **tentar extrair um carro é errado** (não há) — o comportamento correto é uma **abordagem calorosa e qualificadora**. Isso reposiciona o problema: nem todo "não identificado" é falha; parte é o anúncio realmente não ter carro. O que **é** falha: (a) o sub-modo A2 (rajada), (b) quando existe um carro na arte e a visão não o lê.

### Modo B — Ano vira `AAAA` (17 turnos / 42,5% dos leads) — **BUG CONFIRMADO**

**Causa-raiz exata — `adContext_20260525.ts:787`** (prompt do usuário na chamada de visão):

> *"…IMPORTANTE: use SEMPRE o ANO impresso na arte do anuncio (selo/etiqueta) — NUNCA o ano dos exemplos abaixo. Formato (NAO copie os anos; use o ano que estiver na imagem): **'Renault Duster Authentique 1.6 AAAA automatico'; 'Fiat Argo Drive 1.0 AAAA'**…"*

O prompt usa **`AAAA` como placeholder** de ano nos exemplos. Quando a visão **não consegue ler o ano** na arte, o modelo **copia o placeholder `AAAA` literal**. Aí:
- `vehicle_query = "Fiat Palio 1.0 AAAA"`.
- `stripYear` (`:1010`) só remove `(19|20)\d{2}` — **não remove `AAAA`** → `modelo_desejado = "Fiat Palio 1.0 AAAA"` **vai poluído para a busca de estoque**.

**Impacto:** marca+modelo certos, **ano perdido**; *query* suja; **risco de casar o ano errado** quando o modelo tem vários anos no estoque. Hoje sobrevive porque o *matching* de estoque é tolerante (ainda acha 2–4 carros por modelo), mas é frágil e não-determinístico.

### Modo C — Falso-positivo de anúncio (1 turno) — ruído

Mensagem *"50489 é seu código de confirmação do Facebook"* foi marcada `has_ad_context=true` (`source=facebook`). Detecção de anúncio disparou por marcador fraco. Baixo volume, mas polui métricas e pode gerar abordagem esquisita.

### Fatores agravantes transversais

- **Thumbnail embutido rejeitado:** o `JPEGThumbnail` da Avant (~4,8 KB) é **< `MIN_AD_IMAGE_BYTES` (12 KB)** → descartado; sobra só a URL fbcdn (às vezes `s540` cortada).
- **Texto nunca ajuda na Avant:** título/corpo/saudação institucionais → 100% da carga cai na visão, que é o elo mais fraco para o **ano**.
- **Sinal mais confiável ignorado:** `externalAdReply.sourceID` (o *ad_id* do Meta) e `conversionSource=FB_Ads` não são usados para resolver o veículo.

---

## 5. Por que a abordagem v2 é frágil (síntese)

1. **Depende de OCR de imagem para o dado mais crítico (ano)** — e o ano é justamente o que a visão erra/perde (Modo B).
2. **Não usa o sinal determinístico** (`ad_id`/`sourceID`).
3. **Prompt de visão com placeholder que vaza** (`AAAA`).
4. **Recuperação de rajada é best-effort** e não estruturada (varre `wa_chat_history`).
5. **Query livre vai direto à busca** ("Fiat Palio 1.0 AAAA") — não é **aterrada no catálogo** antes.
6. **Não distingue anúncio institucional de anúncio de 1 carro** — trata "sem veículo" como falha, quando às vezes é o correto.

---

## 6. Plano de integração no Pedro v3

### 6.1 Princípios (alinhados ao v3)

- **Determinístico-primeiro; LLM só quando necessário; tudo aterrado no catálogo** (respeita `POL-GROUND-STOCK/PRICE`).
- A leitura de anúncio vira um **handler determinístico "Ad Intake"** no *chain* de handlers (padrão dos handlers `photo → ranking → economy → explicit-search → continuity → LLM`). Ele emite um `TurnOutput` **aterrado por construção** — o nome do modelo entra como **parte estruturada** (`vehicle_offer_list`), então **passa pela política de grounding** sem cair em terminal-safe.
- **Memória do anúncio** persiste no `conversation_state` (contrato de state — **exige auditoria do Codex**).
- **Nunca inventar carro.** Se não há veículo resolvível/aterrável → **abordagem honesta** (qualificar), como os *fallbacks* determinísticos que já existem no v3.

### 6.2 Arquitetura em camadas — "Ad Resolver"

```
AdReferral (do webhook)
  │
  ├─ Layer 0  Ad-ID determinístico     ─▶ resolve por sourceID (ad_id Meta)         [sem LLM]
  │                                        • mapa ad_id → vehicleKey por tenant
  │                                        • OU parse de ad_name/campaign_name (Meta)
  │                                        • cache: 1x resolvido, memoriza
  ├─ Layer 1  Texto (greeting/title/body) ─▶ regex + match no catálogo               [sem LLM]
  ├─ Layer 2  Visão CORRIGIDA          ─▶ {marca,modelo,versao,ano|null,cor,conf}    [LLM visão]
  │                                        • melhor imagem: originalImageURL > thumbnailURL
  │                                        • saída ESTRUTURADA; ano ausente = null (fim do AAAA)
  │                                        • timeout maior + 1 retry; modelo de visão atual
  └─ Layer 3  Grounding + fallback     ─▶ casa no estoque RevendaMais vivo
                                           • 1 match  → oferta aterrada
                                           • N anos   → LISTA numerada (não chuta)
                                           • 0 match   → abordagem honesta (pede modelo/print)
```

**Detalhe por camada:**

- **Layer 0 — Ad-ID (mais confiável, quando existe).** `externalAdReply.sourceID` é estável por anúncio. **Funciona muito bem para lojas que rodam anúncios por veículo** (catálogo dinâmico Meta). Fontes de mapeamento: (a) tabela `ad_vehicle_map` mantida por tenant; (b) `ad_name`/`campaign_name` do Meta (já existem colunas `ad_id`, `ad_name`, `campaign_name` em `ai_crm_leads`, `meta_form_leads`, `campaign_costs`) parseadas para marca+modelo+ano; (c) *cache* de resolução. **Ressalva Avant:** hoje a Avant roda **anúncio institucional único** → `ad_id` mapeia para a **loja, não um carro**; nesse caso Layer 0 não resolve veículo e o fluxo segue para Layer 2/3 (ou abordagem). O valor de Layer 0 cresce quando a loja anuncia por veículo.
- **Layer 1 — Texto.** Igual ao caminho 0.78–0.95 de hoje, mas o resultado é **casado no catálogo** (não é *query* livre).
- **Layer 2 — Visão corrigida.** Correções sobre o v2: (1) **prompt sem `AAAA`** — instruir *"se não conseguir ler o ano, retorne `ano: null`"*; (2) **saída estruturada** `{marca, modelo, versao, ano|null, cor, preco, confidence}` (não uma *string* `vehicle_query`); (3) **melhor imagem** — `originalImageURL` (full-res) antes de `thumbnailURL` (`s540`); permitir o *thumbnail* pequeno só como último recurso, com confiança baixa; (4) **timeout maior** (ex.: 8–10s) + 1 *retry*; (5) tratar o **ano como dica fraca** (o v2 já aprendeu que a arte mente) — a verdade do ano vem do **catálogo**.
- **Layer 3 — Grounding.** Reusa o *read-side* do v3 (`stock-normalizer.ts`, `buildTenantCatalog`, host allowlist de fotos). Casa `{marca, modelo}` no estoque vivo; se houver **vários anos** do mesmo modelo, **lista numerada** (o v3 já tem `renderVehicleOfferList` + `lastRenderedOfferContext` para referência ordinal — F2.7.12). Zero match → **abordagem honesta**.

**Recuperação de rajada (resolve Modo A2):** ao ver `externalAdReply` na **1ª mensagem**, **persistir** `{adId, source, sourceUrl, imageUrls[], title, body, greeting}` no `conversation_state`. Mensagens seguintes sem *referral* **herdam do state** em vez de virar "sem anúncio".

### 6.3 Encaixe no v3 (o que muda, concretamente)

| Onde | Mudança |
|---|---|
| `Agent/src/engine/ad-intake.ts` **(novo)** | Handler determinístico; decide se o turno é entrada de anúncio e produz `TurnOutput`. |
| `Agent/src/engine/ad-resolver.ts` **(novo)** | As 4 camadas (Layer 0–3). Lógica **pura**, testável offline. |
| `Agent/src/adapters/vision/*` **(novo)** | Adapter de visão isolado (porta), com *fake* para testes offline ($0). |
| `Agent/src/engine/conversation-engine.ts` | Inserir `ad-intake` no *chain* (ver §6.3.1). Após `applyDecision`, semear `state.adReferral`. |
| `Agent/src/domain/conversation-state.ts` | **+`adReferral: AdReferral | null`** (JSONB retrocompatível). **⚠️ contrato de state → parar e pedir Codex.** |
| Reuso | `stock-normalizer.ts`, `classifyVehicleType`, `buildTenantCatalog`, `renderVehicleOfferList`, `lastRenderedOfferContext`. |

**6.3.1 Posição no chain.** O `ad-intake` deve rodar **cedo**, logo após a identidade, **na 1ª mensagem do lead ou quando há `adReferral` novo/herdado**, antes de `explicit-search`/LLM — porque o anúncio é o **contexto primário do turno** (mesma lição do F2.7.13: turno atual > memória velha). Se não for turno de anúncio, passa adiante intacto.

### 6.4 Tipos/contratos técnicos (rascunho)

```ts
// Entrada extraída do externalAdReply (webhook → engine)
type AdReferral = {
  adId: string | null;            // externalAdReply.sourceID
  source: "facebook" | "instagram" | "fb.me" | string | null; // conversionSource/host
  sourceUrl: string | null;       // sourceURL (fb.me/…)
  imageUrls: string[];            // [originalImageURL, thumbnailURL] (ordem de preferência)
  title: string | null;
  body: string | null;
  greeting: string | null;        // greetingMessageBody
  capturedAtTurn: string;         // para expirar/herdar em rajada
};

// Resultado da leitura (saída do ad-resolver)
type AdReadResult = {
  layer: "ad_id" | "text" | "vision" | "none";
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | null;             // ★ null quando ilegível — NUNCA "AAAA"
  cor: string | null;
  preco: number | null;
  confidence: number;             // 0..1
  vehicleKeys: string[];          // aterrado no catálogo (0 = não resolveu)
  groundedInCatalog: boolean;
  diagnostics: Record<string, unknown>; // herda os campos do v2 + layer + imagem escolhida + ano_lido_vs_null
};
```

`reasonCode` do `TurnOutput`: `ad_id_offer` · `ad_text_offer` · `ad_vision_offer` · `ad_vision_list` · `ad_unidentified_approach`.

### 6.5 Quick wins (portáveis já) vs build estratégico

**Quick wins (baratos, alto retorno — valem inclusive para o v2):**
1. **Remover `AAAA` do prompt de visão** e exigir `ano: null` quando ilegível. **Corrige o Modo B (34% dos turnos) imediatamente.** *(Se o dono/Codex autorizarem tocar o v2; caso contrário, nasce já certo no v3.)*
2. **Preferir `originalImageURL`** ao `thumbnailURL` (`s540`) e **subir o timeout** de visão; permitir *thumbnail* pequeno com confiança baixa. Ataca parte do Modo A1.
3. **Layer 0 simples** — parsear `ad_name`/`campaign_name` do Meta (dados já existentes em `ai_crm_leads`) para os casos em que a loja anuncia por veículo.

**Build estratégico (o que o v3 precisa como "crucial"):**
- O **Ad Resolver em camadas** + **memória do anúncio no state** + **grounding no catálogo** + **recuperação de rajada estruturada**. É o que transforma leitura de anúncio de "OCR frágil" em "resolução determinística com fallback honesto".

### 6.6 Plano de testes (padrão do projeto)

- **Fixtures reais anonimizadas** a partir de `ctwa_diag_capture` (payloads Avant) — a **lição-chave do v2**: validar com **payload REAL** (`scripts/replay-ctwa.mjs`), nunca injeção simplificada.
- `tests/run-f2-7-15-ad-intake.ts` (novo), casos:
  1. **Ad-ID** resolve → oferta aterrada.
  2. **Texto** com modelo → oferta.
  3. **Visão: ano ilegível → `ano=null`** (nunca `AAAA`); modelo casa no catálogo; **vários anos → lista numerada**.
  4. **Institucional** (sem carro) → **abordagem honesta** (não inventa).
  5. **Rajada:** 1ª msg tem anúncio, 2ª "oi" → **herda do state**.
  6. **Falso-positivo** (código FB) → **não** vira anúncio.
- **Gates:** `npm run test:all` + `npx tsc --noEmit`. Registrar handoff em `Brain/` + memória.

---

## 7. Riscos, decisões e o que preciso do dono/Codex

- **Contrato de state (`adReferral`)** → **auditoria do Codex antes de codar** (regra do projeto: mudou contrato de state/tabela, para e pede auditoria).
- **Layer 0 depende de uma fonte `ad_id → veículo`.** Decisão do dono: **como as campanhas da Avant (e das outras lojas) nomeiam os anúncios?** O `ad_name` já traz o carro? Vamos manter um mapa manual por tenant, usar convenção de nome de campanha, ou puxar via Meta Graph API? *(Para a Avant especificamente, o anúncio atual é institucional — Layer 0 não resolve carro; confirmar se haverá anúncios por veículo.)*
- **Visão:** custo/latência — escolher modelo de visão e *timeout* (trade-off). Ano tratado como dica fraca; verdade vem do catálogo.
- **Escopo/segurança:** manter **Pedro v2 / bridge / webhook intactos**; **não** avançar para CRM/handoff/briefing; *fixtures* anonimizadas; nenhum segredo em repositório; `feed_url` do RevendaMais mora em `platform_integrations` (provável `api_key_encrypted`).

---

## 8. Apêndices

### A. Mapa de arquivos do Pedro v2 (referência para reimplementar no v3)

| Componente | Arquivo | Símbolo |
|---|---|---|
| Webhook | `supabase/functions/pedro-webhook-v2/index.ts` | `Deno.serve` (L113-117 chama diag) |
| Captura diag | `supabase/functions/pedro-webhook-v2/ctwaDiag.ts` | `logCtwaDiag` (marcadores L32-38) |
| **Leitura do anúncio** | `supabase/functions/_shared/pedro-v2/adContext_20260525.ts` | `resolvePedroAdContext` (L867-980) |
| Visão | idem | `inferVehicleFromImage` (L758) · prompt L787 (**bug `AAAA`**) |
| Saudação/texto | idem | `inferVehicleFromGreeting` (L641) · `inferVehicleFromAdCopy` (L703) · `inferVehicleFromText` (L600) |
| Frota genérica | idem | `isGenericFleetQuery` (L629) |
| Ano/limiar/timeout | idem | `stripYear` (L1010) · `MIN_AD_IMAGE_BYTES` (L158) · `IMAGE_TIMEOUT_MS` (L19) |
| → memória | idem | `adContextToMemory` (L~1008) |
| Estoque RevendaMais | `supabase/functions/_shared/pedro-v2/revendaMaisStock.ts` | `fetchRevendaMaisVehicles(feedUrl)` · `NormalizedVehicle` |
| Replay real | `scripts/replay-ctwa.mjs` | posta em `/functions/v1/pedro-webhook-v2` com `dry_run:true` |

### B. Shape do estoque RevendaMais (campos do feed → NormalizedVehicle)

`make→markName` · `base_model→modelName` · `model(+motorization)→versionName` · `year/fabric_year→year` · `mileage→km` · `promotion_price||price→saleValue` · `color→color` · `fuel→fuelName` · `gear→transmissionName` · `category→category` · `images_large||images→pictureJs [{Link,Principal}]`. Hosts de foto permitidos no v3: `s3.carro57.com.br`, `app.revendamais.com.br`, `bndvsistemalojistasst.blob.azure.com`. VehicleKey v3: `revendamais:${vehicle_id}` (fallback *fingerprint* SHA-256).

### C. SQL usado (tudo `SELECT`, read-only)

1. `information_schema.tables/columns` — descoberta de tabelas/colunas.
2. `wa_ai_agents` / `platform_integrations` — localizar Avant + RevendaMais.
3. `ctwa_diag_capture` — frequência de marcadores + 1 payload cru (estrutura Meta).
4. `pedro_v2_turn_logs` (tenant Avant) — `payload.ad_context`/`diagnostics`/`result`; breakdown por turno e por lead (§3).

### D. Números-âncora

- 223 turnos · 46 leads · janela 25–28/jun/2026.
- 50 turnos com `has_ad_context` · 40 leads de anúncio (1ª leitura).
- Turnos: 8 limpos · 17 `AAAA` · 25 sem veículo (17 visão-vazia + 8 sem-imagem) · 1 falso-positivo.
- Leads (1ª leitura): 5 limpos · 17 `AAAA` · 18 não identificados.
- `error` (coluna) = 0 · terminal-safe = 0 · `grounding_corrected` = 4.

---

*Fim do documento. Próximo passo sugerido: auditoria do Codex a este plano (especialmente o contrato de state `adReferral` e a estratégia de Layer 0), depois quebrar em fases F2.7.15+ com testes offline.*
