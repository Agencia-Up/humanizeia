# Diagnóstico — por que o agente AINDA falha na conversa — Claude executor — 2026-07-03

> **SÓ ANÁLISE. NENHUM código alterado** (o dono pediu para só diagnosticar). Codex sem tokens → Claude assumiu a
> análise. Este handoff existe para o Codex retomar sabendo o que foi visto.

## A tela (conversa real, agente "Agente IA - Teste")
```
Agente: Gostaria de saber seu nome para continuarmos?     (14:29)
Lead:   queria um argo                                     (14:29)
Lead:   tem?                                               (14:29)
Agente: No momento, não temos o Argo disponível no estoque. Mas tenho outras opções de hatch que podem te interessar.
        1. CAOA CHERY QQ 2018 — R$ 34.990
           0 km
        2. RENAULT SANDERO 2018 — R$ 44.990
           0 km
        3. PEUGEOT 208 2015 — R$ 45.990
           0 km
        4. HYUNDAI HB 20 2015 — R$ 49.990
           0 km
        5. CHEVROLET ONIX 2016 — R$ 51.990
           0 km
        Posso saber seu nome para continuarmos?           (14:30)
```

## 4 falhas observadas
1. **Despejo de lista de 5 carros** num "tem argo? tem?" (pergunta simples de disponibilidade). Um SDR bom conduz
   para 1 alternativa próxima ("Argo não tenho agora, mas o Onix 2016 é bem parecido — quer ver as fotos?"), não
   vomita 5 opções.
2. **"0 km" em carros 2015/2016** — mentira de grounding. Km ausente (0) renderizado como fato "0 km".
3. **Pergunta de nome REPETIDA** (14:29 e de novo 14:30) e no momento errado — o lead está engajado num veículo; o
   funil deveria ceder e cavalgar o interesse, não martelar "seu nome".
4. **Zero condução real** — não respondeu ao interesse, não avançou o funil de verdade, robótico.

## Causa-raiz (ATERRADA no código, não especulação)

**O runtime vivo é o v3 HANDLER-FIRST — `PEDRO_V3_BRAIN_MODE=off`.**
- Confirmado em `src/runtime/server.ts:45-48` — `resolveBrainMode()` retorna `"off"` a menos que a env var seja
  explicitamente `central_active`/`central_shadow` (nunca setada). E mesmo se setada, `PilotActiveRoot.mode`
  degrada p/ `off` fora do escopo do piloto Douglas.
- O formato da lista bate 100% com o renderer v3 `renderVehicleOfferList` (`src/engine/vehicle-offer-render.ts:49-53`:
  `N. MARCA MODELO ANO — R$ preço` + `\n   km · câmbio · cor`, itens separados por `\n\n`). Logo, é v3.

**No handler-first os HANDLERS DECIDEM antes da LLM — a LLM só redige o texto de uma decisão já tomada.**
`runConversationTurn` (`src/engine/conversation-engine.ts`):
- L228-254: `explicitSearch/rankingIntent/economyIntent` → `buildExplicitSearchTurnOutput` **monta a lista de 5**
  deterministicamente (o `vehicle_offer_list`). A LLM NÃO é perguntada "devo listar ou conduzir?".
- L314: `applySdrConduction(...)` roda DEPOIS, POR CIMA do output já pronto do handler → funil força objetivo
  `nome` e anexa a pergunta. Por isso a pergunta de nome repete a cada turno até ser respondida.
- A frase-intro ("não temos o Argo... outras opções de hatch") é COMPOSTA pela LLM (não hardcoded) seguindo o
  responsePlan do handler — mas a DECISÃO (listar) já veio pronta do handler.

**Bug de render isolado (afeta os DOIS caminhos — renderer compartilhado):**
- `src/engine/vehicle-offer-render.ts:37` — `v.km != null && Number.isFinite(v.km) ? '${formatKm} km' : null`.
  Aceita **km=0** → "0 km". INCONSISTENTE com o preço (linha 32: `preco > 0 ? ... : "preço a confirmar"`, honesto).
  Correção óbvia (1 linha): exigir `v.km > 0` (omite km ausente). Vale para handler-first E central.

## Resposta à pergunta do dono ("temos memória robusta / um fluxo que a LLM deveria seguir mas não segue?")
- **SIM, o fluxo robusto EXISTE**: é o **agente central** (`central-engine.ts` + WorkingMemory + AgentBrain +
  condução), commitado (`main e9c7dfeb`), gate PASS (0 críticas / 0 terminal_safe em 112 turnos no eval real).
- **MAS está DESLIGADO** (flag off). O que atende hoje é o handler-first, onde código hardcoded decide antes da LLM.
- Portanto NÃO é "a LLM ignora o fluxo" — é **"o fluxo (cérebro central) não está no ar; handlers curto-circuitam a
  decisão"**. É EXATAMENTE o pivô do `Brain/11`. Enquanto o central estiver off, a conversa vai continuar assim.

## Ressalvas honestas (não prometer demais)
- Ligar o central é **necessário** (dá a decisão à LLM guiada pelo prompt+condução), mas o gate atual do central
  NÃO cobriu especificamente este padrão ("tem <modelo que não existe>?" → conduzir p/ 1 alternativa em vez de
  despejar 5). Antes de dizer "resolvido", precisa de um cenário de eval que prove esse comportamento.
- O bug de km=0 vaza mesmo no central (renderer compartilhado) → corrigir antes de ativar.

## Recomendação (NÃO executado — aguardando o dono/Codex)
1. NÃO remendar o handler-first (decisão do R13 = substituí-lo pelo central).
2. Corrigir `vehicle-offer-render.ts:37` (km>0) — 1 linha, testável offline, afeta os dois caminhos.
3. Adicionar cenário de eval ao gate do central: "tem argo?" (modelo inexistente) → conduzir p/ 1 alternativa
   aterrada + NÃO martelar nome enquanto há interesse ativo em veículo.
4. Sequência de ativação já planejada: auditoria Codex → SQL manual → `central_shadow` (comparar) → `central_active`
   (Douglas testa no WhatsApp).

Relacionado: `Brain/11-PLANO-AGENTE-CENTRAL-MEMORIA-FERRAMENTAS.md`, `Brain/2026-07-03-claude-r13d-audit-correcoes.md`.
