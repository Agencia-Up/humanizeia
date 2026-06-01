-- Ponta #4 — Registrar QUEM disparou a transferencia manual de lead.
-- Colunas aditivas em ai_lead_transfers. Sem FK (preserva historico mesmo se o
-- usuario for removido), seguindo o padrao das demais colunas desta tabela.
-- Idempotente (IF NOT EXISTS). Transferencia automatica da IA deixa NULL.

alter table public.ai_lead_transfers
  add column if not exists triggered_by_user_id uuid,
  add column if not exists triggered_by_name text;

comment on column public.ai_lead_transfers.triggered_by_user_id is
  'Auth user que disparou a transferencia manual via painel. NULL = transferencia automatica da IA.';
comment on column public.ai_lead_transfers.triggered_by_name is
  'Nome do operador que disparou a transferencia manual (profiles.full_name, ai_team_members.name ou email).';
