# MANUAL DE OPERAÇÃO — AGENTE PEDRO v2 (SDR de carros)

> **LEIA ISTO INTEIRO ANTES DE TOCAR EM QUALQUER ARQUIVO DO AGENTE.**
> Este documento é a fonte de verdade de COMO mexer no agente sem quebrar produção.
> Foi escrito pelo assistente que construiu/endureceu o Pedro v2 (builds v104→v190+).
> Se algo aqui divergir do código, o CÓDIGO vence — mas então **atualize este arquivo**.
> Mantenha-o vivo: toda mudança relevante ganha uma linha no `CHANGELOG` no fim.

---

## 0. FILOSOFIA (a regra que rege TUDO)

O dono tem uma frase-lei: **"Quero soluções, não remendos."**

Traduzindo em regras de engenharia que você É OBRIGADO a seguir:

1. **Conserte a INTELIGÊNCIA do agente de forma GERAL, não caso a caso.** Nunca crie um `if` para uma frase específica ("se o lead disser X, responda Y"). Em vez disso, descubra o INVARIANTE quebrado e corrija a regra que vale para todos os casos. Ex.: o bug "agente diz que não temos moto, tendo moto" NÃO se resolve com `if (texto=='moto')` — resolve-se entendendo que "moto" é uma palavra de TIPO (igual "suv") e tratando-a como tal no motor.
2. **Determinístico > prompt.** Quando uma regra JÁ está no prompt e o LLM ignora (o modelo é barato — ver §3), a solução é um **backstop em CÓDIGO**, não mais texto no prompt. O prompt induz; o código garante.
3. **Prove offline antes de deployar.** Toda correção de lógica vira um teste em `scripts/regression/offline.ts` ($0, sem rede). Se não dá pra testar offline, prove por replay do payload REAL + leitura dos logs.
4. **Nunca confie em dry-run simplificado para validar bug real.** Dry-run com mensagem injetada à mão NÃO reproduz casos de anúncio/áudio/burst. Para esses, faça **replay do payload real** (ver §7) e leia `pedro_v2_turn_logs`.
5. **Multi-tenant.** O agente serve VÁRIOS clientes (Icom Motors, Avant Motors, ...). NUNCA hardcode nome/empresa/estoque de um cliente. Tudo vem da config (`wa_ai_agents`, `agent_funnel_config`, `platform_integrations`).
6. **Honestidade radical no agente.** O agente só afirma o que está no prompt do cliente OU no estoque (`stock.facts`). Dúvida sem resposta → NÃO inventa, NÃO nega → "vou confirmar com a equipe" + manda no briefing. Preço/spec/garantia/laudo são áreas de alucinação — há camadas inteiras de proteção (ver §5).

Se você se pegar escrevendo um `if` por frase, PARE. Está errado.

---

## 1. O QUE É O PEDRO v2

Agente de WhatsApp que faz **SDR de venda de carros** (semi-novos): aborda o lead, qualifica, mostra estoque ao vivo, manda fotos, e transfere para um vendedor humano. NUNCA fecha a venda. Roda como **Edge Function do Supabase (Deno/TypeScript)**.

- **Projeto Supabase (PROD):** `seyljsqmhlopkcauhlor` (conta "Logosiabrasil"). API: `https://seyljsqmhlopkcauhlor.supabase.co`.
- **Repositório (raiz que importa):** `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia`
  ⚠️ NÃO é o diretório `SOCIALE SHARE HUB` (esse é outro projeto). Sempre opere dentro de `humanizeia`.
- **Canal:** WhatsApp via **uazapi** (servidor `https://logosiabrasilcom.uazapi.com`). O uazapi faz POST dos eventos no webhook.
- **Clientes (agentes) conhecidos:**
  - **Icom Motors** — agente "Carvalho", `agent_id=aee7e916-31b1-431c-ba6f-f38178fd4899`, `user_id=f49fd48a-4386-4009-95f3-26a5100b84f7`. Estoque: **BNDV** (GraphQL ao vivo).
  - **Avant Motors** — agente "Sara", `agent_id=03421f26-f4e3-48f1-a791-24fc438e9b3d`, `user_id=7e23b020-0377-4120-a6a4-502701d62208`. Estoque: **RevendaMais** (feed JSON).

---

## 2. AMBIENTE, ACESSO E LIMITES (decore isto)

### Modelos de IA (NÃO confunda)
- **Planner** (decide a ação: buscar/responder/foto/transferir, em JSON estruturado): `openai/gpt-4o-mini`.
- **Reply** (escreve a mensagem ao lead): `openai/gpt-4.1-mini`. **`gpt-4.1-mini` ≠ `gpt-4o-mini` — são modelos DIFERENTES.** Não troque um pelo outro achando que é sinônimo.
- **Failover provado:** DeepSeek (usado quando a OpenAI fica sem crédito; reverte quando recarrega).
- Há gancho de `reply_model_override` por turno (existe, não usado em prod por padrão).
- Temperatura ≤ 0.35.

