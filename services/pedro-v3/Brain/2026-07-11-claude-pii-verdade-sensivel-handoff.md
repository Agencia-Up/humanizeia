# MISSÃO PII — Verdade semântica de dados sensíveis + transferência humana imediata (ENTREGA)

**Data:** 2026-07-11 · **Autor:** Claude (executor) · **Status:** ⛔ PARADO para auditoria Codex.
**Nada commitado/pushado/deployado; flags e env inalterados; zero SQL de escrita; zero notificação real (Regia NUNCA foi contactada).**
Incidente: conversa `wa:8ed13714…a741e41`, poll-9..12, 2026-07-11 14:31–14:42 UTC. PII SEMPRE mascarada (runs de dígitos → `XX**`).

---

## 1. Causa-raiz de CADA incidente (com prova no banco)

### 1a. Mensagens com CPF SUMIRAM (nunca chegaram à v3_inbox) — classificação: (c) ingest rejeitou
- **Prova determinística:** `v3_inbox_redacted_ck CHECK (v3_payload_is_redacted(raw))` + execução da função com valor SINTÉTICO:
  `v3_payload_is_redacted('{"__redacted":true,"text":"11144477735"}') = FALSE` (rejeitado); CPF formatado = FALSE;
  `"01/10/1997"` = TRUE (passa); fone 13 dígitos = TRUE; `"até 1200"` = TRUE. A regex do CHECK rejeita QUALQUER run
  de 11 dígitos em formato CPF (`\y[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}\y`).
- **Cadeia:** lead envia CPF → webhook bridgeia → `/v1/pilot/turn` → `ingestPilotMessage` INSERT falha na constraint →
  `run()` catch → `PILOT_TURN_FAILED` (ingested=false) → bridge classifica `pre_ingest_failure` → **sticky routing
  (conversa tem v3_conversation_routing) BLOQUEIA o fallback v2** → mensagem some sem resposta e sem rastro.
- **Confirmações:** v3_inbox tem 14 eventos da conversa; as 2 mensagens com CPF (11:37 "074…" e 11:38 "CPF … data …")
  NÃO existem; a data sozinha (11:37) existe (poll-10). `pedro_v2_turn_logs` VAZIO na janela (v2 nunca respondeu =
  zero double-owner, sticky funcionou como projetado). Não foi a LLM; não foi o uazapi (qualquer entrega teria o
  MESMO destino determinístico); não foi dedupe (ids distintos = hashes distintos, provado em teste).

### 1b. `01/10/1997` → `parcelaDesejada=1997` — cadeia mecânica completa
- decision_final poll-10 (real): `pendingQuestionSlot:"parcelaDesejada"` + `financialAnswerTurn:true` + feedback
  "O cliente acabou de informar a PARCELA…".
- **Elo 1:** a resposta do agente em poll-9 ("…parcela até 1200. Preciso do seu CPF e data de nascimento…") não tinha
  "?" → `questionSlotFromAgentText` caía no fallback legado sobre o texto INTEIRO → `/\bparcela\b/` casava →
  pendente STALE = `parcelaDesejada` (não existia mapeamento de CPF/nascimento).
- **Elo 2:** pendente financeiro → `financialContext=true` → `moneySpans` libera número em range de ANO como VALOR →
  "1997" da data virou dinheiro → `answeringParcela` → `parcelaDesejada=1997` (state confirmado: `{value:1997,
  sourceTurnId: poll-10}`).
- **Efeito no CRM:** coluna `desired_installment="R$ 1.200"` PRESERVADA pelo fill-only; `summary` ([Pedro v3],
  sobrescrevível por autoria) passou a narrar "R$ 1.997/mês" (outbox poll-10 crm_write levou 1.997).

### 1c. `handoff.plannable=false` + "só transfiro com CPF"
- decision_final poll-11/12 (real): `handoff:{plannable:false, planned:false, stripped:null}` — `stripped:null`
  prova que o cérebro NEM propôs o effect; o deny antigo ("reescreva SEM citar transferência") coagiu a LLM, que em
  poll-12 (brainRetries=2, + deny de anti-repetição) produziu a mentira "só consigo te passar… depois do CPF".
