# CTWA / Anúncios Reais + Qualidade de CONDUÇÃO SDR (Fix A/B/C/D)

**Data:** 2026-07-07 · **Autor:** Claude (executor) · **Achado por:** audit real do Codex (`real-ad-audit-2026-07-07T13-12-44-938Z.md`, anúncios reais Icom/BNDV + Avant/RevendaMais) · **Modo:** central_active
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (zero regressão real) · **audit real** (rodapé). **NÃO commitado** — aguarda ok do dono.

## Contexto
O Codex rodou um audit com LLM real + estoque real + efeitos OFF usando anúncios REAIS. Marcou vários cenários PASS, mas o
dono revisou: **o gate era fraco** (só checava mecânica: status/terminalSafe/tool-chamada/modelo-citado) — não avaliava
CONDUÇÃO. Missão: corrigir por invariantes (sem if-por-anúncio, sem hardcode de modelo) e FORTALECER o gate.

## Causas-raiz
- **RC1** — Anúncio específico não amarra o veículo: "Onix Premier Turbo 1.0 2025" + 2 Onix 2025 no estoque → `resolveAdReferenceKey` >1 → null → "fotos dele" re-listava o estoque todo, sem `send_media`.
- **RC2** — Anúncio genérico abre pedindo NOME (Avant T1) em vez de descoberta comercial.
- **RC3** — Busca vazia MORRE: `stock_search`=0 → "não temos X. Quer que eu veja outras opções?" (beco), sem relaxar.
- **RC4** — Mudança de intenção mantém teto stale e morre: "tem Onix?" após "SUV até 90" → Onix+90k=0 → "não temos Onix até 90".
- **RC5** — Gate fraco (não reprova nome-no-T1-genérico, vazio-sem-conduzir, teto-stale, re-list-genérico-no-pedido-de-foto).

## Fix A (RC3+RC4) — Relaxamento determinístico de busca vazia
`commercial-constraints.ts` `relaxSearchCascade(zeroed, tipoHint)` PURO: busca exata=0 → cascata (same_type_in_range →
drop_ceiling → same_brand_in_range → same_type → in_range). **Preserva câmbio+anos RÍGIDOS** (F2.28: "EcoSport 2019 manual"
nunca vira 2020 auto) e **nunca re-propõe o filtro que zerou**. `central-engine.ts`: pós-loop, turno comercial com TODA busca
=0 → roda a cascata (cap 3, exclui "mais opções") + `buildRelaxedOfferResponse` CONDUZ nomeando o filtro + a alternativa;
se o cérebro autorou beco sem carro, DESCARTA a autoria. `reasonCode=recovery_relaxed_offer`. **F2.34 17 OK.**

## Fix B (RC2) — Abertura de anúncio genérico = DISCOVERY
Sinal `signals.adGenericEntry` (anúncio sem veículo + lead sem constraint/seleção + não-institucional). Guidance no
prompt-base do cérebro (LLM real) "abre com descoberta: modelo/tipo/faixa, não nome". **Backstop determinístico** no engine:
se abre pedindo NOME sem descoberta → troca por `buildGenericAdDiscoveryResponse` (`reasonCode=ad_generic_discovery`,
`deterministic_discovery`). **F2.32 ADGEN-1/2/3 OK.**

## Fix C (RC1) — Resolução granular + CONJUNTO CANDIDATO do anúncio
`ad-context.ts` `resolveAdCandidateKeys(ad, offeredItems)`: itens ofertados que casam modelo(+ano) do anúncio. Único → é a
referência (`resolveAdReferenceKey`) → envia. >1 (2 Onix 2025) → `buildDeterministicPhotoResponse` lista SÓ os candidatos do
anúncio (aterrado: marca/modelo/ano/preço reais) e pergunta QUAL (`reasonCode=photo_clarify_ad_candidates`), NUNCA re-lista o
estoque todo nem escolhe errado. `leadRequestsPhoto` extraído (source-agnostic). Override descarta re-listagem do cérebro.
**F2.35 9 OK.**