### MCP do Supabase = **SOMENTE LEITURA**
- `execute_sql` roda em transação **read-only**: SELECT funciona; **INSERT/UPDATE/DELETE/DDL/`cron.schedule` FALHAM** ("cannot execute ... in a read-only transaction").
- `apply_migration` falha.
- **Não há senha do banco salva.** Só `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` em `supabase/.env.local` (management API, usada pelos wrappers de deploy).
- **Consequência:** qualquer escrita no banco (ligar integração, mudar flag, agendar cron, aplicar migração) é feita pelo **DONO** rodando SQL no editor do Supabase, OU por um script com a **service-role key** (se disponível no ambiente). Você ENTREGA o SQL pronto; não execute escrita via MCP.
- Migrações ficam em `supabase/migrations/` mas o histórico está **dessincronizado** com prod — **NUNCA rode `supabase db push`** (aplicaria ~15 migrações locais não-sincronizadas). Migração nova = arquivo + o dono aplica manualmente no SQL editor.

### Chaves úteis (não são segredo-segredo; anon é semi-pública)
- **anon key** (para chamar edge functions em teste): obtenha via MCP `get_publishable_keys` (tipo "anon"). Header: `Authorization: Bearer <anon>`.
- **Token da instância uazapi:** está em `wa_instances.api_key_encrypted` (apesar do nome, é o token uazapi em texto). Header uazapi: `token: <token>`.

---

## 3. ARQUITETURA E FLUXO DE DADOS

```
uazapi (POST do evento)
   │
   ▼
supabase/functions/pedro-webhook-v2/index.ts        ← ENTRADA (o webhook)
   │  early-returns: presence | connection | REAÇÃO(👍) | fromMe(não-vendedor) | instância inativa | agente inativo
   │  responde 200 RÁPIDO + processa em EdgeRuntime.waitUntil (anti-timeout do caller)
   ▼
_shared/pedro-v2/orchestrator_20260525_photo_flow.ts ← O CÉREBRO (onde 90% das mudanças acontecem)
   │  1. resolve identidade/remote_jid/texto (pickText/pickRemoteJid)
   │  2. salva msg do lead em wa_chat_history (captura myUserMsgId)  [pulado se recovery:true — ver §10]
   │  3. DEBOUNCE presence-aware (até 45s): agrupa rajada, espera o lead parar de digitar
   │  4. resolve ad_context (anúncio) + media_context (áudio/imagem)
   │  5. PLANNER (pedroBrainPlanner) → ação + filtros
   │  6. BUSCA de estoque (stockSearch) se necessário
   │  7. REPLY (pedroBrainReply) → texto + qualificação coletada
   │  8. BLOCO DE VERIFICAÇÃO PRÉ-ENVIO (a fila de guards determinísticos — ver §5) ← O CORAÇÃO DA COMPLEXIDADE
   │  9. decisão de TRANSFERÊNCIA (brainReadyToTransfer / silentTransfer / enforcements)
   │  10. ENVIO via uazapi (sendPedroText; humanize opcional) + grava turno em pedro_v2_turn_logs
   ▼
Lead recebe a resposta
```

### ARQUIVOS ATIVOS vs MORTOS (⚠️ARMADILHA Nº1)
A pasta `_shared/pedro-v2/` tem MUITOS arquivos versionados por data (`_20260524`, `_20260525_sales`, `_photo_variety`, vários `replyGenerator*`, `orchestrator.ts`, `stockSearch.ts`...). **A MAIORIA ESTÁ MORTA (não é importada).** Editar um arquivo morto = você "corrige" e nada muda em prod.

**Como saber o que está VIVO:** abra `supabase/functions/pedro-webhook-v2/index.ts` e veja o que ele importa, e siga a cadeia de imports. Hoje os VIVOS são:

