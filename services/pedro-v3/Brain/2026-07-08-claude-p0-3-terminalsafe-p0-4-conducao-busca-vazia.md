# P0-3 (semântica terminalSafe/degraded) + P0-4 (condução de busca vazia) — audit de anúncios reais

**Data:** 2026-07-08 · **Autor:** Claude (executor) · **Missão:** dono (P0-3/P0-4 do audit real) · **Modo:** central_active
**Base git:** `d865cb33 fix(pedro-v3): estabilizar recuperacao contextual` (Codex) — fetch/rebase feito antes de mexer.
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.34 **30 OK**, zero regressão) · audit real (rodapé). **Sem commit** (aguarda auditoria Codex).

## Diagnóstico por causa-raiz
- **P0-3** — recuperação ATERRADA (lista carros reais do estoque) vinha marcada `terminalSafe=true`/degraded → o gate reprova qualidade real e mascara. Causa: `deterministic_recovery` estava em `DEGRADED_SOURCES`.
- **P0-4** — busca comercial que zera SEM alternativa relaxada terminava num texto vago ("Quer que eu amplie para outras opções parecidas?") quando o cérebro NÃO autorava (path `recovery_stock_empty`). E, no real, o gate da relaxação (`!isVehicleDetailTurn`) barrava a condução quando o interpretador classificava "tem Compass até 100 mil?" como `asks_vehicle_detail` (mas rodou stock_search de verdade).

## P0-3 — semântica terminalSafe/degraded (núcleo já do Codex + testes meus)
Codex já fez: `DEGRADED_SOURCES = new Set(["technical_fallback"])`. Só o fallback técnico genérico é degradado; toda recuperação
aterrada (`deterministic_recovery`/`recovery_offer`/`recovery_relaxed_offer`/`deterministic_conduct`/`deterministic_photo`/
`deterministic_discovery`/`deterministic_recall`) é resposta VÁLIDA (não-degradada). Adicionei os testes que PROVAM a semântica:
- **F2.34 [TS-1]** recovery_offer (lista Creta/Renegade via recuperação) → `terminalSafe=false && degraded=false`.
- **F2.34 [TS-2/2b]** technical_fallback (turno genérico, cérebro não autora) → `terminalSafe=true && degraded=true`.
- **F2.34 [TS-3]** recovery_stock_empty (busca vazia, cérebro não autora) → conduz + NÃO degradado.
- (Já existiam [A-6] relaxed offer não-degradado e [E-2b] conduct não-degradado.)

## P0-4 — condução específica de busca vazia (invariante, sem if por frase)
- **Texto ÚNICO** de condução (`emptySearchConductingText(desc)`): "Não achei ‹filtro› no estoque agora. Posso ampliar a faixa
  de preço ou te mostrar outro modelo ou tipo de carro — o que você prefere?" — nomeia o filtro + DUAS direções específicas,
  nunca "quer outras opções?". Usado no executor de condução (`buildEmptySearchConductingRecovery`) E no `recovery_stock_empty`
  (`buildContextualRecovery`) — ambos os caminhos (cérebro autorou beco / não autorou) conduzem igual. reasonCode preservado.
- **Cascata** (já existente): busca 0 → `same_type_in_range` (na faixa) → `drop_ceiling` (modelo pedido um pouco ACIMA) →
  `same_brand_in_range` → `same_type` → `in_range`. Preserva câmbio/ano rígidos. Se acha itens → oferta relaxada aterrada
  (`recovery_relaxed_offer`, não-degradada). Só cai na condução quando NADA em nenhum passo.
