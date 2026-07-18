# Rastreabilidade 1:1 — origem -> tutorial

- **Prints na origem oficial:** 66  (`docs/help/source-screenshots-private/raw/`)
- **Prints usados:** 66 — **100%**, nenhum sobrou
- **PNG publicados:** 72 (alguns brutos rendem mais de um recorte)
- **Publicados sem referencia (orfaos):** 0
- **imageUrl quebrado:** 0

| print | tutorial | arquivo publicado |
|---|---|---|
| `001` | tela-inicial | `01-tela-inicial.png` |
| `002` | painel-geral | `02-lancar-venda.png` |
| `003` | painel-geral | `01-painel-geral.png` |
| `004` | painel-ao-vivo | `01-painel-ao-vivo.png` |
| `005` | pedro-crm | `01-kanban-pedro.png` |
| `006` | pedro-crm | `02-visao-lista.png` |
| `007` | pedro-relatorios | `01-resumo-executivo.png` |
| `008` | pedro-relatorios | `02-por-vendedor.png` |
| `009` | pedro-relatorios | `03-produtos-e-campanhas.png` |
| `010` | pedro-relatorios | `04-filtrar-periodo.png` |
| `011` | pedro-relatorios | `05-qualidade-nepq.png` |
| `012` | pedro-relatorios | `06-historico.png` |
| `013` | pedro-relatorios | `07-leads-sem-transferencia.png` |
| `014` | vendedores | `01-aba-vendedores.png` |
| `015` | pedro-formularios-meta | `01-formularios-meta.png` |
| `016` | pedro-conversas-ia | `01-conversa-do-agente.png` |
| `017` | pedro-conversas-ia | `02-filtrar-por-data.png` |
| `018` | feedbacks | `01-aba-feedbacks.png` |
| `019` | pedro-agente-ia | `01-abrir-agente-ia.png` |
| `020` | pedro-agente-ia | `02-editar-agente.png` |
| `021` | pedro-agente-ia | `03-horario-e-regras.png` |
| `022` | conectar-whatsapp | `04-escolher-qrcode.png` |
| `023` | conectar-whatsapp | `09-segunda-forma-nome.png` |
| `024` | conectar-whatsapp | `10-segunda-forma-qr.png` |
| `025` | vendedores | `02-cadastrar-vendedor.png` |
| `026` | feedbacks | `03-entrega-ao-gerente.png` |
| `027` | pedro-crm | `03-ficha-do-lead.png` |
| `028` | pedro-crm | `04-mudar-status.png` |
| `029` | feedbacks | `02-formulario-feedback.png` |
| `030` | pedro-crm | `05-editar-lead.png` |
| `031` | pedro-adicionar-lead | `01-adicionar-lead.png` |
| `032` | pedro-adicionar-lead | `02-escolher-origem.png` |
| `033` | follow-up-ia | `01-horario.png` |
| `034` | follow-up-ia | `02-mensagens.png` |
| `035` | follow-up-ia | `03-disparo.png` |
| `036` | follow-up-ia | `04-historico.png` |
| `037` | follow-up-ia | `05-detalhe-dos-disparos.png` |
| `038` | kanban-config | `05-arrastar-coluna.png` |
| `039` | kanban-config | `04-mover-coluna.png` |
| `040` | kanban-config | `06-arrastar-card.png` |
| `041` | marcos-crm | `01-kanban-marcos.png` |
| `042` | marcos-adicionar-lead | `01-adicionar-lead.png` |
| `043` | marcos-adicionar-lead | `02-origem-do-lead.png` |
| `044` | disparo-em-massa | `03-selecionar-leads.png` |
| `045` | disparo-em-massa | `05-marcar-para-disparo.png` |
| `046` | disparo-em-massa | `01-aba-campanhas.png` |
| `047` | disparo-em-massa | `04-acompanhar-envio.png` |
| `048` | disparo-em-massa | `02-listas-de-contatos.png` |
| `049` | importar-contatos | `02-importar-lista.png` |
| `050` | conectar-whatsapp | `01-abrir-integracoes.png` |
| `051` | conectar-whatsapp | `05-nome-conexao.png` |
| `052` | conectar-whatsapp | `07-escanear-qr-code.png` |
| `053` | integracoes | `02-outras-integracoes.png` |
| `054` | pixel-capi | `01-tela-pixel.png` |
| `055` | pixel-capi | `02-novo-pixel.png` |
| `056` | pixel-capi | `03-eventos-capi.png` |
| `057` | pedro-conversas | `01-lista-de-conversas.png` |
| `058` | pedro-conversas | `02-conversa-aberta.png` |
| `059` | kanban-config | `02-colunas-marcos.png` |
| `060` | kanban-config | `03-colunas-pedro.png` |
| `061` | kanban-config | `01-abrir-configuracoes.png` |
| `062` | dashboard-tv | `01-identidade-visual.png` |
| `063` | regras-automacoes | `02-relatorios.png` |
| `064` | regras-automacoes | `01-followup-e-transferencia.png` |
| `065` | responsaveis | `02-adicionar-responsavel.png` |
| `066` | responsaveis | `01-responsaveis.png` |

## Recortes extras (mesmo print, varios passos)

| print | tutorial | arquivo |
|---|---|---|
| `048` | importar-contatos | `01-aba-listas.png` |
| `050` | integracoes | `01-tela-integracoes.png` |
| `051` | conectar-whatsapp | `06-gerar-qr-code.png` |
| `052` | conectar-whatsapp | `02-instancias-whatsapp.png` |
| `052` | conectar-whatsapp | `03-conectar-numero.png` |
| `052` | conectar-whatsapp | `08-aguardar-conexao.png` |

## Sanitizacao aplicada

- Faixa de cabecalho (58px) cortada de toda captura de tela cheia: e onde aparece o e-mail de ACESSO da conta.
- QR Code real tampado em 2 imagens (`052` e `024`) — eram codigos de pareamento de verdade.
- Barra de tarefas do Windows, tooltip de URL do navegador e chrome do SO removidos onde apareciam.
- Nome e telefone MANTIDOS: o dono confirmou que sao dados de demonstracao.

## Observacao

`025` e `026` sao byte a byte identicos (mesmo MD5). Em vez de descartar, cada um entrou num tutorial diferente: `025` ilustra o cadastro do vendedor e `026` ilustra onde se define a entrega de feedbacks ao gerente — mesma tela, propositos didaticos distintos.