| Papel | Arquivo VIVO |
|---|---|
| Webhook (entrada) | `pedro-webhook-v2/index.ts` |
| Orquestrador (cérebro) | `_shared/pedro-v2/orchestrator_20260525_photo_flow.ts` |
| Planner | `_shared/pedro-v2/pedroBrainPlanner_20260525.ts` |
| Reply (escreve a msg) | `_shared/pedro-v2/pedroBrainReply_20260525.ts` |
| Estoque (busca/rank/score) | `_shared/pedro-v2/stockSearch_20260525_photo_flow.ts` |
| Anúncio (CTWA) | `_shared/pedro-v2/adContext_20260525.ts` |
| Mídia (áudio/imagem) | `_shared/pedro-v2/mediaContext_20260524.ts` |
| Verificação pré-envio (puro) | `_shared/pedro-v2/preSendVerify.ts` |
| Lógica de decisão (puro) | `_shared/pedro-v2/decisionLogic.ts` |
| Grounding anti-alucinação (puro) | `_shared/pedro-v2/grounding.ts` |
| Lógica de foto (puro) | `_shared/pedro-v2/photoLogic.ts` |
| Base de conhecimento (RAG) | `_shared/pedro-v2/knowledgeBase.ts` |
| Estoque RevendaMais (adaptador) | `_shared/pedro-v2/revendaMaisStock.ts` |
| Roteador de transferência | `_shared/pedro-v2/transferRouter.ts` |
| Recuperador anti-drop (cron) | `pedro-recover-dropped/index.ts` |
| Perfil de prompt do LLM | `_shared/pedro-v2/llmProfiles/openai.ts` |

Na dúvida: **grep o nome da função e veja quem importa.** Não confie no nome do arquivo.

### Arquivos do SÓCIO (não commitar junto)
`webhookRouting.ts`, `meta-webhook/index.ts`, `wa-inbox-webhook/index.ts` são WIP do sócio. **Sempre stash esses 3 antes de pull/push** (ver §9). Não os edite.

---

## 4. O BUILD CONSTANT (seu carimbo de versão — SEMPRE bumpe)

Em `pedro-webhook-v2/index.ts`:
```ts
const PEDRO_V2_BUILD = "2026-06-25-recover-dropped-v190";  // <-- BUMPE A CADA DEPLOY
```
- Formato: `AAAA-MM-DD-descricao-curta-vNNN`. Incremente o `vNNN` e mude a descrição.
- Esse string aparece em **TODO turno** (`pedro_v2_turn_logs`) e em **toda resposta de dry-run**. É como você confirma QUAL versão está no ar e SE o seu deploy pegou.
- **Regra:** mudou código que vai pro ar → bumpe o build → deploy. Sem isso você não sabe se está testando a versão nova.

---

## 5. A FILA DE VERIFICAÇÃO PRÉ-ENVIO (o coração da complexidade)

Depois que o `pedroBrainReply` gera o texto, o orquestrador roda uma SEQUÊNCIA de guards determinísticos (a "Chain-of-Verification" / camada `preSendVerify.ts` + lógica inline). **A ORDEM IMPORTA** porque cada guard pode reescrever `reply.text`. Em `orchestrator_20260525_photo_flow.ts`, dentro de um `try { ... } catch (_vErr)` (best-effort: nunca derruba o turno), na ordem aproximada:

1. **neutralizeAiIdentityLeak** — se vazar "sou uma IA/bot/modelo" → deflexão de persona ("Sou o {agente}, consultor").
2. **ad_generic_abordagem** — anúncio genérico/anúncio-não-identificado + lead VAGO no 1º contato → troca lista/defer por ABORDAGEM (apresenta + pergunta o que procura). ⚠️Excluído dos blocos de relist (senão volta a lista).
3. **search_deferral_resolved** — "vou buscar... um momento" e some → apresenta o resultado real AGORA.
4. **wrong_price_relisted (R6)** — preço citado que não bate com o estoque → relista com preços reais (anti-deflação de preço).
5. **photo_offer_without_photos** — ofereceu foto mas nenhum veículo do turno tem foto → troca por CTA de detalhes/visita.
6. **verifyReplyText** (promise_undelivered_media, promise_async_followup, denies_without_search, offers_rejected) — loga violações + corrige a foto-prometida-sem-mídia.
7. **category_relisted_deterministic** — lead pediu TIPO (suv/sedan...) + há ≥2 e o reply não citou veículo → relista determinístico. ⚠️**Exclui sources que NÃO devem virar lista** (`ad_generic_abordagem`, `vehicle_photos_*`, `presend_fixed_*`). Se você criar um reply determinístico que NÃO cita veículo, ADICIONE o source nessa exclusão (senão o `!replyMentionsAnyVehicle` re-dispara a lista por cima — bug clássico v189).
8. **qualify_vague** — planner marcou `precisa_qualificar` → garante pergunta de qualificação.
9. **apresentação no 1º contato (v178)** — sem turno anterior do agente + sem auto-apresentação → insere "Aqui é o {nome}, consultor da {empresa}" (após a saudação, ou prepõe). Estilo HÍBRIDO (apresenta + carro + 1 pergunta).
10. **funil-force (v180/v184)** — lê `agent_funnel_config.bloco4` e, em lead engajado em turno não-inicial, se NÃO há nenhuma "?" na resposta, acrescenta a próxima pergunta obrigatória do funil. (Suavizado: só quando a resposta não tem pergunta — 1 pergunta por mensagem.)

