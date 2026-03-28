# 🛡️ Guia de Preservação de Código para Claude

Este guia deve ser colado no chat do Claude sempre que o desenvolvedor solicitar alterações em arquivos existentes (especialmente no `SalomaoOrchestrator.tsx` e `BriefingSmartUpload.tsx`).

---

### 🚨 REGRAS CRÍTICAS DE DESENVOLVIMENTO

1.  **NUNCA DELETE FUNCIONALIDADES EXISTENTES:** Se você não entende para que serve um bloco de código, um estado (`useState`) ou uma aba no layout, **MANTENHA-O**. Caso precise refaturar, garanta que a funcionalidade antiga continue operando no novo código.
2.  **PRESERVE OS ESTADOS GLOBAIS:** Não remova estados como `activeBriefingId`, `aiProvider` ou `tab`, mesmo que o seu foco atual seja outra parte do arquivo. Eles são essenciais para a integração entre componentes.
3.  **MANTENHA AS ABAS INTEGRALMENTE:** O Salomão possui 5 áreas principais: `Equipe`, `Gerador`, `Base de Dados`, `Fluxo Organizado` e `Fluxo de Vendas`. Qualquer alteração no menu de abas deve incluir todas essas chaves.
4.  **SINTAXE DO DOCKER (esbuild):** Nunca use os operadores `??` e `||` na mesma expressão sem parênteses. 
    - ❌ **Errado:** `const x = a ?? b || c;`
    - ✅ **Correto:** `const x = (a ?? b) || c;`
    - *O build do Easypanel quebra se essa regra for ignorada.*
5.  **IMPORTS:** Não agrupe ou limpe os imports de ícones (`lucide-react`) de forma agressiva se não tiver certeza de que todos os ícones no arquivo ainda estão sendo usados.

---

### 📂 ESTRUTURA ATUAL DO PROJETO (Não alterar sem autorização)
- `SalomaoOrchestrator.tsx`: Orquestrador central com 5 abas.
- `AgentKnowledgeBase.tsx`: Gerencia o treinamento específico de cada agente.
- `BriefingSmartUpload.tsx`: Upload inteligente de documentos via Claude.
- `FunnelFlowchart.tsx`: Mapa visual do funil de vendas.

*Ao modificar estes arquivos, sempre peça ao desenvolvedor para confirmar se as outras abas continuam funcionando após o seu código ser aplicado.*
