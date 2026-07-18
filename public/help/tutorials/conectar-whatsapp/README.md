# Prints do tutorial "Como conectar meu WhatsApp"

Coloque os arquivos **nesta pasta**, com **exatamente estes nomes**. O chat de
suporte monta a URL a partir daqui (`/help/tutorials/conectar-whatsapp/...`),
então basta soltar os arquivos e fazer o Rebuild — não precisa mexer em código
nem no banco.

| Arquivo | Tela que deve aparecer no print |
|---|---|
| `01-menu-integracoes.png` | Menu lateral com "Sistema" aberto e "Integrações" em destaque |
| `02-aba-instancias.png`   | Página de Integrações mostrando a aba **Instâncias do WhatsApp** |
| `03-conectar-numero.png`  | O botão verde **Conectar Número** no canto superior direito |
| `04-escolher-qrcode.png`  | O diálogo com a opção **WhatsApp (QR Code)** |
| `05-nome-da-conexao.png`  | O campo **Nome da conexão** preenchido |
| `06-gerar-qrcode.png`     | O botão **Gerar QR Code** |
| `07-escanear-qrcode.png`  | O QR Code na tela (borre/censure o código antes de publicar) |
| `08-conectado.png`        | O status **Conectado!** / etiqueta verde "Conectado" |

## Regras

- **Formato:** PNG. Largura recomendada ~1200px (o painel reduz e o clique amplia).
- **Não precisa ter todos.** O passo sem print continua aparecendo no chat, com
  um aviso discreto no lugar da imagem. Nunca escondemos o passo por falta de
  foto.
- **Censure dado real** antes de salvar: número de telefone, nome de cliente,
  e-mail, o próprio QR Code. Este conteúdo é global — todos os clientes veem.
- **Nada de caminho local de máquina** (`C:\Users\...`): o `imageUrl` no banco
  aponta sempre para este caminho público do app.

## Se um passo mudar de lugar na plataforma

Tire o print novo, **substitua o arquivo com o mesmo nome** e atualize o texto
do passo em `/administracao` → Base de Conhecimento (artigo
`conectar-whatsapp-qrcode`). Mesma regra do passo a passo em texto: substitui,
não acumula versão.

## Onde está definido

- Passos e legendas: coluna `tutorial` (jsonb) do artigo `conectar-whatsapp-qrcode`
  em `support_knowledge_articles`.
- Registro em git: `supabase/seeds/support_tutorial_conectar_whatsapp_20260718.sql`.
- Render: `src/components/support/TutorialSteps.tsx`.