- **Intent-change**: `mergeActiveConstraints` já solta o TIPO antigo quando o lead troca para um MODELO específico ("na verdade
  tem Onix?" após "SUV até 90" → busca Onix, não fica preso em suv; mantém o teto; se 0 → cascata/condução).
- Testes: **F2.34 [IC-1/2]** (Onix após SUV90 busca Onix, não fica preso em suv, conduz nomeando Onix) + **[FS-1/2]** ("fotos
  do segundo" SEM lista → nunca envia mídia inventada, pergunta qual).

## Audit forte (`eval/run-real-ads-audit.ts`)
Colunas novas no relatório por turno: `stockInput` (busca executada), `selectedKey` (`resolvedVehicleKey`), `terminalSafe`.
Assertivas qualitativas (além das já existentes — adVehicle, discovery-não-nome, beco, telefone): "turno atual vence o
anúncio" — cenário 1 T4 não fica PRESO no Onix ao pedir HB20; cenário 4 T3 não mantém `tipo=suv` STALE ao trocar para Onix.

## Arquivos alterados (só `services/pedro-v3/`)
`Agent/src/engine/central-engine.ts` (emptySearchConductingText compartilhado; recovery_stock_empty conduz),
`Agent/eval/run-real-ads-audit.ts` (colunas + assertivas + adVehicle), `Agent/tests/run-f2-34-empty-search-relaxation.ts`
(TS-1/2/3, IC-1/2, FS-1/2). P0-3 core = commit do Codex `d865cb33`.

## Audit real reduzido (gate barato — LLM real gpt-4.1-mini, estoque real, efeitos OFF)
**RESULT PASS · failures=0** · relatório `eval/reports/real-ad-audit-2026-07-07T19-17-04-197Z.md` · 4 cenários × 3–4 turnos.
O veredito é a CONVERSA — julgada turno-a-turno, não só o PASS mecânico. Todos os invariantes-alvo dispararam no real:
- **C1 (Icom Onix→HB20):** T1 aterra no Onix do anúncio (lista real, `deterministic_recovery`); T3 "me manda fotos dele" desambigua
  entre os Onix (`deterministic_photo`, não inventa mídia); **T4 "na verdade quero HB20 até 80 mil" → busca `{precoMax:80000,
  modelo:HB20}` e lista HB20** = turno vence o anúncio, sem tipo/modelo stale. ✅
- **C2 (Icom HB20→SUV):** T1/T2 aterram no HB20; **T3 "SUV automático até 100 mil" → `{tipo:suv,cambio:automatic,precoMax:100000}`**,
  lista Pajero/2008 = turno vence o anúncio. ✅
- **C3 (Avant genérico→Compass):** T1 abre em **discovery** ("qual tipo/modelo?"), não nome/telefone; **T2 "tem Compass até 100 mil?"
  → 0 em cascata → `deterministic_conduct`: "Não achei Compass até R$ 100.000… Posso ampliar a faixa… outro modelo ou tipo — o que
  prefere?"** = P0-4 puro (nomeia filtro + 2 direções, sem "quer outras opções?"); **T3 "me manda fotos do segundo" sem lista prévia
  → "De qual carro?"** (não inventa mídia). ✅
- **C4 (Avant genérico→Onix):** T1 apresentação/discovery; T2 "SUV até 90 mil" conduz honesto; **T3 "na verdade tem Onix?" solta
  tipo=suv → busca `{tipo:hatch}`** (intent-change via mergeActiveConstraints) e conduz; T4 institucional (endereço) aterrado. ✅

### Ressalvas honestas (NÃO são falhas de invariante — pra ciência do Codex)
1. **Feed Avant/RevendaMais:** toda busca de SUV/Compass/Onix nos C3/C4 voltou **0** (3–4 `stock_search(0)`). A condução honesta está
   CORRETA, mas a loja "nunca ter nada" sugere feed de teste magro/sem SUV — vale o Codex/dono confirmar se o feed da Avant está
   completo. Não é bug do fix; é dado de estoque.
2. **Capitalização do modelo no texto de condução:** "Não achei **onix** no estoque" (minúsculo, vem do `desc` do filtro).
   Cosmético — normalizar (capitalizar modelo) no `emptySearchConductingText` seria um polimento.
3. **"consultor" (gênero) pra Manu:** vem do `system_prompt` do cliente, fora do escopo do invariante.

### Gates finais
`tsc` EXIT 0 · `test:all` EXIT 0 · F2.34 **30 OK / 0 FALHA** · F2.28 23 OK · F2.25 29 OK. **Zero regressão. Sem commit — para auditoria Codex.**
