# Pedro v3 — Contrato LLM-first, contexto único e plano de ação

**Data:** 2026-07-17
**Autor:** Codex, auditor/arquiteto
**Status:** contrato aprovado pelo dono do produto para execução
**Escopo:** todas as contas e tenants que usam o Pedro v3

## 1. Invariante arquitetural permanente

O Pedro v3 deve seguir este ciclo em todos os turnos comerciais:

```text
LLM interpreta o bloco atual e o histórico
        ↓
LLM decide responder ou chamar uma tool
        ↓
Engine valida segurança, evidência, capability, PII, mídia e formato
        ↓
Tool executa somente se a decisão tiver intenção e evidência válidas
        ↓
Resultado da tool volta para a mesma LLM
        ↓
LLM redige a resposta comercial final
        ↓
Engine valida e despacha o efeito autorizado
```

### Autoridade única

A LLM é a única autoridade para:

- interpretar o bloco atual;
- identificar o assunto e a intenção;
- relacionar respostas curtas à pergunta correta;
- escolher o próximo passo conversacional;
- decidir se precisa de estoque, detalhes, fotos, conhecimento, CRM, agenda ou transferência;
- escolher o alvo semântico da tool;
- redigir toda resposta comercial;
- decidir quando continuar, encerrar ou transferir.

A engine pode somente:

- consolidar mensagens fragmentadas em um bloco;
- disponibilizar histórico, memória, anúncio, conhecimento e resultados;
- executar tools autorizadas pela LLM;
- validar evidência literal do bloco para ações sensíveis;
- validar fatos retornados, veículo, preço, mídia, PII e chaves internas;
- impedir efeitos inseguros ou sem capability;
- devolver erro estruturado para a mesma LLM reescrever;
- usar fallback técnico curto e transparente somente após falha real do provedor, schema ou execução.

## 2. Concorrências proibidas

Nenhum caminho ativo pode, antes da interpretação da LLM:

- escolher `stock_search`, `request_photos`, `continuity`, `more_options` ou outro intent comercial;
- escolher o próximo slot ou a próxima pergunta;
- decidir que o lead está qualificado ou pouco qualificado;
- redigir CTA ou resposta comercial;
- reescrever a pergunta da LLM por ordem de funil;
- transformar uma resposta em transferência por regex ou estágio;
- substituir o anúncio por lista sem decisão da LLM;
- transformar follow-up em mensagem determinística comercial.

Handlers determinísticos existentes só podem permanecer no caminho ativo se forem convertidos em uma destas formas:

1. **projeção factual read-only**, que apenas informa a LLM;
2. **resolver de segurança/grounding pós-decisão**, que valida a proposta;
3. **executor de tool/efeito**, que não escolhe intenção nem escreve texto.

Qualquer módulo que escolha assunto, funil, pergunta ou texto é concorrência e deve sair do caminho ativo.

## 3. Contrato de contexto único

O cérebro deve receber um único `ConversationContextEnvelope`, com campos agrupados por função e com origem/recência:

- `currentTurn.leadBlock`: bloco completo e atual do lead;
- `currentTurn.source`: anúncio, mídia e origem do contato;
- `history.recent`: histórico bruto suficiente para continuidade;
- `history.relevant`: trechos antigos recuperados por relevância quando necessário;
- `assistant.lastMessage`: última fala efetivamente enviada;
- `assistant.lastQuestion`: pergunta efetivamente enviada, se houver;
- `memory.confirmedFacts`: fatos confirmados, com `sourceTurnId`, `observedAt` e status;
- `memory.openLoops`: assuntos ainda abertos, sem impor ordem;
- `memory.selectedVehicle` e `memory.visibleOffers`: foco e ofertas visíveis;
- `memory.summary`: resumo curto, atualizado após cada turno aceito;
- `knowledge`: conhecimento da empresa recuperado, separado de memória da conversa;
- `tools`: resultados do ciclo atual, com sucesso/erro e provenance;
- `channel`: horário e canal do Brasil;
- `capabilities`: capacidades operacionais disponíveis, sem instruir assunto.

Esse envelope é contexto, não ordem. Nenhum campo de memória pode dizer à LLM qual assunto escolher. O bloco atual vence fatos antigos quando houver mudança explícita.

Não criar novas projeções concorrentes equivalentes a `conversationContext`, `modelContextView`, `currentTurnFacts` e `workingMemory` sem uma fronteira clara. Projeções internas podem existir, mas devem convergir para esse envelope único antes da chamada ao modelo.

## 4. Loop de tools

O loop deve ser uma sequência observável e limitada:

1. construir o envelope;
2. chamar a LLM;
3. se a LLM devolver resposta, validar e finalizar;
4. se devolver tool call, validar capability, intenção, alvo e evidência;
5. executar a tool;
6. anexar o resultado ao mesmo contexto do turno;
7. chamar a mesma LLM novamente para redigir a resposta;
8. validar o final e persistir atomicamente estado, decisão, eventos e outbox.