- **Por que false:** `plannable = enabled && available && crmWriteEnabled && leadId`. crmWrite=true e leadBound
  presentes no MESMO evento ⇒ falhou `enabled` (env não-efetiva no processo em execução às 14:41 — valor/caixa
  ("Active"≠"active"?)/timing do deploy) OU `available=false` por exceção ENGOLIDA no precheck
  (`catch { handoffAvailable = false }` — config/roster). **Com a observabilidade antiga é IMPOSSÍVEL distinguir —
  essa é a falha estrutural (P0-C), agora corrigida:** o precheck devolve `unavailableReason` tipado + `stepError`
  sanitizado por etapa, logado e gravado no decision_final. Reprodução offline com o SHAPE REAL de produção
  (roster do agente vazio; Regia tenant-wide `agent_id=null`, fone 11 dígitos): **plannable=true** ([C1] F2.50) —
  o CÓDIGO do precheck não tem bug com esses fatos; o próximo turno real dirá o gate exato via `unavailableReason`.
- `/health`: expõe `{configuredBrainMode, crmWrite, handoff, followup}` (server.ts:399-404), mas a URL do serviço
  não está em nenhum doc/env acessível daqui — **verificação pendente para o dono**: `curl <URL-do-agent-pedrov3>/health`
  responde as 4 flags do PROCESSO em execução (sem segredo). Logs do Easypanel: sem acesso desta máquina (declarado).
- Versão executada: deployed = `a72877c1` (HEAD; working tree só tinha untracked antes desta missão; o campo
  `handoff` no decision_final só existe nesse commit ⇒ produção o roda). Edge deployada = v434 (código baixado e
  auditado: guard de vendedor presente; ZERO branch por conteúdo de texto no caminho do bridge).

## 2. O que foi implementado (por invariante, nunca frase do incidente)

**P0-A `src/domain/sensitive-data.ts` (NOVO, puro):** classificação por FORMATO+MATEMÁTICA — `isValidCpfDigits`
(dígitos verificadores), datas DD/MM/AAAA com plausibilidade de nascimento (1900..anoRef-14; ano recente = visita,
intocado), `extractSensitiveSpans` → tokens tipados (`[CPF_VALIDO_FINAL_xy]`, `[NUMERO_11_DIGITOS_INVALIDO_COMO_CPF_FINAL_xy]`,
`[DATA_NASCIMENTO_VALIDA]`, `[DATA_INVALIDA]`), `reserveSensitiveNumericSpans` (precedência lexical: sensível/data >
km/ano > dinheiro). **Ingest (`pilot-ingest.ts`):** sanitiza no chokepoint ANTES do INSERT → a mensagem passa no CHECK
por construção e NUNCA mais some; findings tipados (kind/valid/final-2) viajam no raw SEM o valor.
**Parser (`lead-extraction.ts`):** `moneySpans` roda sobre texto com spans sensíveis RESERVADOS (data/11-dígitos nunca
viram dinheiro, mesmo em financialContext — defesa em profundidade); `questionSlotFromAgentText` mapeia pergunta de
CPF/nascimento → slot `cpf` (mata o pendente stale); token CPF válido → `set_slot_ref cpf` (SensitiveValueRef
`{ref:"v3:cpf:informado:final-xy", kind:"cpf", last4:"xy"}`); token inválido → NENHUM slot (a LLM pede correção).

**PRIVACIDADE (desenho):** o VALOR integral de CPF/nascimento **não é retido em lugar nenhum** (inbox/state/WM/eventos/
outbox/log — só tipo+validade+2 dígitos finais). Não existe cofre seguro no v3; o v2 grava `ai_crm_leads.cpf`/`birth_date`
em PLAINTEXT (auditado — NÃO é seguro e NÃO foi copiado). Adotada a opção da missão "impedir a coleta até existir":
o agente confirma o recebimento ("CPF final xy anotado"), o briefing marca informado/não-informado, e o vendedor coleta
o valor no atendimento. Cofre (Vault + ref) fica como follow-up autorizado.

**P0-B request_human:** `PRIMARY_INTENTS += "request_human"`, `TURN_CAPABILITIES += "handoff"` (evidence obrigatória
no bloco — validação mecânica existente); `requestsHuman()` em turn-understanding (autoridade = cérebro validado;
fallback NUNCA autoriza); protocolo do adapter ensina o intent + tokens + "pedido de humano VENCE o funil, NUNCA
condicione a CPF"; HANDOFF_PROTOCOL reforça o effect no MESMO final e transparência quando indisponível.
**Invariantes 9/10:** o deny de indisponibilidade foi REESCRITO — agora exige TRANSPARÊNCIA (reconhecer o pedido,
dizer que não consegue transferir AGORA, oferecer alternativa) e PROÍBE explicitamente condicionar a CPF/fingir
transferência/voltar ao funil. O deny de promessa-sem-effect (plannable) pede para INCLUIR o effect.