Depois, fora do bloco de verificação, vem a decisão de TRANSFERÊNCIA com vários enforcements (finance/trade/visita/silenciosa) + a salvaguarda do **lone-emoji** (emoji solto NUNCA transfere) e o **trade_collecting** (não transfere no meio da coleta da troca). Veja os comentários no código — cada um tem um caso real documentado.

**LIÇÃO-MÃE:** ao adicionar um novo reply determinístico, pergunte-se: "esse texto cita veículo? se não, ele pode ser sobrescrito pelos blocos de relist?" Se sim, exclua o source dos relists.

---

## 6. COMO FAZER UMA MUDANÇA (o fluxo, passo a passo)

> Este é o ciclo que eu sigo SEMPRE. Não pule etapas.

1. **DIAGNOSTICAR com dados reais.** Nunca chute a causa. Pegue o `remote_jid` do lead do print e cruze `wa_chat_history` (o que chegou) com `pedro_v2_turn_logs` (o que foi processado: `reply_source`, `reason`, `payload->>'text'`). Para bug de estoque, dumpe `stock_result.filters_used`. (Ver §10.)
2. **LOCALIZAR o invariante.** Em qual camada vive? Planner (decisão errada)? Reply (texto errado)? Stock (busca/score)? preSendVerify (guard)? Decida a CAMADA, não o sintoma.
3. **ESCREVER a correção GERAL** (determinística, sem `if` por frase). Prefira função PURA em `decisionLogic.ts`/`preSendVerify.ts`/`grounding.ts` (testável offline) + wiring no orquestrador.
4. **TESTE OFFLINE** (`npx tsx scripts/regression/offline.ts`). Adicione 1+ asserção que trava o bug. **Tem que ficar verde (256/256 ou o número atual).**
5. **BUMPE o build** (§4) + **DEPLOY** (§8).
6. **VALIDE** com dry-run (§7) — de preferência replay do payload real se for anúncio/áudio.
7. **COMMIT + PUSH** com a "dança do stash" (§9), mensagem de commit DETALHADA (caso real + raiz + fix).
8. **REGISTRE a lição** no CHANGELOG deste arquivo + (se você mantém memória) no seu brain.

---

## 7. COMO TESTAR (4 níveis, do mais barato ao mais caro)

### Nível 1 — Offline (sempre, $0, sem rede)
```bash
npx tsx scripts/regression/offline.ts          # tudo
npx tsx scripts/regression/offline.ts moto     # só um grupo
```
Importa as funções PURAS direto e roda asserções. **OBRIGATÓRIO antes de qualquer deploy.** Toda correção de lógica ganha um teste aqui. Sai com código ≠0 se falhar.

### Nível 2 — Dry-run simulado (1 turno, custa LLM baratinho)
```bash
node scripts/dryrun-sim.mjs "<mensagem do lead>" "<chatid@s.whatsapp.net>" "<greeting CTWA opcional>"
```
Bate no webhook DEPLOYADO com `dry_run` (roda planner+reply de verdade, NÃO envia). Use um chatid NOVO (`551290000XXXX@s.whatsapp.net`) para simular 1º contato, ou um chatid REAL (lê o histórico dele) para 2º turno. ⚠️Lê o estado real do lead — se estiver transferido/pausado, o dry-run reflete isso.

### Nível 3 — POST direto no webhook (testar instância/agente específico, ex.: Avant)
Use para validar um agente que NÃO é o default do dryrun-sim. Pega a anon key (MCP `get_publishable_keys`) e:
```bash
curl -s "https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-webhook-v2" \
  -H "Authorization: Bearer <ANON>" -H "Content-Type: application/json" \
  -d '{"instanceName":"avant","dry_run":true,"messages":[{"text":"tem algum suv ate 80 mil?","chatid":"5512900000002@s.whatsapp.net","from":"5512900000002@s.whatsapp.net","key":{"remoteJid":"5512900000002@s.whatsapp.net","fromMe":false},"fromMe":false,"senderName":"Teste"}]}'
```
O `instanceName` resolve a instância → o agente daquele cliente → o estoque daquele cliente. O retorno tem `intent`, `brain_plan`, `stock_result` e `reply`. **Não envia nada** (dry_run). Foi assim que validei a Avant ponta-a-ponta.

### Nível 4 — Replay de payload REAL / golden / health
- `scripts/replay-ctwa.mjs` + `scripts/test-ctwa-burst-recovery.mjs` — replay de payloads de ANÚNCIO reais (a ÚNICA forma confiável de validar fixes de anúncio; injeção simplificada NÃO reproduz).
- `node scripts/regression/suite.mjs [grupo]` — suíte "golden" HTTP (bate na prod ao vivo, **custa $**, rode RARO).
- `node scripts/pedro-health-scan.mjs [horas]` — varredura de saúde dos turnos.
- `scripts/regression/test-grounding.ts`, `test-search.ts` — testes pontuais.

