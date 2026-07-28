# FASE 3 — Projeção canônica de conversas das instâncias de IA (DESENHO v2)

> Status: REVISADO conforme os 10 pontos do dono (28/07). Migration em rascunho
> (`...20260728190000_fase3_ai_conversation_index.sql.DRAFT`) — **não aplicada**.
> Fase 2 revisada está commitada localmente (`c03c2081`), **sem push**.

## Respostas aos 10 pontos da revisão

### 1. Identidade com instance_id NULL → adoção/merge atômico
`UNIQUE NULLS NOT DISTINCT` garante unicidade, não transição — por isso existe a
operação **`ai_conv_index_adopt_instance`**: roda sob `pg_advisory_xact_lock`
do par (tenant, telefone) — duas transações do MESMO contato serializam,
contatos diferentes não se bloqueiam — e:
- órfã (NULL) existe e linha da instância NÃO existe → a órfã **vira** a linha
  da instância (UPDATE na mesma linha; nada é copiado);
- as duas existem → **merge determinístico**: vencedora = a COM instância;
  soma `message_count`, `first_seen_at = least`, `last_* = maior timestamp`,
  `coalesce` de CRM/nome/foto; a órfã é apagada na MESMA transação.
Todo alimentador que conhece a instância chama a adoção antes do upsert.
**Teste NULL→instância** (roda na aprovação da F3, com ROLLBACK):
1. upsert órfã (v3 sem lead) → 1 linha instance NULL;
2. upsert com instância conhecida → adoção → 1 linha, instance preenchida,
   contadores somados, `crm_*` preservado;
3. concorrência: 2 transações (uma órfã, uma com instância) sob o advisory
   lock → resultado final = 1 linha (o lock serializa; sem corrida).

### 2. Nono dígito: NUNCA por suposição
- **Gateway (fonte oficial, `_shared/pedro-v2/phone.ts` → `normalizeBrazilPhone`)**:
  só dígitos; `55…`≥12 mantém; 10/11 dígitos prefixa `55`; resto intocado.
  (O 9º dígito só existe no gateway em `phoneVariants`, usado para CASAMENTO,
  nunca para armazenar.)
- **SQL novo (`logos_phone_canonical`)**: espelho literal da regra acima.
  A versão anterior deste DRAFT inseria o 9º dígito — **removido**.
- **Validação com dados reais**: `ai_crm_leads` vive em 13 dígitos (1.244) e
  12 (151); espelho conferido caso a caso:

| Entrada | Canônico |
|---|---|
| `5512981112233` | `5512981112233` |
| `12981112233` (sem DDI) | `5512981112233` |
| `1233221122` (fixo sem DDI) | `551233221122` |
| `551233221122` | `551233221122` |
| `+55 (12) 98111-2233` | `5512981112233` |
| `4915123456789` (estrangeiro) | `4915123456789` (intocado) |
| `5512` (lixo curto) | `5512` (intocado; barrado pelo guard) |
| `''` | `NULL` |

- Consequência aceita: o MESMO contato aparecendo com e sem 9º dígito gera
  identidades distintas — resolvido no VÍNCULO (variantes) e na adoção; nunca
  alterando o número armazenado.
- **Guard dos alimentadores** (`logos_phone_plausible`, 8–15 dígitos): a
  wa_inbox histórica tem 86k+54k linhas com "telefones" de 18/23 dígitos (ids
  de grupo/broadcast de instâncias de vendedor). Nas linhas de IA medimos **0**
  — o guard existe pra isso nunca virar identidade.

### 3. Vínculo CRM não usa só telefone
Prioridade implementada: **tenant → instance_id → telefone canônico → agent_id**.
- Lead Pedro COM `instance_id`: adota/vincula a linha daquela instância.
- Lead Pedro SEM instância confiável: vincula **somente** se existir UMA única
  candidata sem vínculo; 2+ candidatas → `crm_match_status='ambiguous'` e
  NENHUMA escolha silenciosa (resolução humana/F6).
- Coluna `crm_match_status`: `linked | orphan | ambiguous`.

### 4. `routing.to_addr` VALIDADO com dados reais
221 rotas em prod: **213/213 com lead = telefone do LEAD; 0 = número da
instância** (8 restantes são órfãs sem lead — sem referência para comparar).
Exemplos anonimizados: `5511*****07 = lead 5511*****07 ✓`, `5519*****90 ✓`,
`5519*****55 ✓`, `5512*****53 ✓`, `5511*****19 ✓`. O routing tem UMA linha por
conversa (o campo não muda por direção da mensagem) — é o endereço do cliente.
Seleção por direção é desnecessária; ainda assim o outbox só usa o to_addr
quando a rota existe (sem rota → não mexe em nada).

### 5. Eventos fora de ordem
Preview/direção/última mensagem só avançam com `event_at` **estritamente
maior**; empate mantém o existente (determinístico: primeiro a gravar naquele
instante vence). `created_at` imutável; `first_seen_at = least(...)`;
`updated_at = now()` em toda escrita. Vale no upsert E no merge da adoção.
**Teste fora-de-ordem** (na aprovação): aplicar eventos T3, T1, T2 → preview
final = T3; count = 3; first_seen = T1.

