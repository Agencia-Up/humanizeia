# Preferências de Trabalho - HumanizeIA

Este documento serve como guia para as interações entre o Agente de IA e o Desenvolvedor (Aloã).

## Fluxo de Trabalho Git & Deploy (CRÍTICO)

1.  **Branch de Desenvolvimento**: Todo o trabalho e commits iniciais devem ser feitos na branch `dev-aloan`.
2.  **Autor do Commit**: Todos os commits devem ser feitos em nome de `dev-aloan`.
3.  **Sincronização para Deploy (Main)**: 
    - O Easypanel está configurado para puxar da branch `main`.
    - **Sempre** que terminar uma tarefa na `dev-aloan`, você deve fazer o merge para a branch `main` e dar o push na `main` também.
    - Isso garante que o deploy no Easypanel reflita as alterações mais recentes.
4.  **Supabase (Edge Functions & DB)**: 
    - Como você não tem acesso direto ao Supabase, deve fornecer o código pronto e instruções claras de onde colar (Edge Functions, SQL, etc).
    - Especifique exatamente o arquivo e o que a alteração resolve.
5.  **Deploy Final**: O deploy final no Easypanel é disparado/realizado manualmente por Aloã após o seu push na branch `main`.

## Comunicação
- Responda sempre em Português.
- Seja conciso e direto ao ponto.
- Notifique sempre que o push na `main` for concluído para que o deploy possa ser iniciado.

---
*Sempre consulte este arquivo ao iniciar uma nova tarefa. Estas regras são estritas para evitar falhas no ciclo de deploy.*