### Testar o ESTOQUE isolado (sem webhook, sem LLM)
Para validar um feed novo (ex.: RevendaMais) ou a busca/score, escreva um script `tsx` que importa `searchPedroStock` de `stockSearch_20260525_photo_flow.ts` e passa `stock_feed_url` (override de dry-run que força a fonte RevendaMais sem precisar da integração gravada):
```ts
import { searchPedroStock } from "../supabase/functions/_shared/pedro-v2/stockSearch_20260525_photo_flow.ts";
const r = await searchPedroStock({} as any, { user_id:"t", stock_feed_url:"<feed.json>", query:"suv", limit:6, sells_motorcycles:true });
```
(Apague scripts temporários `_tmp_*` depois.)

---

## 8. COMO DEPLOYAR

```bash
cmd //c "scripts\supabase-logosia.cmd functions deploy pedro-webhook-v2 --project-ref seyljsqmhlopkcauhlor"
```
- `supabase-logosia.cmd` é um wrapper que carrega o `SUPABASE_ACCESS_TOKEN` de `supabase/.env.local` e roda `npx supabase ...`.
- Mudou um arquivo **shared** (`_shared/pedro-v2/*`)? Ele é embutido no bundle do `pedro-webhook-v2` no deploy — basta deployar `pedro-webhook-v2`. Se OUTRA função importa o mesmo shared (ex.: `pedro-recover-dropped` importa o orquestrador), **deploye essa também**.
- O warning final "Timeout while shutting down PostHog" é só telemetria — o deploy deu certo se apareceu `Deployed Functions`.
- Há staging: `supabase-logosia-staging.cmd` (raramente usado; prod é o normal).

---

## 9. COMO COMMITAR E PUSHAR (a "dança do stash")

O repo tem arquivos WIP do sócio que NÃO podem ir no seu commit. Sequência exata:

```bash
# 1) Stage só os SEUS arquivos
git add <seus arquivos>

# 2) Commit LOCAL (use arquivo de mensagem pra não apanhar do escaping do shell)
printf 'fix(pedro-v2): titulo curto\n\nCorpo: caso real + RAIZ + fix + testes.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\n' > .git/CM.txt
git commit -F .git/CM.txt && rm -f .git/CM.txt

# 3) Stash dos arquivos do SÓCIO antes do pull/push
git stash push -m "foreign-wip-socio" -- supabase/functions/_shared/pedro-v2/webhookRouting.ts supabase/functions/meta-webhook/index.ts supabase/functions/wa-inbox-webhook/index.ts

# 4) Pull --rebase + push pelo wrapper (carrega o GITHUB_TOKEN de github/.env.local)
cmd //c "scripts\git-logosia.cmd pull --rebase origin main"
cmd //c "scripts\git-logosia.cmd push origin main"

# 5) Devolve os arquivos do sócio
git stash pop
```
- `git-logosia.cmd` injeta o header de auth do GitHub (token em `github/.env.local`, repo `Agencia-Up/humanizeia`).
- `commit` é LOCAL (não precisa do wrapper). `pull`/`push` (rede) usam o wrapper.
- **Mensagem de commit é documentação:** sempre `caso real (lead/print) + RAIZ + o que mudou + nº de testes`. O histórico do git é parte do "brain" — é onde a próxima IA entende o PORQUÊ.

---

## 10. DIAGNÓSTICO (os métodos que realmente funcionam)

### "O agente não respondeu / sumiu"
Cruze RECEBIDO vs PROCESSADO:
```sql
-- chegou?
select created_at, role, left(content,60) from wa_chat_history where remote_jid like '%<8digitos>%' order by created_at desc limit 6;
-- processou?
select created_at, intent, next_action, result->>'reply_source' src, left(result->>'reason',60) reason, left(payload->>'text',40)
from pedro_v2_turn_logs where remote_jid like '%<8digitos>%' order by created_at desc limit 6;
```
- Msg em `wa_chat_history` mas SEM turno em `pedro_v2_turn_logs` = **DROP** (o turno em background morreu no debounce — recycle/deploy). Cura: o cron `pedro-recover-dropped` (§13) reprocessa.
- Sem msg em `wa_chat_history` = a mensagem **não chegou ao webhook** → problema de CONEXÃO/instância (ver "instância" abaixo), NÃO de código.