**P0-C `src/engine/handoff-precheck.ts` (NOVO, testável):** `evaluateHandoffPrecheck` → {flagEnabled, crmEnabled,
leadBound, configLoaded, portalTransferEnabled, scopedSellerCount, tenantFallbackSellerCount, validPhoneSellerCount,
available, unavailableReason (10 valores tipados), stepError sanitizado}. Catch silencioso ABOLIDO. Logado
(`pedro_v3_handoff_precheck`) e gravado INTEIRO no decision_final (`handoff.precheck`). Root delega.

**P0-D:** 6 testes novos no `test:bridge-inc1` (payloads uazapi realistas): 11 dígitos e data atravessam o bridge
ÍNTEGROS; ids distintos → eventIds distintos; mesmo id → dedupe; messages_update = receipt; bridge não loga conteúdo.

## 3. Gates (todos verdes)
| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | EXIT 0 |
| `npm run test:f250` | **43 OK / 0** (S1-10 classificação, E1-12 replay do incidente + precedência, I1-6 ingest, H1-4 request_human, C1-11 precheck) |
| `npm run test:bridge-inc1` | **30 OK** (24 + 6 PII) |
| `npm run test:all` | **EXIT 0** (F2.50 incluída; 1 contrato atualizado: F2.48 [C2-H1] acompanha o texto novo do deny — comportamento protegido idêntico; F2.48 = 64 OK) |
| `git diff --check` | limpo |
| Smokes reais | **2× PASS consecutivos** (abaixo) |

## 4. Smokes reais (gpt-4.1-mini, prompt/estoque reais, efeitos OFF, vendedor FAKE)
Roteiro 9 turnos (popular 80k → segundo → Palio 2012 70k km → sem entrada → parcela 1200 → Douglas → CPF sintético
111.444.777-35 → 01/10/1990 → "Quero falar com um atendente"). Relatórios integrais por turno (lead/resposta/source/
intent/tools/effects/slotsDelta/policyFeedback/briefing, dígitos mascarados):
`eval/reports/pii-smoke-2026-07-11T16-19-34-000Z.md` e `…T16-21-30-548Z.md` (não versionados).
**Ambos PASS:** `parcelaDesejada=1200` intacta do T5 ao fim; `cpf` vira ref opaca `final-35` (valor ausente de TUDO);
nascimento confirmado sem retenção; **0 tool comercial em T7-T9; 0 technical_fallback; 0 recovery; compose=0; todas
as respostas brain_final/brain_retry; NENHUMA recusa por falta de CPF**. T9: 1ª tentativa prometeu sem effect → deny
novo pediu o effect → retry propôs `{kind:"handoff", reason:"explicit_human_request"}` → cadeia
send_message→crm→handoff→notify planejada; briefing correto (interesse Peugeot 208 ≠ troca Palio; pagamento factual;
motivo "Lead pediu atendimento humano"; wa.me mascarado).

## 5. Estado final de slots/CRM (smoke) e produção
Smoke: slots finais = faixaPreco 80k, troca Palio 2012 70k km, entrada 0, financiamento, parcela 1200, nome Douglas,
cpf ref final-35. **Produção (limpeza manual antes do aceite, dono/Codex):** `v3_conversation_state` da conversa do
incidente segue com `parcelaDesejada=1997` gravado em poll-10 e o `summary` do lead `b21bdd42…` narra "R$ 1.997/mês"
(a coluna `desired_installment` está correta em R$ 1.200) — o fix impede NOVAS corrupções; a linha antiga precisa de
correção manual (ou nova conversa de aceite em estado limpo).

## 6. Arquivos alterados (esta missão)
NOVOS: `src/domain/sensitive-data.ts`, `src/engine/handoff-precheck.ts`, `tests/run-f2-50-sensitive-truth-handoff.ts`,
`eval/run-pii-smoke.ts`. MODIFICADOS: `src/engine/pilot-ingest.ts` (sanitização no chokepoint),
`src/engine/lead-extraction.ts` (spans reservados + mapa cpf + token→ref), `src/domain/agent-brain.ts` (request_human
+ capability handoff), `src/engine/turn-understanding.ts` (requestsHuman), `src/adapters/llm/openai-agent-brain.ts`
(protocolo: request_human/tokens/transparência), `src/engine/central-engine.ts` (denies honestos + precheck no
decision_final), `src/engine/pilot-active-root.ts` (precheck estruturado + log), `eval/central-real-harness.ts`
(sanitização de produção no ingest do smoke + opts handoff/crmLeadId), `eval/central-assertions.ts` (briefing/reason
no capture), `tests/run-f2-48…` (contrato do deny), `package.json` (test:f250/smoke:pii),
`supabase/functions/_shared/pedro-v2/pedroV3Bridge.offline-test.ts` (6 casos PII — só TESTE; zero mudança de runtime edge).