### 6. Deduplicação entre fontes (contagem)
Estratégia explícita: **UMA fonte contadora — `wa_inbox`**. Pós-Fase 2 ela
captura TODO o privado da linha de IA (o persist roda ANTES de qualquer decisão,
inclusive no caminho ativo), com 1 linha real = 1 insert (índice único) = 1
disparo = 1 incremento. Os alimentadores do V3 passam `p_count_delta=0`
sempre: garantem existência (órfãs) e preview, **nunca** contam. O eco fromMe
já é deduplicado na F2 (providerMessageId/conteúdo). Histórico pré-F2 (conversas
v3 antigas sem wa_inbox): `message_count` recalculado no backfill (F7) com
união dedupada. Ledger de eventos foi avaliado e rejeitado: mais peças móveis
para o mesmo invariante que o índice único + fonte única já garantem.

### 7. Outbox não é prova isolada
Trigger dispara **apenas na transição `status → 'succeeded'`** (receipt real do
provedor; `dispatched_at` sozinho é carimbo de claim, não de envio), exige rota
resolvida (tenant+conversa→to_addr) e roda com `p_create=false`: **nunca cria
conversa, nunca conta** — só atualiza o preview de uma identidade existente.
Falha/pendência/retry: nenhum efeito.

### 8. RLS e SECURITY DEFINER (checklist vinculante para as RPCs da F4)
`SET search_path` fixo; `auth.uid()` obrigatório; tenant SEMPRE resolvido pelo
vínculo real (`get_seller_master_user_id`/gerente-membro/master) — **jamais
tenant_id vindo do cliente como autorização**; papéis master/gerente/vendedor
idênticos às RPCs atuais; `REVOKE` de PUBLIC/anon em tudo; `GRANT EXECUTE`
mínimo (authenticated nas RPCs de leitura; service_role no restante). A tabela
tem RLS **fechada** (zero policy de leitura) e as funções internas têm EXECUTE
revogado de authenticated.

### 9. Triggers nunca derrubam a escrita operacional
Todo alimentador tem `EXCEPTION WHEN OTHERS` → grava em
**`ai_conv_index_deadletter`** (origem, ref, tenant, erro — durável e visível)
e retorna; se até o deadletter falhar, `RAISE WARNING` (log, nunca silêncio,
nunca aborta o INSERT operacional). **`ai_conv_index_repair()`** reprocessa a
fila de forma idempotente (marca `repaired_at`; pode rodar N vezes).

### 10. Marcos e demais fontes
O vínculo reconhece **as duas origens**: `ai_crm_leads` (pedro, com prioridade
de instância) e `crm_leads` (marcos, candidata única apenas — Marcos não tem
instância). `crm_source` marca a origem sem misturar os CRMs; a projeção
continua sendo SÓ de linhas de IA (`wa_instances.seller_member_id IS NULL`).

## Schema final
Ver DRAFT. Resumo: `ai_conversation_index` (identidade UNIQUE NULLS NOT
DISTINCT tenant+instance+fone canônico; preview; contadores; `crm_lead_id/
crm_source/crm_match_status`; `origem`) + `ai_conv_index_deadletter` +
funções `logos_phone_canonical`, `logos_phone_plausible`, `ai_conv_index_lock`,
`ai_conv_index_adopt_instance`, `ai_conv_index_upsert`, 5 triggers
(wa_inbox, v3_inbox, v3_outbox, link pedro, link marcos), `ai_conv_index_repair`.

## Crescimento estimado
Hoje: **209 identidades válidas** nas linhas de IA (0 lixo) + 216 conversas v3
(sobrepostas em grande parte). Novas: 11/30d medidas na wa_inbox + v3 dobrando
pós-rollout (~100/mês). Projeção conservadora: **< 5 mil linhas/ano** com o
dobro dos clientes — tabela minúscula; índices cobrem qualquer escala plausível.

## Plano de EXPLAIN ANALYZE (entrega da F4)
1. Lista: `SELECT … FROM ai_conversation_index WHERE user_id=$1 ORDER BY
   last_message_at DESC LIMIT 50` (e keyset `AND last_message_at < $2`) —
   esperado Index Scan em `ai_conv_index_list`.
2. Órfãs: `WHERE user_id=$1 AND crm_lead_id IS NULL` — Index Scan parcial.
3. Timeline v2 por identidade (wa_inbox via índice funcional existente + v3
   por conv_ids) — mesmos planos já exercitados pelas RPCs atuais.
Executar com os 5 tenants exigidos (Avant, Golden, iCOM, Mônaco, WA) e anexar
os planos reais na entrega da F4, com contagens antes/depois por tenant.

## Riscos e rollback
- Riscos: trigger em tabelas quentes (mitigado: corpo try/deadletter, custo
  O(1), 28 msgs/dia hoje); dupla identidade com/sem 9º dígito (aceito, ponto 2;
  resolvido no vínculo/adoção); merge apaga a órfã (mitigado: mesma transação,
  advisory lock, determinístico).
- Rollback completo: `DROP TRIGGER` (5) + `DROP TABLE ai_conversation_index,
  ai_conv_index_deadletter` + `DROP FUNCTION` (7) — nada fora da projeção é
  tocado; as RPCs atuais não dependem dela até a F4.