## Fix D (RC5) — Gate FORTE (audit permanente)
`eval/run-real-ads-audit.ts` (era `.tmp.ts`), `npm run audit:real-ads`. `baseViolations` agora reprova: telefone no
WhatsApp; **beco de busca vazia** ("quer outras opções?" sem listar preço). Cenários endurecidos: anúncio genérico T1 →
DESCOBERTA não nome; foto do anúncio → send_media OU clarify de candidatos (nunca re-list); mudança de intenção → busca certa.

## Testes offline (todos verdes, `test:all` EXIT 0)
Novos: **F2.34** (relaxamento, 17), **F2.35** (conjunto candidato, 9), **F2.32 ADGEN** (discovery). Ajustados p/ refletir a
condução (NÃO regressão — a missão muda o comportamento de busca vazia): F2.25 [I-4b] (relaxa), F2.28 [E-2] (código preserva
ano/câmbio rígido), F2.29 (mais-opções fora do gate da relaxação), F2.32 [D] (anúncio fora de estoque → mesmo tipo).

## Arquivos (só `services/pedro-v3/`, deploy Easypanel; SEM edge/Supabase)
`Agent/src/engine/commercial-constraints.ts` (relaxSearchCascade), `central-engine.ts` (relaxação+discovery backstop+
candidatos+adGenericEntry), `turn-understanding.ts` (leadRequestsPhoto), `ad-context.ts` (resolveAdCandidateKeys),
`turn-frame-builder.ts` + `domain/agent-brain.ts` (adGenericEntry), `adapters/llm/openai-agent-brain.ts` (guidance genérico);
testes `run-f2-34`, `run-f2-35`, `run-f2-32/25/28/29`, `package.json`; `eval/run-real-ads-audit.ts` (gate forte).

## Audit real (gate forte — LLM real gpt-4.1-mini, estoque real, efeitos OFF)
`npm run audit:real-ads` (`real-ad-audit-2026-07-07T14-28-12-110Z.md`): **FAIL(7)**, mas com PROVA de que os fixes funcionam
e o gate ficou forte. Leitura honesta:
- ⭐**Fix B PROVADO** (cenário 3 T1): "Para te ajudar melhor, **qual modelo ou tipo de carro** você está procurando?" — discovery, não nome.
- ⭐**Fix C PROVADO** (cenário 1 T3): "me manda fotos dele" → "**Do anúncio, temos essas opções:** 1. Onix 2025 R$76.990 … De qual você quer?" — lista SÓ os candidatos do anúncio, não escolhe errado (era o único FAIL explícito do relatório original).
- ⭐**Fix D PROVADO**: o gate forte pegou os becos reais (cenário 3 T2/T3), que o gate fraco deixava passar como PASS.

**As 7 violações restantes são pré-existentes ou de DADOS, não dos 4 fixes:**
1. **Cenário 1 T1/T2 `terminalSafe=true` (2):** a oferta de ENTRADA do anúncio (5 Onix) vem do `deterministic_recovery` (o cérebro não autora a lista, o engine recupera). A LISTA está CORRETA (Onix aterrados); só o marcador `terminalSafe` (degradado) dispara. **PRÉ-EXISTENTE** — decisão de semântica: recuperação ATERRADA (oferta/lista real) deveria contar como degradada? Afeta `DEGRADED_SOURCES` + muitos testes.
2. **Cenário 2 T2 `technical_fallback` (2):** "qual o valor dele?" (valor do HB20 selecionado) caiu em fallback em vez de `vehicle_details`. **Bug de detalhe-do-selecionado PRÉ-EXISTENTE**, fora dos 4 RCs desta missão.
3. **Cenário 3 T2/T3 beco + T3 sem-foto (3):** o estoque Avant/RevendaMais está **quase VAZIO** nessa faixa — o relaxamento RODA (cenário 4: `stock_search(0)`×3 e ×4 = original + relaxadas) mas não acha NADA. Sem alternativa real, o cérebro autora "quer outras opções?" (beco) e não há "segundo" p/ foto. **DADO** (estoque escasso) + o wording do beco do cérebro.

