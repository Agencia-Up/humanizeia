# Prints do tutorial "Como conectar meu WhatsApp"

**Publicado.** Estas imagens já estão ligadas ao artigo `conectar-whatsapp-qrcode`
(coluna `tutorial` em `support_knowledge_articles`) e aparecem no chat de suporte.

Todas saíram de `docs/help/source-screenshots-private/raw/` — a única fonte permitida,
listada no MANIFEST daquela pasta. Nenhuma veio de outro lugar da máquina.

## O que foi publicado

| arquivo | passo | recorte de | dado sensível |
|---|---|---|---|
| `01-abrir-integracoes.png` | Abrir Integrações | `050` | nenhum (recorte sem cabeçalho) |
| `02-instancias-whatsapp.png` | Aba "Instâncias do WhatsApp" | `052` | nenhum |
| `03-conectar-numero.png` | Botão "Conectar Número" | `052` | nenhum |
| `04-nome-conexao.png` | Campo "Nome da conexão" | `051` | nenhum |
| `05-gerar-qr-code.png` | Botão "Gerar QR Code" | `051` | nenhum |
| `06-escanear-qr-code.png` | QR Code na tela | `052` | **QR real tampado** |
| `07-aguardar-conexao.png` | "Aguardando leitura do QR Code..." | `052` | nenhum |

## Sanitização aplicada

- **Cabeçalho com nome e e-mail do dono da conta:** fica no topo das capturas
  originais (`051`, `052`). Todos os recortes começam abaixo dele, então o dado
  saiu por construção — não dependeu de tampar nada.
- **QR Code real de pareamento (`052`):** era um código de sessão de verdade.
  Foi coberto por um retângulo com a legenda "QR Code (exemplo)" antes de
  publicar. Nenhum pixel do código original sobrou.

## Imagem faltante

- **`08-conectado.png` — passo "Confirme que aparece Conectado".**
  Não existe print dessa etapa em `raw/`: as duas capturas da tela de instâncias
  (`051`, `052`) foram feitas com a conta ainda em "Nenhum número conectado
  ainda" (0 instâncias). O passo continua aparecendo no chat, com texto e um
  aviso discreto no lugar da foto — passo sem print não é escondido.
  Para completar: capturar a lista de instâncias com um número já conectado
  (etiqueta verde "Conectado"), tampar o número de telefone, e salvar aqui com
  esse nome.

## Observação de qualidade

`02` e `03` saíram de uma captura em que já havia um modal aberto, então o fundo
está levemente escurecido (o overlay da própria interface). Está legível e
correto, mas uma recaptura com a tela limpa deixaria o tutorial mais bonito.

## Se a tela mudar

Recapture, substitua o arquivo **com o mesmo nome** e ajuste o texto do passo em
`/administracao` → Base de Conhecimento (artigo `conectar-whatsapp-qrcode`).
Substituir, não acumular versão.
