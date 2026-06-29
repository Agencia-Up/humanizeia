# ADR-004 - Shadow mode: como espelhar eventos sem efeito externo

- Status: **Proposto** (Fase 0). Decisão do dono: **começar por replays offline anonimizados**; este ADR compara as três origens de evento.
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §3 (decisão 9/10), §18 Fase 3, §19; `02` §6; POL-TOOL-001.

## Contexto

Shadow mode = o v3 processa conversas e **registra decisões sem responder ao lead** (nunca envia WhatsApp, nunca altera CRM, agenda ou transfere). Precisamos escolher **de onde vêm os eventos** para o v3 em shadow, comparando com o v2, **sem tocar no v2 em produção** (ADR-005). O dono fixou: primeiro **replays offline anonimizados**; tee/inbox são opções para shadow ao vivo posterior.

## Opções comparadas

### Opção A — Webhook tee (espelhar o webhook ao vivo)
Duplicar o evento do uazapi para o v3 (fan-out no ponto de entrada).
- (+) Mais fiel ao tempo real; mesma carga que o v2 vê.
- (−) **Toca o caminho de produção** (risco ao v2; viola "v2 read-only nesta fase").
- (−) Exige mudança no roteamento/infra do webhook agora.
- (−) Dois processadores sobre o mesmo evento ao vivo — coordenação extra.
- Veredito: **adiar**. Só após o v3 estar estável offline e com autorização explícita.

### Opção B — Inbox durável compartilhado/tee para tabela própria
O evento é copiado para `v3_inbox` (sem alterar o fluxo do v2), e o v3 consome dali.
- (+) Desacopla o v3 do timing do v2; durável; permite replay e idempotência nativos (ADR-002).
- (+) Isolado: escreve só em `v3_*`.
- (−) Ainda exige um ponto de captura ao vivo (mínimo) quando formos para shadow ao vivo.
- Veredito: **destino para shadow AO VIVO** (Fase 3 tardia), depois do offline.

### Opção C — Replay de histórico (offline, anonimizado) ← ESCOLHA INICIAL
Reprocessar conversas reais que já estão em `wa_chat_history`/`pedro_v2_turn_logs` (LEITURA), anonimizadas, alimentando o engine v3 offline.
- (+) **Zero risco** ao v2; nenhum efeito externo possível; 100% offline.
- (+) Cobre exatamente os casos que falharam no v2 (catálogo de invariantes).
- (+) Determinístico e reproduzível (com `FakeLlmAdapter`); barato.
- (−) Não captura timing/concorrência reais (burst/race) — esses ficam para testes de concorrência sintéticos e, depois, shadow ao vivo via Opção B.
- Veredito: **começar por aqui** (decisão do dono).

## Decisão

1. **Fase 3 inicial = Opção C** (replay de histórico anonimizado, offline, leitura-only do v2).
2. **Shadow ao vivo posterior = Opção B** (`v3_inbox` por tee durável), só com autorização explícita e v3 estável.
3. **Opção A (tee no webhook ao vivo) fica vetada** até decisão futura do dono — toca produção.
4. Em qualquer modo, **EffectGate OFF**: Sender/CRM/Schedule/Handoff retornam `skipped`. Persistência só em `v3_*`.
5. Métrica de shadow: `v3_shadow_comparisons` (v2_action × v3_action × agreement) + avaliação humana.

## Consequências

- (+) Validação começa sem qualquer risco ao agente em produção.
- (+) Caminho de evolução claro (offline → inbox durável ao vivo → canary).
- (−) Replay offline não prova concorrência/timing — coberto por testes sintéticos antes do canary.

## Pendência para o dono

- Confirmar a **fonte e o método de anonimização** dos replays (ver ADR-006 redaction): quais conversas, quais campos redigidos, onde os replays anonimizados são guardados (proposta: `Agent/tests/replays/` com dados já anonimizados, nunca crus).
