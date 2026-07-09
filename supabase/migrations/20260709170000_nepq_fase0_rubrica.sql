-- ============================================================================
-- NEPQ · Fase 0 — Fundação (rubrica versionada + notas por dimensão)
-- REUSA o Feedback Brain: enums feedback_* (status/qualidade/veredito), cap+custo
-- (feedback_cost_gate/record + feedback_config.cap_*), alertas (feedback_alertas),
-- feed do José (feedback_qualidade_por_campanha), ingestão (ingestor.ts). NÃO cria
-- stack nepq_* paralelo. Aditiva. RLS multi-tenant espelhando feedback_conversas
-- (SELECT por tenant; escrita só via service_role, como no resto do brain).
-- ============================================================================

-- 1) Rubrica versionada como DADO (editável sem deploy) ----------------------
create table if not exists public.feedback_rubricas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,                              -- null = rubrica global padrão
  slug        text not null,
  framework   text not null default 'nepq',
  ativa       boolean not null default false,
  definicao   jsonb not null,                    -- dimensões, pesos, critérios, faixas
  created_by  uuid,
  created_at  timestamptz not null default now()
);
-- Um slug por escopo (global tratado com sentinela p/ NULL não duplicar).
create unique index if not exists uq_feedback_rubricas_slug_escopo
  on public.feedback_rubricas (slug, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- Uma rubrica ativa por (framework, escopo) — evita duas ativas concorrentes.
create unique index if not exists uq_feedback_rubricas_uma_ativa
  on public.feedback_rubricas (framework, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ativa;

comment on table public.feedback_rubricas is
  'Rubrica de análise (ex.: NEPQ) como dado versionado. tenant_id null = padrão global; linha própria do tenant sobrescreve. Editável sem deploy.';

alter table public.feedback_rubricas enable row level security;
drop policy if exists feedback_rubricas_read on public.feedback_rubricas;
create policy feedback_rubricas_read on public.feedback_rubricas
  for select using (
    tenant_id is null
    or tenant_id = public.resolve_billing_owner_user_id(auth.uid())
  );

-- 2) Notas por dimensão (normalizada p/ radar/rollup da Fase 4) --------------
create table if not exists public.feedback_dimensoes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  analise_id   uuid not null references public.feedback_conversas(id) on delete cascade,
  vendedor_id  uuid,
  dimensao_cod text not null,                    -- A, B1..B5, C, D, E1..E4
  nota         int  not null check (nota between 0 and 4),
  created_at   timestamptz not null default now()
);
create index if not exists idx_feedback_dimensoes_vend
  on public.feedback_dimensoes (tenant_id, vendedor_id, dimensao_cod, created_at);
create index if not exists idx_feedback_dimensoes_analise
  on public.feedback_dimensoes (analise_id);

comment on table public.feedback_dimensoes is
  'Notas 0-4 por dimensão NEPQ de cada análise (FK feedback_conversas). Populada na Fase 1; alimenta radar/rollup.';

alter table public.feedback_dimensoes enable row level security;
drop policy if exists feedback_dimensoes_read on public.feedback_dimensoes;
create policy feedback_dimensoes_read on public.feedback_dimensoes
  for select using (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));

-- 3) Auditoria: cada análise registra a rubrica usada (aditivo, nullable) ----
alter table public.feedback_conversas
  add column if not exists rubrica_id uuid references public.feedback_rubricas(id);