A engine nunca deve substituir a LLM por um handler comercial porque o caso parece conhecido. Em falha, deve devolver feedback técnico específico à LLM. O limite de passos evita loop infinito, mas não cria uma resposta comercial paralela.

## 5. Memória

O Postgres continua sendo a memória durável do Pedro v3. A memória deve ser organizada em três camadas distintas:

1. **histórico bruto:** mensagens e turnos aceitos, preservados para continuidade e replay;
2. **memória semântica da conversa:** fatos, foco, pendências, compromissos e resumo, sempre com origem e recência;
3. **conhecimento da empresa:** base consultável do tenant, nunca misturada com fatos do lead.

A LLM não deve receber apenas uma janela fixa de mensagens. Deve receber histórico recente dentro do orçamento de tokens e trechos antigos relevantes quando a conversa exigir. O resumo não substitui o histórico bruto.

## 6. Prompt do portal

O prompt do portal continua sendo a fonte principal de:

- identidade;
- personalidade;
- tom;
- informações comerciais;
- funil desejado;
- frases de apresentação quando configuradas;
- regras de negócio próprias do tenant.

O protocolo técnico não pode duplicar o funil do portal. Deve explicar somente o contrato LLM/tool/segurança. Antes de editar o prompt do Bruno, corrigir a autoridade e o envelope de contexto; caso contrário, o prompt será usado para compensar defeitos da engine.

## 7. Avaliação obrigatória

Toda alteração deve ser validada em dataset de conversas reais e medir, no mínimo:

- relação com a última fala;
- retenção de anúncio e foco do veículo;
- separação entre compra, troca e pagamento;
- escolha de tool e alvo;
- ausência de repetição;
- ausência de transferência precoce;
- grounding dos fatos;
- naturalidade da resposta;
- follow-up coerente;
- fallback técnico somente em falha real.

Teste verde de TypeScript não é evidência de qualidade conversacional.

## 8. Plano de execução aprovado

### Fase A — contrato e instrumentação

- registrar este documento e referenciá-lo no contexto mestre;
- registrar `contextEnvelopeVersion`, fontes, retries, responseSource, decisões pré-LLM e fallback por turno;
- criar uma métrica que revele qualquer handler comercial executado antes da LLM;
- manter `central_active` como modo padrão do runtime; `off` só pode existir como rollback explícito e não representa o contrato LLM-first;
- preservar o WIP e não alterar contas de produção nesta fase.

### Fase B — remoção das concorrências

- remover do caminho ativo os branches comerciais pré-LLM de foto, busca, continuidade, ranking, mais opções e descoberta;
- transformar resolução determinística em dados/validadores pós-decisão;
- retirar `sdr-conductor` como autoridade de slot, pergunta ou CTA;
- impedir que `adjustDraftSafeguards` altere texto comercial aprovado pela LLM;
- manter apenas validações de segurança, grounding, efeitos e schema.

### Fase C — contexto único

- criar o envelope canônico;
- fazer `openai-agent-brain` consumir somente esse envelope + histórico real + resultados de tools;
- remover duplicação de instruções entre `runtimeContext`, `currentTurnFacts`, `modelContextView` e protocolo;
- preservar o bloco atual como última mensagem de usuário e fonte da evidência.

### Fase D — contrato de saída e loop

- substituir JSON livre por schema estrito compatível com o modelo;
- separar decisão/tool call de resposta final sem perder o contrato de efeitos;
- executar tool somente após decisão validada da LLM;
- devolver resultados da tool para a mesma LLM;
- limitar retries a falhas técnicas ou violações objetivas.

### Fase E — memória contextual

- manter histórico bruto e working memory no Postgres;
- adicionar proveniência/recência às projeções;
- implementar seleção de histórico relevante além da janela fixa;
- atualizar resumo e open loops somente após turno aceito, na mesma transação CAS.

### Fase F — prompt do Bruno e avaliação

- reescrever o prompt do Bruno sem duplicar o protocolo técnico;
- incluir a apresentação oficial e exemplos gerais de condução, sem transformar exemplos em roteador;
- rodar dataset barato local/fixture;
- rodar smoke curto com LLM real;
- só depois considerar commit, push e ativação.

## 9. Critério de conclusão desta missão

Esta missão só estará concluída quando o caminho ativo demonstrar, por código e telemetria, que:

- não existe decisão comercial pré-LLM;
- existe uma única entrada canônica de contexto;
- toda tool foi escolhida pela LLM e validada pela engine;
- todo texto comercial veio da LLM, salvo fallback técnico explícito;
- resultado de tool retorna à LLM antes da resposta;
- memória recuperada e histórico real chegam ao modelo;
- os casos reais de anúncio, troca, pagamento, foto, follow-up e transferência passam sem regressões.
