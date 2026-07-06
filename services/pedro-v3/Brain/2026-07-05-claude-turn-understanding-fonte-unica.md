# P0 — FONTE ÚNICA DE INTENÇÃO (TurnUnderstanding): elimina fallbacks por conflito cérebro×regex×memória×alvo — 2026-07-05

**Autor:** Claude (executor). **Auditor:** Codex. **NÃO commitado** (parar para auditoria). Base: `d0c35981`.

## 1) CAUSA-RAIZ POR INCIDENTE (auditoria Codex, tenant ecb26258)

### Incidente 1 — foto do Kicks, mas enviou Onix
- Lead: "Certo\nQuero ver fotos do Kicks". O cérebro RESOLVEU `vehicle_photos_resolve(revendamais:8195955=Kicks)`.
- A decisão final enviou Onix (`revendamais:8187454`).
- **Causa exata** (`central-engine.ts` `buildDeterministicPhotoResponse`): o alvo era
  `resolveSelectedVehicle(lead) ?? state.vehicleContext.selected?.key`. `resolveSelectedVehicle`
  (`lead-extraction.ts:323`) só resolve contra `lastRenderedOfferContext.items` (a ÚLTIMA OFERTA); com a oferta
  vazia/stale ele retorna null → cai no `selected` ANTIGO (Onix). **O fato `vehicle_photos_resolve` PRODUZIDO NESTE
  TURNO (Kicks) nunca é fonte de precedência do alvo.** Memória antiga venceu o fato do turno.

### Incidente 2 — "E o kiks, tem?" virou fotos e caiu em technical_fallback
- Turno executou vehicle_photos_resolve → stock_search → vehicle_photos_resolve; P0-B negou 3 drafts
  ("O cliente NÃO pediu fotos neste turno") → technical_fallback.
- **Causa exata**: `deriveCurrentTurnIntent` (`central-engine.ts:506`) não classificou "kiks" (typo) como busca —
  `isFreshSearchTurn` depende de `claimExtractor` (catálogo) que não casa o erro ortográfico. Sem currentTurnIntent=
  search, a MEMÓRIA velha de `photo_request`/`activeTopic` contaminou o turno; o cérebro insistiu em foto e o P0-B
  (regex) barrou. Regex + memória decidindo semântica no lugar do entendimento do turno.

### Incidente 3 — "quero comprar o terceiro\nMe mande fotos" → technical_fallback
- Estado selecionou o 3º corretamente (NISSAN Kicks 2022, `revendamais:8085609`); vehicle_photos_resolve rodou p/ ele.
- P0-B declarou 3× "não pediu fotos" → technical_fallback.
- **Causa exata** (`central-engine.ts:195`): `PHOTO_REQUEST_RX` = `(manda|mandar|envia|enviar|mostra|mostrar|...)` —
  pega "manda/mandar" mas **NÃO "mande/envie"**. `isPhotoRequestBlock("Me mande fotos")` = false → `photoTurn`=false →
  P0-B bloqueia o send_media que o cérebro corretamente propôs. Regex frágil (flexão verbal) decidindo comércio.

### Denominador comum
A SEMÂNTICA DO TURNO está DUPLICADA e sem autoridade única: `deriveCurrentTurnIntent`, `isPhotoRequestBlock`,
`PHOTO_ACTIVE_SEND_RX`, `textPromisesPhoto`, `reasonCodeIsPhotoSend`, `FrameSignals`, memória
(`currentLeadIntent`/`activeTopic`/`lastPhotoAction`), o entendimento implícito do cérebro e o alvo do
`buildDeterministicPhotoResponse` — todos "decidem" e podem conflitar. Regex frágil e memória velha vencem o pedido
explícito do bloco atual.

## 2) DESENHO — FONTE ÚNICA: `TurnUnderstanding` do cérebro, validado por evidência

