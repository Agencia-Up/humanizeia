# ADR-006 - Redaction/encriptação de dados sensíveis (proposta, não implementar)

- Status: **Proposto** (Fase 0). Decisão do dono Fase 0 item 6: "proponha política; não implemente ainda".
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §19; `04` POL-PRIV-001; `02` (TurnEvent/ToolCall "redacted").

## Contexto

O atendimento coleta dados pessoais (nome, e em alguns tenants **CPF**) e usa credenciais (tokens uazapi/BYOK). O v3 persiste eventos, decisões, tool calls e (em shadow) mensagens. **CPF e segredos nunca podem aparecer** em eventos, prompts persistidos ou logs. Dados reais usados em replay devem ser anonimizados.

## Decisão (proposta — aprovação do dono antes de qualquer implementação)

1. **Classificar campos** em: `public` (modelo/preço/cor), `pii` (nome, telefone, cidade), `secret` (CPF, tokens, chaves), `restricted` (conteúdo livre que pode conter PII).
2. **Redaction na borda de persistência:** uma função pura `redact(payload, schema)` roda **antes** de gravar qualquer `v3_turn_events`/`v3_tool_calls`/`v3_messages`/log. `secret` → removido/substituído por placeholder (`[REDACTED:cpf]`); `pii` → mascarado conforme política (ex.: telefone parcial) quando não essencial.
3. **CPF — `SensitiveValueRef`, nunca valor cru (CORREÇÃO Codex #8):** o `ConversationState` guarda só `slots.cpf: SensitiveSlot` = `{ status, ref: SensitiveValueRef|null }` (ver `02` §2.3.1). O valor real vive em **cofre isolado criptografado** (`v3_sensitive_vault`, tabela `v3_*` própria), referenciado por `ref`, desencriptado **só** no momento do efeito autorizado (handoff/agenda) — nunca no estado, evento, prompt persistido, log ou shadow.
3b. **Payloads tipados e versionados + redaction por construção (Codex #8):** todo `TurnEvent`/log usa `payloadSchemaVersion` e o tipo genérico `Redacted<T>` (def. em `02` §4) — a função que cria eventos só aceita payload já redigido; PII/segredo cru não é aceito (falha de tipo/validação). A redaction não é "um passo que pode ser esquecido", é a forma do dado.
4. **Segredos (tokens/chaves):** nunca no `Brain`, código, prompt ou log; vêm do sistema seguro existente (adapter de credenciais). Logs registram referências, não valores.
5. **Replays anonimizados:** dados reais de `wa_chat_history` usados em replay são **anonimizados na importação** (nomes/telefones/CPF substituídos por sintéticos estáveis) e guardados já anonimizados em `Agent/tests/replays/`. Nunca persistir conversa crua no v3.
6. **Prompts persistidos:** o que for guardado para auditoria do LLM passa pela mesma redaction; o prompt enviado ao provider segue a política do tenant (BYOK), mas o que se **persiste** é redigido.
7. **Teste obrigatório:** property test "nenhum `v3_turn_events`/log contém padrão de CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`) nem token conhecido".

## Consequências

- (+) Conformidade e segurança por design; auditoria sem vazar PII/segredo.
- (+) Replays seguros para desenvolvimento.
- (−) Custo de mapear o schema de sensibilidade de cada campo/tool antes do Kernel.
- (−) Encriptação de CPF em repouso exige decisão de chave/gestão (definir com o dono).

## Pendências para o dono

- Confirmar **quais tenants exigem CPF** e em que etapa (hoje v2 coleta em visita p/ alguns).
- Aprovar a estratégia de chave de encriptação do CPF (KMS? coluna encriptada? só flag + referência externa?).