### Bug de ESTOQUE ("disse que não temos X tendo X", "carro errado")
Dumpe os filtros usados no dry-run. O método-chave é olhar `stock_result.filters_used` e os tokens. A regra-mãe: numa busca AMPLA, `ad_context` é DICA de ranking, **nunca filtro DURO** (senão zera o pool). Palavras de TIPO ("suv", "moto") são WEAK_WORDS / ATTRIBUTE_NOISE — não podem virar token de modelo (senão exigem score>0 e zeram).

### Conexão da instância uazapi ("leads não chegam")
Pegue o token (`select api_key_encrypted from wa_instances where instance_name='<nome>'`) e consulte a uazapi:
```bash
curl -s "https://logosiabrasilcom.uazapi.com/instance/status" -H "token: <TOKEN>"   # status: connected/disconnected + lastDisconnectReason
curl -s "https://logosiabrasilcom.uazapi.com/webhook"          -H "token: <TOKEN>"   # confirma url do webhook = .../pedro-webhook-v2 e events:["messages","connection"]
```
- `"lastDisconnectReason":"401: logged out from another device"` = o WhatsApp deslogou porque conectou de OUTRO dispositivo/instância. **Causa clássica: mais de uma instância pro mesmo número.** Cura: reconectar (QR) + manter UMA instância só.
- ⚠️Ao recriar instância, o `wa_ai_agents.instance_ids` precisa apontar pro id NOVO. Confira: `select instance_ids from wa_ai_agents where id='<agent>'`.

---

## 11. O BANCO (tabelas que você vai consultar sempre)

| Tabela | Para quê |
|---|---|
| `wa_ai_agents` | Config do agente: `system_prompt` (prompt do cliente), `name`, `company_name`, `sells_motorcycles`, `instance_id`/`instance_ids`, `agent_type`. |
| `agent_funnel_config` | Funil ESTRUTURADO por agente: `bloco3_abordagem`, `bloco4_qualificacao` (`questions[]`), `generated_system_prompt`. Usado pelo funil-force. |
| `platform_integrations` | FONTE DE ESTOQUE por `user_id`: `platform`='bndv' (token) ou 'revendamais' (`{"feed_url":...}`), `is_active`. Credenciais em `api_key_encrypted` (JSON puro, apesar do nome). |
| `pedro_v2_turn_logs` | 1 linha por turno processado: `payload`, `intent`, `next_action`, `result` (reply_source, reason). **Sua principal ferramenta de diagnóstico.** |
| `wa_chat_history` | Mensagens (role user/assistant). `metadata.ctwa_ad` guarda o anúncio. |
| `ai_crm_leads` | Estado do lead: `ai_paused`, `status_crm`, `assigned_to_id` (vendedor), `lead_name`. |
| `wa_instances` | Instâncias uazapi: `instance_name`, `is_active`, `status`, `api_key_encrypted` (token), `api_url`. |
| `pedro_conversation_state` | Memória da conversa (veiculos_apresentados, ultima_foto, qualificação...). |
| `knowledge_bases`/`knowledge_chunks`/`agent_knowledge_bases` | Base de conhecimento (RAG) — ver §12. |
| `pedro_v2_health_reports` | Relatórios do monitor de saúde diário. |

Identidade: `remote_jid` é `55DDDNUMERO@s.whatsapp.net`. Para filtrar, use `like '%<8 dígitos do número>%'`.

---

## 12. ESTOQUE E BASE DE CONHECIMENTO

### Fonte de estoque (multi-tenant)
Resolvida em `stockSearch_20260525_photo_flow.ts` → `searchPedroStock`, lendo `platform_integrations` por `user_id`:
- **RevendaMais primeiro** (`platform='revendamais'`, `is_active=true` → `feed_url`): feed **JSON** formato carro57. Adaptador: `revendaMaisStock.ts`. Campos do feed: `make, base_model, model, year/fabric_year, mileage, price/promotion_price, color, fuel, gear, images_large/images, category`. Normaliza pro shape do BNDV → reaproveita TODO o motor.
- Senão **BNDV** (`platform='bndv'` → `api_token`, GraphQL `https://api-estoque.azurewebsites.net/graphql`).
- Dry-run força RevendaMais com `input.stock_feed_url`.
- **Conectar um cliente** (sem UI ou via UI nova "RevendaMais" em IntegrationsTab): INSERT em `platform_integrations` (`{"feed_url":"..."}`, `is_active=true`) — o DONO roda (MCP read-only). Teste o feed pelo botão "Testar Conexão" (função `test-integration`) ou pelo script de estoque isolado (§7).
- **Moto:** `wa_ai_agents.sells_motorcycles` controla se motos entram no pool. A moto só aparece quando o lead PEDE moto (tipo "moto"/"quero uma moto") ou NOMEIA a moto; nunca em busca de carro/genérica (lógica em `passesRequestedVehicleType`).