**Princípio**: o cérebro LLM (que já lê o bloco no mesmo ciclo) emite um contrato estruturado
`TurnUnderstanding`; o engine VALIDA que cada `evidence.quote` é substring do bloco atual (anti-alucinação), mas NÃO
re-decide a conversa por lista de frases. Esse entendimento validado é a AUTORIDADE ÚNICA consumida por: guarda de
foto, exigência de tool, resolução de alvo e recuperação. Regex vira apenas FALLBACK robusto (stems) quando o cérebro
não emite entendimento (saída malformada) — nunca a autoridade.

### Contrato (`domain/agent-brain.ts`)
```
TurnUnderstanding {
  primaryIntent: search_stock | request_photos | recall_photos | select_vehicle | vehicle_detail |
                 institutional | financing | visit | smalltalk | other
  requestedCapabilities: (stock_search|send_photos|vehicle_details|institutional_info|recall|select)[]
  subject: explicit_model | ordinal_from_last_offer | selected_vehicle | vehicle_type | budget | none
  subjectValue: string|null      // modelo citado / número do ordinal / tipo / faixa — texto BRUTO p/ o resolver de alvo
  subjectSource: current_turn | memory | inference | none   // provenance (inference = cérebro corrigiu typo: kiks→Kicks)
  evidence: { capability?, quote }[]   // cada quote TEM de existir no bloco atual (engine valida)
  isTopicChange: boolean
  answeredLeadQuestions: string[]
}
```
Emitido em `AgentBrainStep` (query|final). O engine captura o ÚLTIMO entendimento não-nulo (refinado após tools).

### Validação (novo `engine/turn-understanding.ts`, puro, sem ciclo)
- `validateTurnUnderstanding(u, block)`: mantém só capabilities cuja `evidence.quote` é substring de `normalizeText(block)`;
  se `primaryIntent` exige evidência e não há quote válido → rebaixa (fail-closed). Nunca INVENTA capability.
- `deriveFallbackUnderstanding(block, signals, claimExtractor)`: usado só quando o cérebro não emitiu — regex por STEM
  (`mand\w*|envi\w*|mostr\w*`, robusto a flexão) + claim extraction. Secundário, jamais autoridade.
- `resolveTurnSemantics(brainU, block, fallbackInputs)`: devolve o entendimento AUTORITATIVO (validado do cérebro OU
  fallback). Ponto ÚNICO consumido por todo o resto.

### T2 — guarda de foto (semântica central, módulo único)
`authorizesPhotoSend(u)` = `primaryIntent==="request_photos"` (ou capability send_photos com evidência) E sem
negação/adiamento (mantém `isNegatedPhotoRequest` escopado por cláusula) E entendimento não é `recall_photos`. Substitui
`isPhotoRequestBlock`/`PHOTO_ACTIVE_SEND_RX`/`textPromisesPhoto`/`reasonCodeIsPhotoSend` como AUTORIDADE do P0-B.
Pergunta de memória (`recall_photos`) nunca envia mídia.

### T3 — precedência do alvo (`resolveTurnTarget`)
1. Modelo explícito do turno (`subject=explicit_model` → stock_search/último fato). 2. Ordinal contra a última lista.
3. **Fato de tool DESTE turno p/ o subject** — se houver exatamente 1 `vehicle_photos_resolve` ok (ou `stock_search`
   1 item) que casa o subject, esse vehicleKey VENCE o foco antigo. 4. `selected` antigo SÓ p/ pronome sem novo alvo.
5. Ambíguo → esclarecer. Nunca `selected` antigo quando lead escreveu outro modelo / tool do turno resolveu outro key /
   `isTopicChange`. Label sempre canônico (`canonicalVehicleLabel`), nunca key crua. **Corrige Inc1.**

### T4 — busca com typo
`requiredToolBeforeFinal` passa a exigir stock_search quando `u.primaryIntent==="search_stock"` (não mais o regex
`currentTurnIntent`). O cérebro interpreta/corrige o alvo (kiks→Kicks) e chama stock_search; o engine só garante que
search_stock não finaliza afirmando estoque sem a tool. Sem alias hardcoded. **Corrige Inc2** (a memória de foto não
assume: `primaryIntent=search_stock` tem precedência absoluta sobre `activeTopic`/`lastPhotoAction`).

