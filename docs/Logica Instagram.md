# Prompt para Implementação de Integração Profissional com Instagram API

Este prompt foi desenhado para ser utilizado no **Claude Code** (ou qualquer assistente de codificação avançado) para implementar uma integração robusta e profissional com a **Instagram Graph API**.

---

## Prompt Sugerido

"Atue como um Engenheiro de Software Sênior especializado em integrações de APIs de redes sociais. O objetivo é implementar uma integração profissional com a **Instagram Graph API** para permitir que um agente de social media automatize publicações de **Posts (Feed), Stories e Reels**.

### 1. Escopo Técnico
Implemente um módulo de integração que cubra os seguintes pilares:

#### A. Autenticação e Gestão de Tokens
- Implemente o fluxo OAuth2 para obter o **User Access Token**.
- Crie uma lógica para trocar o token de curta duração por um **Long-Lived Access Token** (60 dias).
- Implemente a recuperação do **Instagram Business Account ID** associado às páginas do Facebook do usuário.
- Garanta o armazenamento seguro desses tokens (sugira o uso de variáveis de ambiente ou um cofre de segredos).

#### B. Fluxo de Publicação (Content Publishing API)
A implementação deve seguir o processo de duas etapas da Meta:
1. **Criação do Container de Mídia**: `POST /{ig-user-id}/media` com os parâmetros específicos para cada tipo:
   - **Posts**: Suporte a imagens (JPEG) e vídeos.
   - **Reels**: Parâmetros `media_type=REELS`, `caption`, e `share_to_feed=true`.
   - **Stories**: Parâmetro `media_type=STORIES`.
2. **Verificação de Status**: Lógica de polling para checar se o container está pronto (`status_code=FINISHED`).
3. **Publicação Final**: `POST /{ig-user-id}/media_publish` usando o `creation_id` obtido.

#### C. Validação de Mídia
- Adicione uma camada de validação antes do upload para garantir que os arquivos atendam aos requisitos da Meta:
  - **Reels/Stories**: Aspect ratio 9:16, formato MP4/MOV.
  - **Feed**: Aspect ratio entre 4:5 e 1.91:1.
  - **Tamanho**: Limites de bitrate e duração (ex: Reels de 5 a 90 segundos).

### 2. Arquitetura do Código
- O código deve ser modular e extensível.
- Utilize uma biblioteca de requisições robusta (ex: `axios` para Node.js ou `requests` para Python).
- Implemente **Tratamento de Erros** detalhado, capturando códigos de erro específicos da API do Instagram (ex: erro de permissão, limite de taxa atingido, mídia inválida).
- Adicione **Logs** profissionais para monitorar o sucesso ou falha de cada etapa do processo.

### 3. Requisitos de Permissões
Certifique-se de que o código lide com os seguintes escopos necessários:
- `instagram_content_publish`
- `instagram_basic`
- `pages_read_engagement`
- `pages_show_list`
- `business_management`

### 4. Entrega Esperada
1. Estrutura de pastas do módulo.
2. Código-fonte comentado explicando cada endpoint.
3. Um guia rápido de como configurar o App no Facebook Developer Portal para suportar este código.
4. Exemplo de como chamar a função de publicação para um Reel, um Story e um Post normal.

Comece analisando a melhor stack tecnológica para este projeto e proponha a estrutura inicial."

---

## Dicas Adicionais para o Usuário:
- **App Review**: Lembre-se que para usar a permissão `instagram_content_publish` em produção, seu App no Facebook precisará passar por uma revisão (App Review).
- **Business Account**: A conta do Instagram deve ser obrigatoriamente do tipo **Comercial (Business)** ou **Criador** e estar vinculada a uma Página do Facebook.
- **Webhooks**: Para uma integração ainda mais profissional, você pode pedir ao Claude para implementar Webhooks para receber notificações em tempo real sobre o status das publicações.