### Base de conhecimento (RAG) — ligada no Pedro a partir do v181
`knowledgeBase.ts` → `fetchPedroKnowledgeContext`: se o agente tem base ligada (`agent_knowledge_bases`), embeda a msg (`text-embedding-3-small`) → RPC `search_knowledge` (threshold 0.60, top 5) → injeta "## BASE DE CONHECIMENTO DA LOJA" no prompt do reply. **Condicional:** sem base ligada, custo zero. Use a base para **POLÍTICAS DA LOJA** (garantia, financiamento, documentação, FAQ) — NÃO para catálogo de carros (RAG é ferramenta errada pra isso).

---

## 13. O RECUPERADOR ANTI-DROP (pedro-recover-dropped)

Existe porque o turno roda em background (`EdgeRuntime.waitUntil`) com debounce de até 45s; se o isolate recicla (ou um DEPLOY acontece) no meio, a tarefa morre → msg salva mas sem resposta. O cron `pedro-recover-dropped` (a cada 1 min) acha lead cuja ÚLTIMA msg é do LEAD, idade [90s, 25min], SEM turno → REPROCESSA via `processPedroV2Turn(..., recovery:true)`.
- `recovery:true` pula o save (msg já no histórico, não duplica) → `myUserMsgId` null → debounce se auto-pula → responde direto.
- Pula despedida/agradecimento/reação e lead pausado; idempotente; teto de 12/run; modo `?dry=1` lista candidatos sem mandar.
- **Agendamento:** o DONO roda `cron.schedule('pedro-recover-dropped','* * * * *', net.http_post(.../functions/v1/pedro-recover-dropped, anon key))` no SQL editor (MCP read-only não insere no cron).
- ⚠️**Cada deploy mata tarefas em background** → não fique deployando em rajada em horário de pico (cada deploy = alguns drops temporários).

---

## 14. O "BRAIN" / MEMÓRIA (importante: como o conhecimento não morre)

Eu mantenho um **brain persistente** (sistema de memória): um `MEMORY.md` (índice) + arquivos-tópico por tema (ex.: `pedro-v2-presend-verify.md`, `pedro-v2-funil-e-base.md`, `pedro-v2-stock-sources.md`, `pedro-v2-search-hardening.md`). Cada correção registra: **caso real + RAIZ + fix + lição + método de diagnóstico**. É isso que me deixa não repetir erro e entender o PORQUÊ de cada hack.

**Para o Antigravity:** você provavelmente não tem acesso ao meu diretório de memória. Então o equivalente do brain, pra você, é a soma de:
1. **ESTE manual** (mantenha-o vivo — atualize o CHANGELOG abaixo).
2. **As mensagens de commit do git** (são detalhadas de propósito: caso real + raiz + fix).
3. **Os comentários no código** — cada guard determinístico tem um comentário com o caso real que o originou (ex.: "lead 99223-8447 'ta complicado'"). LEIA os comentários antes de mexer; eles explicam por que aquilo existe.

Se você (Antigravity) mantiver alguma memória/regra própria, **espelhe as lições aqui** para não se perder. A regra do dono: *"esse arquivo não pode vencer ou ele não pode esquecer de consultar"* — então consulte SEMPRE, e mantenha-o atualizado.

---

## 15. CATÁLOGO DE ARMADILHAS (erros que já me morderam — não caia neles)

