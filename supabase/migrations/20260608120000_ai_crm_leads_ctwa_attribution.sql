-- CTWA (Click-to-WhatsApp) attribution columns for Pedro leads.
-- ADITIVO: apenas novas colunas nullable. Nao altera/remove nada existente.
--
-- Contexto: ai_crm_leads ja tem campaign_id/adset_id/ad_id/paid_origin_payload
-- (migration 20260607070000), mas a atribuicao vinha so da URL do anuncio
-- (utm/fbclid). O identificador nativo do Click-to-WhatsApp (ctwa_clid) era
-- DESCARTADO pelo parser. Estas colunas guardam os campos do referral CTWA que
-- alimentam a Conversions API for Business Messaging.

alter table public.ai_crm_leads
  add column if not exists ctwa_clid       text,
  add column if not exists meta_source_url text,
  add column if not exists meta_headline   text;

-- Busca rapida de leads por click id (atribuicao/depuracao), por tenant.
create index if not exists idx_ai_crm_leads_ctwa_clid
  on public.ai_crm_leads(user_id, ctwa_clid)
  where ctwa_clid is not null;

comment on column public.ai_crm_leads.ctwa_clid is
  'Click-to-WhatsApp Click ID (referral.ctwa_clid). Chave de atribuicao da CAPI for Business Messaging.';
comment on column public.ai_crm_leads.meta_source_url is
  'referral.source_url do anuncio CTWA (URL de origem).';
comment on column public.ai_crm_leads.meta_headline is
  'referral.headline/title do anuncio CTWA.';