**Conclusão honesta:** Fix A (relax) + B (discovery) + C (candidato) + D (gate forte) FEITOS e offline-verdes; B e C PROVADOS no real. O audit não fica 100% verde por (1) semântica de terminalSafe em recuperação aterrada [decisão do dono], (2) bug pré-existente de detalhe-do-selecionado, (3) estoque Avant vazio.

## Fix A+ — Beco de busca vazia (aprovado pelo dono, FEITO)
Das 3 categorias restantes, o dono aprovou só o **beco de busca vazia**. Implementado: quando a busca zera E o relaxamento
não acha alternativa E o cérebro autora um BECO ("quer que eu veja/mostre outras opções?"), o engine DESCARTA a autoria e
responde com `buildEmptySearchConductingRecovery` — HONESTA+CONDUTORA: nomeia o filtro que zerou + pergunta específica
("Não achei ‹filtro› agora. Posso ampliar a faixa de preço ou te mostrar outro modelo/tipo — o que você prefere?"). É uma
resposta BOA (source `deterministic_conduct`, **não degradada**, reasonCode `recovery_stock_empty_conduct`), nunca o beco
vago. Gate `!relaxedOffer && emptySearchZeroedDesc && cérebro-autorou-beco` (só descarta beco AUTORADO — F2.28 [E-2], onde o
cérebro NÃO autora beco, segue em `recovery_stock_empty`). `isEmptySearchBeco` detecta "quer que eu veja/mostre/procure/busque
outras/mais opções". **F2.34 E-1/E-2 OK** (19 total). Detectores de beco também reforçados no gate do audit (baseViolations).

⏭️**Deferidos (dono não pediu agora):** (1) semântica terminalSafe da recuperação ATERRADA (oferta/lista real deveria contar
como degradada? mexe em DEGRADED_SOURCES); (2) bug de detalhe-do-selecionado ("qual o valor dele?" → vehicle_details, não
technical_fallback); (3) estoque Avant/RevendaMais vazio (é dado? integração?).

**⚠️ Achado do beco fix (real):** o gate `!isVehicleDetailTurn` deixava o relaxamento/beco de fora quando o interpretador
classificava "tem Compass até 100 mil?" como `asks_vehicle_detail` (mas o cérebro RODOU stock_search de verdade). Corrigido:
o gate passou a ser **"existe busca EXECUTADA que voltou 0"** (robusto à classificação da relação), não `commercialSearchTurn`.
Trava offline: F2.34 **[E-3]** (asks_vehicle_detail + busca vazia → ainda conduz). F2.34 **20 OK**.

## ⭐ Resultado FINAL do audit real: FAIL(7) → **FAIL(1)**
`real-ad-audit-2026-07-07T15-00-03-903Z.md`: **1 violação** (era 7). Cenários **2, 3 e 4 PASS**. Provas no real:
- **Beco (dono) PROVADO** — cenário 3 T2 "tem Compass até 100 mil?" → *"Não achei Compass até R$ 100.000 no estoque agora.
  Posso ampliar a faixa de preço ou te mostrar outro modelo ou tipo de carro — o que você prefere?"* (`deterministic_conduct`).
- **Fix B PROVADO** (T1 discovery, não nome). **Fix C PROVADO** (rodada anterior: clarify de candidatos do anúncio). **Fix D** (gate forte).
- **Única falha restante:** cenário 1 T1 `terminalSafe` = a oferta de ENTRADA do anúncio (lista os Onix, CORRETA) via
  recuperação aterrada marcada "degradada" — **exatamente a categoria (1) que o dono DEFERIU**. Não é regressão nem bug novo.
