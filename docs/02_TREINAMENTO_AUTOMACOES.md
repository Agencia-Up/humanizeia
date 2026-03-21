# Treinamento: Conectando o FluxCRM ao n8n (Funil de Boas-Vindas Automático)

Este manual tem como objetivo capacitar a equipe a entender e configurar o funil inicial de captação, onde a entrada de um Lead no sistema dispara uma mensagem instantânea via WhatsApp através do **n8n**.

---

## 🎯 Objetivo da Automação
Eliminar a abordagem manual. Assim que um cliente (Lead) entrar no CRM da plataforma (seja via landing page futura ou cadastro manual no painel), o seu sistema n8n será notificado imediatamente para realizar um Disparo/Mensagem de saudação.

---

## ⚙️ Passo a Passo da Configuração

### 1. Configurando o Receptor no n8n
Antes do painel poder enviar o Lead, o n8n precisa estar pronto para ouvir.
1. Abra o seu n8n e crie um novo Workflow (Fluxo).
2. Adicione o nó inicial **"Webhook"**.
3. Na configuração do nó:
   - **HTTP Method:** Mude de `GET` para **`POST`** *(obrigatório, pois enviaremos os dados do Lead)*.
   - **Authentication:** `None` (ou configure segurança caso deseje).
4. Clique duas vezes em **"Test URL"** e copie o link para usarmos na plataforma.
5. Clique no botão de `Listen for test event` para deixar o n8n aguardando a chegada dos dados.

### 2. Configurando o Gatilho no HumanizeAI
Agora vamos avisar ao sistema HumanizeAI para onde ele deve mandar a ficha do cliente.
1. Acesse o painel da ferramenta navegando para a aba lateral **"Automações"** (dentro do menu WhatsApp).
2. Clique no botão verde **"+ Nova Automação"**.
3. Preencha os dados:
   - **Nome:** `Boas-vindas Módulo Base`
   - **Quando (Trigger):** Selecione `"Novo lead criado no FluxCRM"`.
   - **Ação:** Selecione `"Chamar webhook externo"`.
   - **URL do Webhook:** Cole aquele link que você copiou do seu n8n.
4. Clique em **Salvar**. A automação já nascerá ativada.

### 3. O Teste de Fogo (Criando o Lead)
1. Com o n8n rodando no `Listen for test event`, abra a tela do **Flux CRM** na plataforma.
2. Clique em **"+ Novo Lead"**.
3. Preencha com um nome e telefone válidos. Se desejar, coloque também datas de *Follow-up* ou UTMs.
4. Clique em **Salvar**.
5. *MÁGICA:* Retorne à tela do n8n. Você verá que o nó do Webhook capturou 100% dos dados daquele Lead no formato JSON, em tempo real.

---

## 🧠 Como usar esses dados no n8n?
A partir do nó de Webhook que capturou o Payload, você pode colocar nós de IF/Condições, nós do WhatsApp (como Evolution API ou Z-API) puxando a variável `{{$json.lead.phone}}` e `{{$json.lead.name}}` no campo do destinatário, personalizando sua mensagem como:

> *"Olá {{$json.lead.name}}! Aqui é do atendimento HumanizeAI..."*

### E as UTMs?
Você também recebe `utm_source` no pacote. Você pode criar um *Switch Node* no n8n que lê a origem. Se o Lead veio de `instagram`, manda uma mensagem específica; se veio do `google`, manda outra.
