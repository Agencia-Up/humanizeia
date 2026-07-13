# Auditoria DeepSeek: anuncios reais do Bruno/BNDV

Data: 2026-07-13

## Objetivo

Validar o Pedro v3 do piloto com o cerebro DeepSeek real, preservando o prompt
e o runtime do Pedro v3 e usando anuncios reais recentes do Carvalho/Bruno com
o estoque BNDV da conta de origem. Efeitos externos ficaram desligados; os
plans de CRM, handoff e notify foram validados no turno.

## Metodo

- Tres roteiros reais: HB20X com km/fotos/financiamento/visita/PII/humano;
  Fastback com objecao, detalhes, pivot, troca e visita; EcoSport com typo,
  fotos, mudanca de intencao e qualificacao.
- A entrada do anuncio foi carregada como `adContext`; as falas subsequentes
  foram reproduzidas por bloco de lead.
- A LLM recebeu apenas fatos de tool e redigiu todas as respostas. O engine
  validou proveniencia, grounding, PII e efeitos; ele nao redigiu lista,
  conducao, recuperacao comercial ou texto de venda.

## Resultado

Baseline: 45 violacoes no replay inicial de 27 turnos.

Replays finais:

| Cenario | Resultado | Evidencia principal |
|---|---|---|
| HB20X | PASS | anuncio exato, 5 fotos corretas, entrada/parcela, visita, PII opaco e handoff |
| Fastback | PASS | detalhe nao reativou anuncio, sedan hibrido aplicou filtro estrito, C4 Lounge ficou apenas como troca |
| EcoSport | PASS | typo `ecosporte` foi resolvido, foto do alvo certo, pivot para SUV, selecao, financiamento e visita coerentes |

No conjunto auditado, as violacoes verificadas cairam de 45 para 0: reducao de
100% dentro desta matriz reproduzivel. Isto nao e uma garantia matematica de
todos os dialogos possiveis; a prontidao para piloto controlado e estimada em
aproximadamente 90%, pois modelos reais ainda podem precisar de retry de
validacao em formulacoes fora do roteiro.

## Correcoes estruturais

1. Fatos do lead passam a sobreviver individualmente a uma mutacao lateral
   invalida: o preview de slots e atomico por fato validado, sem persistir
   palpite da LLM.
2. O filtro `hibrido` foi incorporado do entendimento ate a fonte de estoque.
   Pedido hibrido nunca recebe veiculo nao hibrido como se fosse equivalente.
3. Perguntas de detalhe/foto priorizam o ato atual e nao reativam filtro ou
   anuncio antigo. Se o detalhe nao existe na fonte, a LLM responde com
   transparencia e oferece uma unica proxima acao.
4. Veiculos de troca compostos preservam sua identidade declarada pelo lead
   (`C4 Lounge`), sem contaminar interesse de compra.
5. O auditor agora limita a consulta inicial de anuncios e registra tabela por
   turno com ato, tools, efeitos, slots, veiculo selecionado e feedback.
6. Blocos mistos de troca e compra isolam a clausula de compra antes da busca:
   um Onix informado para troca nao vaza para uma busca por faixa de preco.
7. Negacoes de cidade nao podem virar endereco de CRM e um fato extraido valido
   nao e descartado porque outra mutacao do mesmo bloco falhou no reducer.

## Relatorios de execucao

- `eval/reports/cross-agent-ad-audit-2026-07-13T03-39-13-577Z.md` - HB20X
- `eval/reports/cross-agent-ad-audit-2026-07-13T04-15-17-446Z.md` - Fastback
- `eval/reports/cross-agent-ad-audit-2026-07-13T03-44-44-563Z.md` - EcoSport

## Limites e proximo passo

O gateway DeepSeek usado somente pelo harness foi temporario e deve ser
removido apos a auditoria. Os relatorios de `eval/reports/` sao artefatos
locais e nao entram no commit. A proxima fase pode retomar CRM/handoff/follow-
up no piloto, mantendo esta matriz como regressao antes de promover producao.
