-- Painel Administracao: relatorio de saude do Pedro v2 POR AGENTE.
-- Adiciona agent_id (nullable) em pedro_v2_health_reports: o monitor passa a gravar 1 linha
-- por agente/dia (agent_id preenchido) ALEM da linha agregada (agent_id null), preservando
-- o comportamento atual. Index p/ a leitura por agente + tendencia temporal.
alter table public.pedro_v2_health_reports
  add column if not exists agent_id uuid;

create index if not exists idx_health_reports_agent_created
  on public.pedro_v2_health_reports (agent_id, created_at desc);

comment on column public.pedro_v2_health_reports.agent_id is
  'Agente do relatorio (null = agregado da plataforma). Preenchido nas linhas por-agente.';