### T5 — recuperação contextual (sem texto genérico) + fingerprint de deny
Ao esgotar/ver deny repetido: usa `TurnUnderstanding` + fatos reais p/ montar resposta contextual — foto+photoIds→mídia;
foto ambígua→qual item; busca c/ itens→apresenta; busca sem item→honesto+similar; detalhe sem veículo→qual; tool
indisponível→contextual. `technical_fallback` continua interno (observabilidade) mas o TEXTO genérico ("não consegui
confirmar"/"reformule") NUNCA vai ao outbox. Fingerprint (reasonCode+chave do feedback) repetido → recupera na hora, não
gasta 3 tentativas idênticas.

### T6 — observabilidade
`decision_final` ganha: primaryIntent, subject, subjectSource, evidence, previousSelectedVehicleKey,
resolvedVehicleKey, targetResolutionSource, policyFeedback por tentativa, recoveryReason, responseSource. (v3_query_log:
a escrita da tabela é do adapter de runtime/bridge — ver RISCOS.)

## 3) ARQUIVOS (planejado)
- `domain/agent-brain.ts` — tipos TurnUnderstanding + `understanding?` em AgentBrainStep.
- `engine/turn-understanding.ts` (novo) — validate/derive/resolveTurnSemantics + authorizesPhotoSend + resolveTurnTarget + fingerprint.
- `engine/central-engine.ts` — consumir o entendimento (P0-B, required-tool, executor de foto, recuperação, observabilidade).
- `adapters/llm/openai-agent-brain.ts` — emitir/decodificar understanding + BRAIN_PROTOCOL.
- `tests/run-f2-23-turn-understanding.ts` (novo) — casos A–H.

## 4) RISCOS / LIMITES (a validar com Codex)
- v3_query_log: a inserção na tabela Postgres é do runtime/bridge (fora do Agent TS puro). Sem tocar bridge nem SQL,
  registro a intenção de tools no `decision_final` (que o Agent controla) e documento o gap do v3_query_log.
- Fallback determinístico: mantido só p/ saída malformada do LLM, com STEMS (robusto), claramente NÃO-autoridade.
- legacy `photo-intent.ts` (caminho off) NÃO é tocado — a centralização é do caminho CENTRAL.

**NÃO commitar/pushar/deploy/SQL. Parar para auditoria Codex.**

## 5) IMPLEMENTADO (2026-07-05) — arquivos e resultados

### Arquivos
- `domain/agent-brain.ts` — tipos `TurnUnderstanding` (+ enums PRIMARY_INTENTS/TURN_CAPABILITIES/TURN_SUBJECT_KINDS/
  SUBJECT_SOURCES) + `understanding?` em `AgentBrainStep` (query|final).
- `engine/turn-understanding.ts` (NOVO) — `validateTurnUnderstanding` (evidência⊂bloco) · `authorizesPhotoSend`
  (capability send_photos + evidência COERENTE que menciona foto/imagem + sem negação; corrige o falso-envio proativo) ·
  `isPhotoRecall`/`isStockSearchTurn` · `resolveTurnTarget` (precedência T3) · `deriveFallbackUnderstanding` (stems, só
  quando o cérebro não emite) · `denyFingerprint` · `isPhotoDeclined` (negação escopada por cláusula).
- `engine/central-engine.ts` — captura `understanding` no loop; `authoritativeVU()` (cérebro OU fallback validado);
  guarda de foto por `authorizesPhotoSend`; `requiredToolBeforeFinal` por `isStockSearchTurn`; executor de foto por
  `resolveTurnTarget` (fato do turno vence selected antigo); `buildContextualRecovery` (T5, nunca texto genérico;
  branch de negação acolhe); fingerprint de deny repetido; observabilidade no `decision_final` + no result.
  `buildTechnicalFallback` (fala genérica) REMOVIDA.
- `adapters/llm/openai-agent-brain.ts` — emite/decodifica `understanding`; BRAIN_PROTOCOL (contrato understanding +
  "envie foto SÓ com pedido explícito de foto no bloco" + "negação de foto -> acolhe, não repergunta conhecido").
- `tests/run-f2-23-turn-understanding.ts` (NOVO, 12 OK) + `tests/run-central-no-generic-fallback.ts` (scan, 5 OK) +
  `eval/run-eval-understanding.ts` (NOVO) + harness/assertions estendidos (understanding/targetSource/resolved).

### Gates OFFLINE (sem OpenAI)
- `run-f2-23` **12 OK**: A Inc1 (foto do Kicks, não do Onix; targetSource=turn_photo_fact) · B Inc2 (typo "kiks"→busca,
  sem mídia, sem falar do Onix) · C Inc3 ("Me mande fotos" autoriza o 3º Kicks) · D negação fail-closed (zero mídia) ·
  E recall (zero mídia, nomeia) · F smalltalk (zero mídia, mantém foco) · G troca Onix→Kicks (foco antigo não interfere) ·
  H fingerprint (não gasta 8 tentativas, recuperação aterrada, sem texto genérico) · I fallback sem understanding autoriza.
- `run-central-no-generic-fallback` **5 OK** (a fala genérica não existe mais em código do central_active).
- `test:all` EXIT 0 (F2.13 46 / F2.15 18 / F2.16 5 / F2.20 21 / F2.21 35 / F2.22 21 sem regressão) · `tsc` EXIT 0.

### Replay REAL (gpt-4.1-mini, efeitos OFF, compose=0, US$0,038, 12 chamadas ≤20) — **PASS, 0 violações**
Sequência: "Quais SUV?" → "quero comprar o terceiro" → "Me mande fotos" → "E o Onix, tem?" → "não quero foto agora".
- T1 lista SUVs (search_stock, sem mídia). T2 seleciona o 3º (PEUGEOT 2008). T3 "Me mande fotos" → **send_media do 2008
  selecionado** (targetSrc do turno; nota: nesse turno o cérebro OMITIU o understanding e o **fallback robusto** autorizou
  pela palavra "fotos" e resolveu o alvo — rede de segurança comprovada em produção). **T4 "E o Onix, tem?" → lista Onix,
  ZERO mídia** (o falso-envio proativo foi corrigido). **T5 "não quero foto agora" → "Tranquilo! ..." (brain_final, sem
  degradar)**. 0 fallback visível, mídia só no pedido explícito, troca respeitada, memória não sequestra.
- ⚠️ 1ª rodada real (antes dos fixes) reprovou por T4 (foto proativa) e T5 (reperguntou slot→degradou). Corrigido:
  foto-evidência coerente + prompt (foto só com pedido; negação acolhe) + recovery de negação. Re-rodado 1x = PASS.

### RISCOS/limites (p/ Codex)
- v3_query_log: a INSERÇÃO da tabela é do runtime/bridge (fora do Agent TS). Registrei `toolsExecuted` no `decision_final`
  (que o Agent controla) + no result; ligar o v3_query_log exige tocar o bridge (fora do escopo/proibido). GAP documentado.
- O cérebro às vezes OMITE `understanding` (visto no T3 real). Não é crítico (fallback robusto cobre e foi provado), mas
  reduz observabilidade naquele turno. Candidato a reforço de prompt/retry.
- `authorizesPhotoSend` exige a palavra foto/imagem no bloco (via evidência) → reenvio IMPLÍCITO sem a palavra ("manda de
  novo") não auto-envia no central (o legado photo-intent.ts trata; central prioriza não-over-enviar). Decisão consciente.
- `deriveFallbackUnderstanding` mantém stems como REDE DE SEGURANÇA (não autoridade) — some se o cérebro sempre emitir.

**Status: gates offline + replay real PASS. NÃO commitado. Parar para auditoria Codex.**

## 6) AUDITORIA CODEX F2.23 — 2 P0 + 2 P1 CORRIGIDOS (2026-07-05, 2ª rodada)

### P0-1 — foto VINCULADA ao assunto (não a "1 photo fact")
Antes: `resolveTurnTarget` aceitava `photoKeys.length===1 -> turn_photo_fact` (provava só que UMA foto foi consultada).
Cenário perigoso: pede Kicks, cérebro resolve Onix, envia Onix. **Correção** (`turn-understanding.ts`):
- `resolveTurnTarget` devolve `candidateVehicleKeys` VERIFICADOS por modelo (`knownModels`: key->modelo de fato/oferta/
  identidade/seleção). Ordinal->key exata da lista; modelo explícito->keys que casam canonicamente; pronome->selected;
  **modelo diferente NUNCA herda selected**; >1 variante->`ambiguous`. `subjectModel` no resultado.
- `targetAcceptsKey(target,key)`: um `vehicle_photos_resolve`/`send_media` só vale se sua key ∈ candidates. Foto do carro
  ERRADO -> REJEITADA (`authorFromBrainDraft` devolve feedback ao cérebro; o executor ignora o fato incompatível). O alvo
  vem SEMPRE do ASSUNTO, nunca de um photo fact solto. Sem `if` por marca/modelo.

### P0-2 — TurnUnderstanding do CÉREBRO obrigatório p/ ação comercial; fallback nunca autoriza
- Em `central_active+llmFirst` (`requireBrain`): tool COMERCIAL (`stock_search`/`vehicle_details`/`vehicle_photos_resolve`)
  só executa com understanding VÁLIDO do cérebro; sem ele -> observação `REQUIRED_TURN_UNDERSTANDING` -> retry. `send_media`
  idem (gate em `authorFromBrainDraft`). `authorizesPhotoSend(v,block,requireBrain)`: em llmFirst exige `fromBrain`.
- `deriveFallbackUnderstanding` virou HINT conservador só p/ recuperação TEXTUAL — NUNCA autoriza mídia/foco/tool. Removido
  "qualquer palavra foto -> request_photos" (agora exige verbo de envio + foto, imperativo). Sem llmFirst (replay/legado) o
  fallback validado ainda autoriza (compat F2.17/F2.15/F2.20).

### P1 — validação vincula evidência à capability + TRAVA do assunto
- `capabilityHasOwnEvidence`: capability stateful exige evidência DA PRÓPRIA capability; `hasPhotoEvidence`: a evidência do
  send_photos TEM de mencionar foto/imagem (evidence "oi" não autoriza). `reconcileUnderstanding`: a 1ª compreensão válida
  TRAVA o assunto — refinamento só adiciona fato; trocar primaryIntent/subject sem evidência NOVA é rejeitado
  (search_stock->request_photos sem nova evidência de foto = mantém search_stock).

### P1 — recuperação de busca diferencia executada-vazia / falha / não-executada
`buildContextualRecovery`: só diz "não encontrei no estoque" quando stock_search EXECUTOU com 0 itens (ausência real);
tool falhou (UPSTREAM)->indisponibilidade temporária; nenhuma busca executada->não afirma ausência, pergunta específica.

### deterministic_recovery (observabilidade honesta)
Recuperação CONTEXTUAL aterrada (oferta/qual/honesto) agora é `responseSource=deterministic_recovery` (degradada, mas texto
útil — NÃO conta como "fallback visível"); só o default genérico é `technical_fallback`. `isDegradedSource` cobre as duas.

### Gates (2ª rodada)
- `run-f2-23` **18 OK** (A-I + adversariais: J foto-do-carro-errado rejeitada, L 3 variantes->pergunta, N selected não
  vence, O "gostei das fotos" 0 mídia, U evidence "oi" não autoriza, V trava do assunto). test:all EXIT 0, tsc EXIT 0,
  `git diff --check` limpo (F2.17/F2.15/F2.20/F2.21/F2.22 ajustados p/ o novo contrato; F2.21/F2.22 usam `UnderstandingBrain`
  que anexa understanding derivado do lead — testam condução, não o gate).
- Real 6 turnos Codex (`eval:understanding`, gpt-4.1-mini, compose=0, US$0,058, 19 chamadas): **PASS, 0 violações** — T2 3º
  correto, T3 foto do 3º, **T4 "Gostei das fotos" 0 mídia**, T5 troca p/ Onix, **T6 "fotos do Onix" (2 variantes) -> "de qual
  carro?" 0 mídia** (deterministic_recovery, nunca variante arbitrária/carro errado). ⚠️T6 o cérebro omitiu understanding ->
  gate barrou os stock_search -> recuperação correta (pergunta qual). Comportamento SEGURO; observabilidade registra.

**NÃO commitado. Parar para NOVA auditoria Codex.**

## 7) AUDITORIA CODEX F2.23 — 2 P0 estreitos + 1 P1 (3ª rodada, 2026-07-05, sem reabrir arquitetura)

### P0-1 — subjectValue corresponde ao claim/modelo ESCRITO (não união silenciosa)
`resolveTurnTarget` (`turn-understanding.ts`):
- claim ESCRITO no texto tem PRECEDÊNCIA sobre subjectValue inferido; subjectValue que CONFLITA com o claim -> kind
  `conflict` (entendimento INVÁLIDO, ZERO mídia, feedback "corrija o subject"). Nunca UNIÃO de modelos conflitantes.
- sem claim exato (typo): `subjectSource=inference` só vira candidato se CONFIRMADO por knownModels (stock_search/oferta/
  detalhe) OU pelo catálogo (claimExtractor). vehicle_photos_resolve NUNCA confirma modelo sozinho (knownModels não
  inclui key de photo fact). `targetAcceptsKey(conflict)=false`.

### P0-2 — autorização TIPADA por tool (não `brainUnderstandingReady` genérico)
`toolCapabilityAuthorized(v, tool)` exige capability PRÓPRIA + evidência própria do cérebro: stock_search->stock_search,
vehicle_details->vehicle_details, vehicle_photos_resolve->send_photos, select->select. Exceção SISTÊMICA TIPADA:
`systemDetailKeys` — vehicle_details do key que o engine exigiu p/ grounding (B2) é autorizado, separado da intenção da
LLM. `isStockSearchTurn` = `toolCapabilityAuthorized(stock_search)`. Filtro de `select_vehicle_focus`: proposto pela LLM
sem cap select/evidência é DESCARTADO (foco não muda); ordinal determinístico (target=turn_ordinal do mesmo key) ainda
seleciona. `deriveFallbackUnderstanding` agora é MULTI-capability (turno misto "horário e km" acumula institutional_info+
vehicle_details, cada uma com evidência própria; modelo SOLTO só vira busca sem outra intenção).

### P1 — recuperação trata QUALQUER falha real de stock_search
`buildContextualRecovery`: `stockFailed` = observação de stock_search com erro cujo code NÃO é de CONTROLE (exclui
REQUIRED_TOOL_MISSING/DUP_TOOL/FORBIDDEN/REQUIRED_TURN_UNDERSTANDING) -> indisponibilidade temporária (não só UPSTREAM).

### Gates (3ª rodada)
`run-f2-23` **25 OK** (18 + adversariais: W smalltalk-oi não autoriza stock_search, X não autoriza photos, Y select sem
cap descartado, Z subjectValue conflita->inválido, AA typo inferido+confirmado->busca executa, P4 photo positivo, P6
detail positivo). test:all EXIT 0, tsc EXIT 0, `git diff --check` limpo (F2.21/F2.22 seguem via `UnderstandingBrain` — o
fallback multi-cap autoriza busca/detalhe/foto/seleção do lead; F2.15/17/20 intactos).
### Smoke real 4 turnos (`smoke:kicks`, gpt-4.1-mini, compose=0, US$0,049, 17 chamadas) — **PASS, 0 violações**
Estoque real TEM Kicks. T1 "Tem Kicks?" -> stock_search lista 2 Nissan Kicks. **T2 "fotos do Onix" -> apresenta os 2 Onix
e pergunta qual, NUNCA um Kicks** (memória do Kicks não sequestra; P0-1 do assunto). T3 "fotos do segundo Kicks" ->
"de qual carro?" (pergunta), sem mídia, NUNCA Onix. **T4 "Oi" -> saudação, ZERO tool comercial** (P0-2 typed gate).
Critérios PASS: nunca Onix p/ assunto Kicks; nenhuma tool no 'Oi'; 0 fallback genérico (deterministic_recovery); compose=0.
⚠️ T2/T3 degradaram para `deterministic_recovery` (pergunta qual — T2 legítimo: 2 Onix ambíguos; T3 o cérebro OMITIU o
understanding -> photos_resolve barrado pelo typed gate -> recuperação segura). Nunca enviou carro errado; degradação
CONTEXTUAL (não genérica). Limitação = aderência do LLM em sempre emitir understanding (reforço de prompt, não do engine).

**NÃO commitado. Parar para auditoria Codex.**

## 8) AUDITORIA CODEX F2.23 — identidade EXATA de modelo (4ª rodada, 2026-07-05, determinística/offline)

### Achado P0
`modelMatch` do turn-understanding usava `a.includes(b) || b.includes(a)` -> conflacionava modelos DISTINTOS:
Onix⊂Onix Plus, HB20⊂HB20S, C3⊂C3 Aircross. Risco: pede foto do Onix, só há Onix Plus nos fatos -> podia aceitar Onix
Plus como candidato e autorizar a foto do carro errado. Contradizia o invariante do policy-engine (igualdade após
normalização de FORMATAÇÃO, nunca subconjunto).

### Correção (determinística)
- **Fonte ÚNICA** `catalog-utils.canonicalModel(m)` = `normalizeText(m).replace(/[\s-]+/g,"")` (só caixa/acento/espaço/
  hífen/pontuação; PRESERVA Plus/S/Aircross/Sedan/Cross/Sport). `modelIdentityMatches(subjectRaw, {marca,modelo})` =
  igualdade EXATA contra `modelo` E `marca modelo`; sem `modelo` estruturado -> nunca casa. **policy-engine agora IMPORTA
  o mesmo `canonicalModel`** (removida a duplicata) — uma só identidade de modelo p/ grounding E TurnUnderstanding.
- `resolveTurnTarget`: removido `modelMatch`(includes). Candidatos por `modelIdentityMatches` (estrito). Conflito
  subjectValue×claim escrito por `modelsAgreeUpToBrand` (mesma identidade OU só difere pelo PREFIXO de marca —
  "chevroletonix"~"onix"; NUNCA sufixo semântico "onix"≠"onixplus"), separado da autorização (que é estrita).
- **`buildKnownModels` ESTRUTURADO** `{marca,modelo}` só de VehicleFact (stock_search/vehicle_details)/oferta/identidade.
  **NUNCA `selected.label`** (texto livre). Sem modelo estruturado confiável -> não autoriza por modelo explícito
  (o pronome/carryover usa `selected.key` diretamente, não knownModels).

### Testes (F2.23 = **34 OK**, +9 de identidade)
IdA Onix pedido/só Onix Plus->0 mídia · IdB inverso · IdC1/C2 HB20↔HB20S 0 mídia · IdD1/D2 C3↔C3 Aircross 0 mídia ·
IdE "HB 20"=="HB20" (formatação)->mídia · IdF1 "Chevrolet Onix" casa {Chevrolet,Onix}->mídia · IdF2 não casa Onix Plus->0.
Regressões G intactas (ordinal/typo/carro-errado/typed-auth = casos C/AA/J/Z/W/X/Y). test:all EXIT 0, tsc EXIT 0,
`git diff --check` limpo. **Sem OpenAI (correção determinística, provada offline).**

### Arquivos (4ª rodada): `catalog-utils.ts`, `turn-understanding.ts`, `central-engine.ts`, `policy-engine.ts`, `run-f2-23-*`.
**NÃO commitado. Parar para auditoria Codex.**