## 7. Riscos restantes / fora de escopo (honesto)
1. **Plannable=false em produção**: código provado correto com os fatos reais; o discriminador final (env vs exceção)
   sai no PRIMEIRO turno pós-deploy via `handoff.precheck.unavailableReason` + `/health` (comando p/ o dono).
2. Cofre seguro para CPF/nascimento não existe — valor intencionalmente descartado (design documentado); habilitar
   coleta persistida exige Vault+SQL autorizados.
3. Datas com ano de 2 dígitos ("01/10/97") não são classificadas como nascimento (ambíguas) — passam cruas; o parser
   de dinheiro já as reserva (nunca viram parcela), mas ficam legíveis no inbox.
4. Estado/summary ANTIGOS corrompidos (item 5) precisam de limpeza manual.
5. `prompt-bound-conversation` (caminho legado/DecisionLlm) não ensina os tokens — o piloto usa singleAuthor (adapter
   central); legado intocado por design.

## 8. Prova de que nenhum handler/recovery comercial foi criado
Nenhum `buildDeterministic*`/recovery novo; nenhuma resposta autorada pelo engine. As mudanças são: sanitização de
INGEST (dado, não conversa), precedência de PARSER (extração factual), mapeamento de pergunta→slot (taxonomia),
enum de understanding + protocolo (a LLM decide), denies com feedback (a MESMA LLM reescreve) e observabilidade.
Smokes: `compose=0`, todas as respostas `brain_final|brain_retry`, `commercialRecovery=0`.

**PARADO. Aguardando auditoria do Codex. Sem commit/push/deploy/SQL/flag/notificação real.**

## Auditoria Codex - cofre real e autoridade do pedido humano

A primeira entrega foi reprovada porque descartava CPF/nascimento enquanto a
fala dizia que o dado estava anotado. A auditoria substituiu esse contrato por:

- `SupabaseSensitiveVault` com AES-256-GCM e chave separada do service role;
- valor cru somente em memoria entre HTTP e cofre;
- inbox/state/eventos/outbox com referencias opacas, nunca plaintext;
- `cpf` e `birthDate` como `SensitiveValueRef` no estado;
- abertura das refs somente no `notify_seller` direto ao vendedor;
- gerente recebe briefing sem CPF/data;
- sem cofre ou falha de gravacao, o token informa `NAO_ARMAZENADO` e a LLM e
  proibida de confirmar falsamente;
- pedido humano validado pela propria `TurnUnderstanding` vence o funil, bloqueia
  tools comerciais e exige `handoff` real quando o precheck permite;
- resposta sensivel precisa reconhecer o dado recebido; o engine apenas nega e
  devolve feedback, nunca escreve a resposta comercial.

Hardening adicional encontrado no smoke real:

- final4 de tokens sensiveis nao pode virar parcela;
- nome isolado nao pode contaminar `interesse`;
- `set_slot_ref` conta como avanco do lead e como autoridade da extracao;
- compatibilidade com states antigos sem `birthDate`.

Provas finais em 2026-07-11:

- `test:f248`: 65 OK;
- `test:f249`: 41 OK, incluindo PII somente no vendedor;
- `test:f250`: 61 OK;
- `tsc --noEmit`: EXIT 0;
- `test:all`: EXIT 0;
- `test:bridge-inc1`: 30 OK;
- smoke real `gpt-4.1-mini`: PASS em
  `eval/reports/pii-smoke-2026-07-11T18-49-55-904Z.md`;
- tabela `public.v3_sensitive_vault` confirmada no Supabase de producao via
  consulta read-only (HTTP 200).

Antes do deploy, configurar no `agent-pedrov3`:

- `PEDRO_V3_SENSITIVE_VAULT_KEY`: 32 bytes em hex (64 caracteres) ou base64;
- `PEDRO_V3_SENSITIVE_VAULT_KEY_VERSION=v1`.

Sem a chave, a mensagem continua sendo respondida e nunca some, mas CPF/data nao
sao considerados armazenados e nao seguem para o vendedor.
