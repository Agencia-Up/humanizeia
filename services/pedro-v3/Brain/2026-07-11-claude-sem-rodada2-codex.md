# F2.48 rodada 2 (auditoria Codex) — proveniência campo-a-campo, decisão stale, denies de conversa, pushName

**Data:** 2026-07-11 · **Autor:** Claude (executor) · **Status:** ⛔ **NADA commitado/deployado; flags inalteradas
(CRM OFF).** Correções dos 4 achados implementadas e provadas OFFLINE; smokes reais com análise HONESTA abaixo.

## Achados do Codex → correções (todas com teste)

**P0-1 Proveniência aceita fatos inventados** → `slot-provenance.ts` REESCRITO:
- Objeto composto exige proveniência de **TODOS os campos definidos** (a prova do Codex vira teste [C2-1]:
  "meu carro é 2020" NÃO sustenta Ferrari Roma 99k; objeto completo no bloco passa [C2-2]).
- **Booleano NUNCA nasce de menção ao objeto** ("aceito troca na compra" ≠ possuiTroca=true [C2-3]): só resposta
  booleana curta vinculada à pergunta pendente do MESMO slot.
- Número exige o VALOR no bloco (não o tema: "como funciona a entrada?" ≠ entrada=5000 [C2-4]).
- `formaPagamento` exige a raiz do MÉTODO declarado (financ/vista/consorcio/troca).
- Preferência de projeto documentada: fatos vêm da EXTRAÇÃO; a LLM não é segunda autora.

**P0-2 Decisão stale ainda respondia** → no cap de proveniência esgotado, `break`: a DECISÃO INTEIRA (texto/
efeitos/mutações autorados com entendimento de outro turno) é descartada — nunca renderiza ([C2-R1/R2]: 3
insistências → texto stale não enviado, mutação não aplicada). Observabilidade `provenanceExhausted`.

**P0-3 Conversa ruim nos smokes** → 2 denies de OUTPUT novos (validação, não handler):
- `promisesHumanHandoff`: promessa/oferta de encaminhar a consultor/vendedor SEM efeito `handoff`/`notify_seller`
  no plano → deny + reescrita conduzindo ([C2-H1]). Quando a Fase 3 materializar o handoff, o predicado já
  exige o efeito (checa proposedEffects).
- `hasDoubleActionQuestion`: pergunta com DUAS ações ("fotos OU condições?") → deny + reescrita com UMA ação
  ([C2-D1]); disjuntiva de atributo ("manual ou automático?") segue permitida. O template de LISTAGEM do próprio
  engine ensinava a dupla — corrigido também.
- Smoke gate endurecido: asserts de zero dupla e zero promessa sem efeito.

**P1 pushName não-sanitizado** → `sanitizeLeadNameHint`: remove emoji/símbolos ("Douglas 🚗"→"Douglas" [C2-5/7]),
rejeita nome COMERCIAL ("Icom Motors"/"Auto Center" → placeholder promovível [C2-6/8]); aplicado no builder
(bridge→ingest→CRM testado).

## Melhorias decorrentes (mesma rodada, causas achadas nos smokes)
- **Normalização mecânica de citação**: resposta CURTA (≤30 chars) SEM capability de ação e SEM mutação de slot
  → a evidência É o bloco por definição; o engine normaliza a citação em vez de gastar retries (observável
  `evidenceNormalized`; o cérebro segue dono do SIGNIFICADO). Com ação declarada, o retry prescritivo continua.
- Feedback do deny de proveniência agora PRESCRITIVO (JSON literal da quote esperada) — o gpt-4.1-mini copiava.
- Aceite de oferta de foto: "Sim" à pergunta de foto do PRÓPRIO agente (pergunta única por design) + alvo
  resolvido → autoriza o envio (executor determinístico manda a foto do selected). Afirmação curta nunca é
  troca de assunto (carryover do selected não é negado por isTopicChange lixo).
- Preço da ÚLTIMA OFERTA RENDERIZADA é ecoável (RenderedOfferItem.preco, grounding de memória R13 Inc2/G já
  previa) — matava um deny-loop de condução.
- Prompt: regra de RESPOSTA CURTA (interpretar como resposta à última pergunta; nunca re-perguntar).
- Testes de contrato antigo atualizados (F2.21 [13/14], F2.39 T5R+scripts, F2.40 G1/G-2100, F2.43 J-1, ~8 scripts
  com pergunta dupla): os invariantes protegidos permanecem; só as RESPOSTAS scriptadas obedecem o contrato novo.

## Gates OFFLINE (tudo verde)
`test:f248` **54 OK / 0** (42 + 12 adversariais do Codex) · `tsc` EXIT 0 · **`test:all` EXIT 0 (2216 OK / 0)** ·
`git diff --check` limpo · zero OpenAI nos testes.

## Smokes reais (gpt-4.1-mini + prompt/estoque reais, efeitos OFF) — análise HONESTA
9 execuções na rodada (≈220 chamadas). Resultado:
- **Invariantes FACTUAIS da missão: 100% em TODOS os runs** — possuiTroca `unknown` em todos os turnos (fantasma
  morto), entrada known:0, parcela 1200, nome Douglas, faixaPreco intacta, zero slot inventado, compose=0,
  **zero pergunta dupla ENVIADA, zero promessa de consultor ENVIADA** (os denies seguram; nada disso chega ao lead).