1. **Editar arquivo MORTO.** Confirme o arquivo VIVO pelos imports (§3). "Corrigi e nada mudou" = você editou um `_20260524`/`_sales`/etc. morto.
2. **`\b` no FIM de prefixo regex.** `\bconsultor\b` NÃO casa "consultores"; `\bseminovo\b` NÃO casa "seminovos". Use só `\b` no INÍCIO (`\b(consultor|seminovo|...)` sem `\b` final) quando quiser pegar plural/derivados.
3. **Humanize destrói listas.** O envio com `humanize:true` reflui o texto em até 3 mensagens e DESTRÓI as quebras de linha de listas numeradas. Replies determinísticos de LISTA precisam entrar no `preserveFormatting` (a heurística `/\n\s*\d+[.)]\s/` ajuda). Senão a lista sai "grudada".
4. **Relist sobrescreve abordagem.** Um reply determinístico que NÃO cita veículo (abordagem/qualificação) é re-sobrescrito pelo `category_relisted` (porque `!replyMentionsAnyVehicle`=true). Exclua o `source` da lista de exclusão do relist (§5, item 7).
5. **Moto zerada no score.** Palavra de tipo ("moto") como token de busca exige `score>0` e a moto não tem bônus de body_type → some. Cura: pôr em WEAK_WORDS (cai no early-return que devolve por tipo).
6. **Dry-run simplificado mente em anúncio/áudio/burst.** Use replay do payload REAL + leia os turn_logs. O ad_context só vem na 1ª msg do burst (debounce responde a última) — há recuperação via `wa_chat_history.metadata.ctwa_ad`.
7. **Áudio mal transcrito.** O Whisper sem `prompt` de domínio transcreve "Hilux"→"Array Lux". O `transcribeAudioMedia` manda um prompt com marcas/modelos. Se um modelo sumir do reconhecimento, acrescente ao prompt.
8. **Reação ≠ mensagem.** 👍 numa msg é REAÇÃO (uazapi `messageType:"ReactionMessage"`) — o webhook IGNORA. Um emoji ENVIADO solto também nunca transfere (salvaguarda no orquestrador). Não trate reação como "sim".
9. **`sells_motorcycles=false` remove a moto ANTES da busca.** Se a loja vende moto, o flag precisa ser `true` no agente.
10. **MCP read-only.** Não tente INSERT/UPDATE/cron por lá — entregue o SQL pro dono.
11. **Build não bumpado.** Você deploya e testa achando que é a versão nova, mas é a velha. SEMPRE bumpe o build e confira o string no retorno.
12. **`supabase db push` é proibido** (migrações dessincronizadas). Migração = arquivo + dono aplica no SQL editor.
13. **Nome do agente vs persona do prompt.** `wa_ai_agents.name` pode divergir do nome no prompt do cliente (ex.: agente "Sara" mas prompt diz "Manu"). As regras determinísticas usam `name`; o LLM usa o prompt → o lead vê dois nomes. Alinhe os dois.

---

## 16. CHECKLIST ANTES DE QUALQUER MUDANÇA (cole isto no cérebro)

- [ ] Diagnostiquei com DADOS REAIS (turn_logs × chat_history), não chutei?
- [ ] Sei em QUAL camada vive (planner/reply/stock/preSendVerify)?
- [ ] Estou editando o arquivo VIVO (confirmado pelos imports)?
- [ ] A correção é GERAL (invariante), não um `if` por frase?
- [ ] Adicionei teste em `offline.ts` e ficou VERDE?
- [ ] Bumpei o `PEDRO_V2_BUILD`?
- [ ] Deployei a função certa (e as que importam o shared)?
- [ ] Validei (dry-run / replay) e confirmei o build novo no retorno?
- [ ] Commit com mensagem DETALHADA + dança do stash dos arquivos do sócio?
- [ ] Atualizei o CHANGELOG deste manual?
- [ ] Se precisa de escrita no banco → entreguei o SQL pro dono (não rodei via MCP)?

---

## 17. ONDE ESTÁ O HISTÓRICO (builds v104→v190)

O detalhe de CADA build (a raiz e o fix de cada caso real) está nas **mensagens de commit do git** e nos **comentários do código** (cada guard tem o `lead XXXXX` que o originou). Para entender por que algo existe: `git log --oneline` + leia a mensagem do commit que tocou aquele trecho (`git log -p <arquivo>`). NÃO remova um guard sem entender o caso real que ele resolve — quase todos vieram de um print de bug real do dono.

---

## CHANGELOG (mantenha vivo — 1 linha por mudança relevante)

- 2026-06-25 — v190 — Recuperador anti-drop (`pedro-recover-dropped`) + flag `recovery` no orquestrador. Manual criado.
- 2026-06-25 — v191 — SDR PROATIVO: o funil-force agora dispara quando o reply não tem pergunta SIGNIFICATIVA (isca "Precisa de mais alguma informação?" não conta — `replyHasMeaningfulQuestion` sentença-aware), tira a isca (`stripTrailingFillerQuestion`) e puxa a próxima qualificação. `nextFunnelQuestion` passou a mapear "O que você está procurando?" (interesse) — a Avant perdia essa. Guards: não puxa em despedida (`replyIsGracefulClose`)/recusa/transferência. Caso Avant: lead "onde fica a loja?" → responde + "O que você está procurando?".
- 2026-06-25 - v202 - Continuidade de opcoes preserva o perfil anterior: "tem mais opcoes?" forca nova busca herdando tipo/faixa (ex.: SUV ate 70k) e nao relaxa para hatches/sedans aleatorios; buildStockFilters mantem o teto anterior mesmo com anuncio em contexto. Tambem protege pedro_conversation_state.lead.nome contra placeholder "Lead".
- 2026-06-25 - v203 - Tipo/carroceria no plural nao vira modelo: "sedans"/"SUVs" agora sao tratados como tipo_veiculo/stock_broad, impedindo "nao tenho sedans" quando ha sedans reais. Fallback deterministico tambem renumera listas ordenadas por preco como 1,2,3.
- (Antigravity: adicione suas mudanças aqui, no formato `data — vNNN — o que + lead/caso`.)
