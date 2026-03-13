

# Plano: Importador Universal de Listas de Contatos

## Objetivo
Adicionar um botão "Importar Arquivo" na aba **Listas** da página Extrator de Contatos que aceite **CSV, TXT e Excel (XLSX)**, normalize automaticamente os números para o padrão brasileiro e salve na lista escolhida.

## O que será feito

### 1. Criar componente `FileImportDialog`
Um novo dialog em `src/components/whatsapp/FileImportDialog.tsx` que:
- Aceita arquivos **.csv**, **.txt** e **.xlsx**
- Detecta automaticamente separador (`,`, `;`, `\t`)
- Identifica colunas de telefone e nome por headers em PT/EN (telefone, phone, numero, nome, name, etc.)
- Se não encontrar header, trata coluna 1 como telefone, coluna 2 como nome
- Normaliza todos os números para formato `55 + DDD + número`
- Remove duplicatas dentro do arquivo
- Mostra preview com contagem de válidos/inválidos
- Permite criar **nova lista** ou adicionar a uma **lista existente**
- Usa a lib **xlsx** (já popular, leve) para parsear Excel

### 2. Adicionar dependência `xlsx`
Instalar o pacote `xlsx` para suporte a arquivos Excel.

### 3. Integrar na página WhatsAppContacts
- Trocar o botão "Importar" existente (que abre `showAddContacts`) por um que abre o novo `FileImportDialog`
- Manter o botão "Adicionar" manual para quando o usuário está dentro de uma lista

### Fluxo do usuário
1. Clica em "Importar" na aba Listas
2. Seleciona ou arrasta um arquivo (CSV, TXT ou XLSX)
3. Sistema parseia, normaliza e mostra preview
4. Usuário escolhe lista destino (nova ou existente)
5. Clica "Importar" → contatos salvos no banco via `sanitize-contacts` edge function

### Detalhes técnicos
- O parsing de CSV/TXT é feito client-side (mesmo padrão do `CSVUploadDialog` existente em broadcast)
- Para XLSX, usa a lib `xlsx` para converter para array de objetos
- A inserção no banco usa a edge function `sanitize-contacts` já existente, que faz dedup contra o DB e normalização E.164
- O componente reutiliza padrões visuais do `CSVUploadDialog` existente (drag-drop, progress bar, preview table)

