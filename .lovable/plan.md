
Objetivo imediato: te tirar do modo de Segurança e voltar ao fluxo normal para eu implementar o Passo 3.

1) Desbloquear a interface (faça nesta ordem)

Desktop
- Passo A: Na barra acima do preview, clique no ícone de escudo (Security) para sair dessa view.
- Passo B: Na caixa de mensagem (rodapé do chat), clique no ícone de balão para alternar de Plan/Chat para Build.
- Passo C: Verifique se o input está em Build mode (não Plan/Chat).

Mobile
- Passo A: Em Chat mode, toque em “…” (canto inferior direito) e troque de Security para outra view (ex.: Preview/Cloud).
- Passo B: No campo de mensagem, toque no ícone de balão para alternar para Build.
- Passo C: Confirme que está em Build mode antes de enviar o próximo prompt.

2) Se continuar travado (fallback rápido)

Desktop
- Atalho: Alt+P para alternar Plan/Build.
- Crie nova conversa: botão “+” (novo chat) e envie “Implementar Passo 3”.
- Recarregue a página (Ctrl/Cmd+R) e reabra o projeto.

Mobile
- Abra novo chat pelo “+”.
- Feche e reabra o app/navegador.
- Reentre no projeto e confirme o modo Build no input antes de mandar mensagem.

3) Assim que destravar, implementação do Passo 3 (eu executo)

- Criar rota/página: /whatsapp/campaigns.
- Construir listagem de campanhas (wa_campaigns) com ação “Nova campanha”.
- Criar formulário com:
  - nome da campanha
  - seleção de listas de contatos
  - prompt base
  - delay mínimo/máximo
  - rodízio por instância (mensagens antes de trocar)
- Integrar backend para salvar campanha e regras.
- Integrar IA: usar claude-chat (ou função dedicada) para gerar variações no momento do disparo.
- Validar fluxo completo de criação -> persistência -> prévia de variações.

Detalhes técnicos (quando estiver em Build)
- Dados:
  - wa_campaigns (nome, prompt_base, delay_min_s, delay_max_s, rotation_messages_per_instance, status, user_id, timestamps)
  - tabela relacional campanha x listas (se múltiplas listas por campanha)
- Segurança:
  - políticas de acesso por usuário autenticado (cada usuário só vê/edita suas campanhas)
- Frontend:
  - página com tabela + modal/drawer de criação
  - validação com zod/react-hook-form
- IA:
  - payload com prompt_base + contexto da campanha
  - retorno com variações para uso no disparo

Quando você confirmar que está em Build mode, eu sigo imediatamente com a execução desse plano.
