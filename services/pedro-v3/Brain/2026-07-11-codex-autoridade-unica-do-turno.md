# Auditoria estrutural: autoridade unica do turno

## Incidente real

Bloco do lead: `sei sim / quero agendar visita / pra segunda`.

O estado anterior continha um veiculo selecionado. Antes desta correcao, dois mecanismos deterministas atuavam antes do brain:

1. `parseOrdinal` lia `segunda` como item 2 da lista.
2. `extractLeadSlots` persistia `select_vehicle_focus` antes de a LLM decidir o ato.

O frame chegava contaminado ao brain. A primeira compreensao ainda declarava `select` usando a evidencia `quero agendar visita`, e a validacao antiga aceitava qualquer quote existente no bloco sem conferir coerencia semantica. O estado antigo vencia a mensagem atual.

## Contrato corrigido

No `central_active`/LLM-first:

1. O bloco atual e soberano.
2. A LLM declara o ato atual (`primaryIntent` + capability + evidence).
3. Evidencia precisa existir no bloco e ser semanticamente compativel com o ato.
4. Memoria, funil e veiculo selecionado sao apenas contexto. `selected_vehicle` usa `subjectSource=memory`.
5. Resolvedores deterministas so aterram alvo/ordinal depois que o ato da LLM foi aceito.
6. Extratores podem persistir fatos do lead, mas nao podem decidir selecao de veiculo no LLM-first.
7. Policy que encontra contradicao devolve feedback ao mesmo brain; nao troca o assunto nem persiste a decisao rejeitada.
8. Handoff autonomo nao e confundido com pedido explicito de humano. Pedido humano exige evidencia semantica propria.

O caminho legacy/shadow preserva a selecao determinista historica e fica isolado do piloto.

## Correcoes

- `parseOrdinal`: uso temporal de `segunda` (`pra/na segunda`, `segunda-feira`) nao e ordinal.
- `lead-extraction`: selecao pre-brain desativada somente no LLM-first; visita e dia sao extraidos corretamente.
- `turn-understanding`: validacao semantica de visita, selecao e pedido humano; conflito gera retry bounded.
- `central-engine`: foco so muda depois de selecao aceita pela LLM; resolvedor canonico continua aterrando modelo/ordinal.
- `policy-engine`: `diaHorario` passou a ter completude semantica; dia conhecido nao bloqueia pergunta de horario.
- `openai-agent-brain`: protocolo explicita soberania do bloco atual e continuidade correta do agendamento.
- Promessas de transferencia/agendamento sem efeito executavel sao rejeitadas; a LLM reautora sem o engine conduzir por ela.
- Observabilidade: `authorityRetries` e `authoritySemanticIssues` no `decision_final`.

## Provas

- F2.41: 20 OK, incluindo a reproducao exata do incidente.
- F2.48: 65 OK.
- F2.50: 61 OK.
- F2.37: 29 OK (foto continua dependente do ato declarado pelo brain).
- `test:all`: EXIT 0.
- `tsc --noEmit`: EXIT 0.
- Smoke real F2.51, gpt-4.1-mini, efeitos OFF: PASS.

Smoke real:

- T1 `quero SUV automatico`: `search_stock`, lista real.
- T2 `gostei do primeiro`: `select_vehicle`, Duster selecionado.
- T3 `sei sim / quero agendar visita / pra segunda`: `visit`, mesmo Duster mantido, zero tool comercial, resposta LLM `Qual horario fica melhor pra voce na segunda?`.

## Limite intencional

Executores de seguranca ainda materializam efeitos aterrados (por exemplo, envio das fotos ja autorizadas) e respostas tecnicas de ultima linha. Eles nao escolhem o ato comercial nem podem substituir o assunto atual. A autoria normal da conversa permanece `brain_final`/`brain_retry`.