-- 4) Seed da rubrica NEPQ v1 (global, ativa) --------------------------------
-- Redação PRÓPRIA da LOGOS inspirada nos princípios públicos do NEPQ (não copia
-- scripts proprietários). Atribuição do método só institucional; a IA nunca fala
-- como se fosse o autor. Pesos somam 100. Escala 0-4 por dimensão.
insert into public.feedback_rubricas (tenant_id, slug, framework, ativa, definicao)
select null, 'nepq-auto-whatsapp-v1', 'nepq', true, $json$
{
  "metodo": "NEPQ",
  "atribuicao_metodo": "metodologia NEPQ, criada por Jeremy Miner (uso institucional apenas)",
  "contexto_ia": "Analista sênior treinado no método NEPQ avaliando atendimento automotivo por WhatsApp em PT-BR. Vender sem pressão: o cliente se convence sozinho; o vendedor pergunta e ouve mais do que fala (~70-80% do cliente falando); tom neutro e curioso; objeção é sinal para perguntar melhor, não rejeição. A nota é hipótese — a verdade é o desfecho (venda > lead qualificado > sinal). Toda nota exige evidência (trecho da conversa).",
  "escala": { "min": 0, "max": 4 },
  "score_geral_max": 100,
  "faixas_semaforo": { "verde": [70, 100], "amarelo": [45, 69], "vermelho": [0, 44] },
  "dimensoes": [
    { "cod": "A",  "nome": "Conexão", "peso": 8,
      "criterio": "Baixou a guarda do lead, personalizou (nome, veículo de interesse) e evitou despejar preço/ficha logo de cara.",
      "ancoras": { "0": "Foi direto a preço/ficha, impessoal ou robótico.", "2": "Cumprimentou, mas pouca personalização.", "4": "Criou rapport real, chamou pelo nome, conectou ao interesse." } },
    { "cod": "B1", "nome": "Situação", "peso": 10,
      "criterio": "Mapeou o contexto real: uso do carro, troca, prazo, quem decide.",
      "ancoras": { "0": "Não perguntou nada do contexto.", "2": "Perguntou 1-2 pontos soltos.", "4": "Mapeou uso, troca, prazo e decisor." } },
    { "cod": "B2", "nome": "Consciência do problema", "peso": 12,
      "criterio": "Fez o lead verbalizar a dor/necessidade por trás da compra.",
      "ancoras": { "0": "Só falou de produto, ignorou a dor.", "2": "Tocou na necessidade superficialmente.", "4": "Fez o lead expressar a dor real." } },
    { "cod": "B3", "nome": "Consciência da solução", "peso": 8,
      "criterio": "Explorou o que o lead já tentou/considerou, posicionando-se como consultor.",
      "ancoras": { "0": "Não explorou alternativas do lead.", "2": "Perguntou de leve.", "4": "Entendeu o histórico e atuou como consultor." } },
    { "cod": "B4", "nome": "Consequência", "peso": 10,
      "criterio": "Fez o lead perceber o custo de não resolver / a urgência genuína.",
      "ancoras": { "0": "Nenhuma noção de consequência.", "2": "Mencionou urgência genérica.", "4": "Lead percebeu o custo de não agir." } },
    { "cod": "B5", "nome": "Qualificação", "peso": 12,
      "criterio": "Checou capacidade real (entrada, financiamento, prazo) sem constranger.",
      "ancoras": { "0": "Não qualificou.", "2": "Perguntou preço/entrada de forma seca.", "4": "Qualificou capacidade com naturalidade." } },
    { "cod": "C",  "nome": "Transição / Apresentação", "peso": 8,
      "criterio": "Só apresentou o veículo/oferta depois de descobrir, conectando à dor mapeada (não catálogo genérico).",
      "ancoras": { "0": "Jogou catálogo genérico logo de início.", "2": "Apresentou com pouca conexão à dor.", "4": "Apresentação sob medida à dor descoberta." } },
    { "cod": "D",  "nome": "Compromisso / Próximo passo", "peso": 10,
      "criterio": "Conduziu a um próximo passo claro (visita, proposta, test drive) sem pressão.",
      "ancoras": { "0": "Conversa morreu sem próximo passo.", "2": "Sugeriu algo vago ('qualquer coisa chama').", "4": "Fechou próximo passo concreto e combinado." } },
    { "cod": "E1", "nome": "Tonalidade & pressão", "peso": 4,
      "criterio": "Tom curioso/consultivo vs. empurrão/robótico.",
      "ancoras": { "0": "Pressão ou robótico.", "2": "Neutro, sem calor.", "4": "Curioso e consultivo." } },
    { "cod": "E2", "nome": "Escuta / proporção de fala", "peso": 6,
      "criterio": "Fez o lead falar mais (meta ~70-80% do cliente). Heurística: razão de caracteres/mensagens lead vs. vendedor.",
      "ancoras": { "0": "Vendedor monopolizou a fala.", "2": "Equilibrado.", "4": "Lead falou a maior parte." } },
    { "cod": "E3", "nome": "Tratamento de objeção", "peso": 8,
      "criterio": "Diante de 'tá caro'/'vou pensar', perguntou para entender a objeção real em vez de empurrar ou desistir.",
      "ancoras": { "0": "Empurrou ou desistiu.", "2": "Respondeu raso.", "4": "Perguntou e dissolveu a objeção real." } },
    { "cod": "E4", "nome": "Ritmo de resposta", "peso": 4,
      "criterio": "Tempo até a 1a resposta e vazamento por demora.",
      "ancoras": { "0": "Demorou horas/dias ou não respondeu.", "2": "Respondeu com alguma demora.", "4": "Respondeu rápido e manteve o ritmo." } }
  ]
}
$json$::jsonb
where not exists (
  select 1 from public.feedback_rubricas where slug = 'nepq-auto-whatsapp-v1' and tenant_id is null
);

-- 5) Self-checks (proteção contra recorrência) ------------------------------
do $$
declare
  v_soma int;
begin
  if not exists (select 1 from public.feedback_rubricas where slug='nepq-auto-whatsapp-v1' and ativa) then
    raise exception 'NEPQ Fase 0: rubrica nepq-auto-whatsapp-v1 ativa ausente após seed';
  end if;
  -- pesos das dimensões precisam somar 100 (score_geral 0-100 consistente).
  select sum((d->>'peso')::int) into v_soma
  from public.feedback_rubricas r,
       jsonb_array_elements(r.definicao->'dimensoes') d
  where r.slug='nepq-auto-whatsapp-v1' and r.tenant_id is null;
  if v_soma <> 100 then
    raise exception 'NEPQ Fase 0: pesos das dimensões somam % (esperado 100)', v_soma;
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='feedback_rubricas' and rowsecurity) then
    raise exception 'NEPQ Fase 0: feedback_rubricas sem RLS';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='feedback_dimensoes' and rowsecurity) then
    raise exception 'NEPQ Fase 0: feedback_dimensoes sem RLS';
  end if;
end $$;
