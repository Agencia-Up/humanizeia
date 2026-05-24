# Pedro v2 - Scaffold paralelo

Este modulo prepara a nova arquitetura do Pedro sem substituir o Pedro v1.

## Estado seguro por padrao

- `pedro-webhook-v2` fica desligado enquanto `PEDRO_V2_ENABLED` nao estiver `true`.
- Mesmo com o webhook ligado, o processamento roda em `dry_run` por padrao.
- Criacao/atualizacao de lead, memoria, CRM e confirmacao de vendedor so devem gravar dados quando:
  - a chamada enviar `commit: true` ou `dry_run: false`, conforme a rota; e
  - `PEDRO_V2_MUTATIONS_ENABLED=true`.
- Envio real de WhatsApp fica bloqueado enquanto `PEDRO_V2_SEND_ENABLED` nao estiver `true`.
- Ferramentas internas podem usar `PEDRO_V2_INTERNAL_TOKEN`; chamadas de usuario precisam de Bearer valido.

## Responsabilidades

- `contactIdentity.ts`: identifica lead, vendedor ou contato interno por telefone normalizado.
- `intentRouter.ts`: classifica intencoes do turno e extrai sinais comerciais.
- `leadMemory.ts`: encontra/cria lead e atualiza memoria estruturada.
- `transferRouter.ts`: escolhe vendedor por historico ou rodizio e confirma `ok`.
- `orchestrator.ts`: organiza o turno e decide a proxima acao.

## Importante

O Pedro v2 nao deve mover colunas comerciais do CRM automaticamente. O agente pode manter campos operacionais, mas vendedor e gerente continuam responsaveis por mover etapas comerciais.