- **Fluidez (zero recovery visível em todo turno ≥3): 1 run PASS completo; os demais tiveram 1-2 turnos em
  recovery HONESTO** (ex.: "De qual carro você quer as fotos?") ou fallback genérico, em turnos variáveis
  (T3/T4/T7), cada run com um modo de falha DIFERENTE do modelo (re-classificação do "Sim", invenção de valor
  de parcela na condução — negada corretamente 5×, promessa de foto em turno de seleção). Ou seja: o modelo
  erra de formas variadas; as validações seguram TODAS; o custo é o turno degradar para recovery.
- **2 PASS consecutivos NÃO alcançados** por essa variância — declaro em vez de maquiar. As respostas ruins NÃO
  chegam ao lead; a degradação é honesta e observável (provenanceRetries/droppedSlotMutations/feedbacks logados).

**Decisão em aberto p/ Codex/dono (trade-off explícito):**
(a) aceitar recovery honesto ocasional como degradação válida do gate (os invariantes factuais é que protegem o
CRM — objetivo da missão); (b) subir o modelo/temperatura só nos RETRIES pós-deny (custo maior, provável
convergência); (c) mais uma rodada de prompt-tuning dirigida pelos feedbacks capturados. Os relatórios de todos
os runs estão em `eval/reports/sem-smoke-*.md` (não versionados).

## Arquivos tocados na rodada 2
`slot-provenance.ts` (rewrite) · `central-engine.ts` (break stale + 2 denies + normalização de citação + template
de listagem + feedback prescritivo + obs) · `turn-understanding.ts` (acceptsAgentPhotoOffer + carryover em
afirmação curta) · `policy-engine.ts` (preço da oferta ecoável) · `crm-write.ts` (sanitizeLeadNameHint/BUSINESS_RX)
· `openai-agent-brain.ts` (prompt resposta curta) · `eval/run-sem-smoke.ts` (asserts novos + feedbacks) ·
`tests/run-f2-48` (+12 casos) · testes de contrato atualizados (F2.21/39/40/43 + scripts de pergunta dupla) ·
`run-central-gate-offline.ts` (caso (e): extração é a autoridade do valor).

**PARADO — aguardando decisão do Codex/dono sobre o gate dos smokes. Sem commit/push/deploy/SQL. A linha real
do CRM do lead de teste segue com `trade_in_vehicle="não possui"` antigo — limpar manualmente antes do aceite.**

## Rodada 3 — auditoria Codex e convergência real (2026-07-11)

### Causas adicionais encontradas
- A validação da resposta recebia `ctx.state` anterior ao turno, enquanto frame e extração já usavam `contextState`.
  Isso permitia à fala afirmar entrada positiva no mesmo turno em que `Não` acabara de produzir `entrada=0`.
- Em aceite curto da oferta de fotos, um `subjectValue` especulativo do cérebro podia apagar o veículo selecionado.
- O `gpt-4.1-mini` variava em drafts malformados ou repetia uma saída negada. O caminho normal continua no mini;
  somente retry após feedback de policy pode usar `PEDRO_V3_OPENAI_RETRY_MODEL` (default de produção: `gpt-4.1`).
- Duas guardas amplas rejeitavam despedidas corretas: `continuidade` era tratada como handoff e `contato` como coleta.
  Ambas foram estreitadas para dano real (promessa humana sem efeito, pergunta/coleta efetiva).

### Invariantes finais
- Resposta é validada contra os slots já extraídos no próprio turno.
- Aceite inequívoco de foto preserva o `selectedVehicle`; executor apenas resolve/envia mídia aterrada.
- Retry forte é bounded e acionado só após deny; não autoriza tool nem escreve resposta pelo engine.
- Despedida isolada é redigida pela LLM, sem pergunta; termos naturais como contato/continuidade são permitidos.

### Provas
- `test:f248`: **62 OK / 0**; `test:f214`: **19 OK / 0**; `tsc`: EXIT 0.
- `test:all`: EXIT 0, zero regressão.
- Smoke real completo, efeitos OFF, `gpt-4.1-mini` + `gpt-4.1` apenas em retries: **2 PASS consecutivos**:
  `sem-smoke-2026-07-11T02-21-21-727Z.md` e `sem-smoke-2026-07-11T02-23-53-135Z.md`.
- Nos dois: `compose=0`, zero technical fallback/recovery comercial, entrada=0, parcela=1200, troca unknown,
  veículo selecionado preservado, fotos corretas e despedida `brain_final`.

### Fechamento estrito de autoria
- O lock de entendimento agora permite uma única correção contextual: aceite inequívoco da oferta de fotos pode
  mudar para `request_photos/send_photos` usando a evidence literal curta. Mudanças arbitrárias continuam bloqueadas.
- Seleção da última oferta chega ao cérebro como sinal de turno; ele acolhe/oferece fotos antes de iniciar o funil.
- A autorização do `send_media` em resposta curta exige simultaneamente decisão explícita da LLM, aceite contextual e
  alvo selecionado resolvido. O gate real passou a reprovar qualquer `deterministic_photo` nesse turno.
- Afirmações factuais são validadas sentença a sentença; uma pergunta posterior não esconde mais uma afirmação falsa.
- Resposta a entrada/parcela deve acolher a dimensão informada antes de avançar, sem o engine escolher a redação.
- Smoke final: `sem-smoke-2026-07-11T03-02-48-994Z.md` PASS, T4=`brain_final`+`send_media`, T7 acolhe
  entrada zero, T9 acolhe parcela, T11=`brain_final`; zero fallback/recovery comercial.
