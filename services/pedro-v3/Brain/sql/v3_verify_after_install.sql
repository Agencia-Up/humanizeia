-- Pedro v3 - verificacao SOMENTE LEITURA apos instalar v3_schema.sql + v3_f2_5_1_outbox_patch.sql.
-- Rode no SQL Editor do Supabase e envie o resultado ao Codex.
-- Resultado esperado: todas as linhas com ok = true.

with required_tables(name) as (
  values
    ('v3_conversation_state'),
    ('v3_state_history'),
    ('v3_inbox'),
    ('v3_leases'),
    ('v3_turn_events'),
    ('v3_query_log'),
    ('v3_decisions'),
    ('v3_effect_outbox'),
    ('v3_media_receipts'),
    ('v3_messages'),
    ('v3_shadow_comparisons'),
    ('v3_sensitive_vault')
), required_functions(signature) as (
  values
    ('public.v3_ingest_inbox(uuid,text,text,jsonb,timestamp with time zone)'),
    ('public.v3_acquire_lease(uuid,text,text,integer,timestamp with time zone)'),
    ('public.v3_renew_lease(uuid,text,text,text,integer,timestamp with time zone)'),
    ('public.v3_release_lease(uuid,text,text,text)'),
    ('public.v3_claim_inbox_burst(uuid,text,timestamp with time zone,text,text,text,interval,integer,timestamp with time zone)'),
    ('public.v3_release_inbox_claim(uuid,text[],text,text,text)'),
    ('public.v3_commit_turn(uuid,text,text,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text[],text,text,timestamp with time zone)'),
    ('public.v3_claim_outbox(text,interval,integer,timestamp with time zone)'),
    ('public.v3_claim_outbox_for_conversation(uuid,text,text,integer,integer,timestamp with time zone)'),
    ('public.v3_record_outbox_result(uuid,text,text,text,text,jsonb,text,boolean,timestamp with time zone,jsonb,timestamp with time zone)'),
    ('public.v3_requeue_outbox_guarded(uuid,text,text,text,text,timestamp with time zone,text)'),
    ('public.v3_skip_outbox_guarded(uuid,text,text,text,text,text,timestamp with time zone)'),
    ('public.v3_fail_outbox_guarded(uuid,text,text,text,text,text,timestamp with time zone)'),
    ('public.v3_commit_effect_outcome(uuid,text,text,bigint,jsonb,timestamp with time zone)')
), checks as (
  select
    'table:' || name as check_name,
    to_regclass('public.' || name) is not null as ok,
    coalesce(to_regclass('public.' || name)::text, 'missing') as detail
  from required_tables

  union all

  select
    'function:' || signature,
    to_regprocedure(signature) is not null,
    coalesce(to_regprocedure(signature)::text, 'missing')
  from required_functions

  union all

  select
    'rls:' || c.relname,
    c.relrowsecurity and c.relforcerowsecurity,
    format('enabled=%s forced=%s', c.relrowsecurity, c.relforcerowsecurity)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname like 'v3\_%' escape '\'

  union all

  select
    'column:v3_effect_outbox.' || expected.column_name,
    actual.column_name is not null,
    coalesce(actual.data_type, 'missing')
  from (values
    ('on_success'),
    ('required_receipt_level'),
    ('processing_token'),
    ('outcome_applied_at'),
    ('terminal_at')
  ) as expected(column_name)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'v3_effect_outbox'
   and actual.column_name = expected.column_name

  union all

  select
    'security:vault_no_authenticated_select',
    not has_table_privilege('authenticated', 'public.v3_sensitive_vault', 'select'),
    'authenticated SELECT=' || has_table_privilege('authenticated', 'public.v3_sensitive_vault', 'select')::text

  union all

  select
    'security:service_role_commit_turn',
    has_function_privilege(
      'service_role',
      'public.v3_commit_turn(uuid,text,text,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text[],text,text,timestamp with time zone)',
      'execute'
    ),
    'service_role execute'

  union all

  select
    'security:service_role_guarded_outbox_rpcs',
    has_function_privilege(
      'service_role',
      'public.v3_requeue_outbox_guarded(uuid,text,text,text,text,timestamp with time zone,text)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.v3_skip_outbox_guarded(uuid,text,text,text,text,text,timestamp with time zone)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.v3_fail_outbox_guarded(uuid,text,text,text,text,text,timestamp with time zone)',
      'execute'
    ),
    'guarded RPCs executable'

  union all

  select
    'security:legacy_outbox_writers_revoked',
    not has_function_privilege(
      'service_role',
      'public.v3_claim_outbox(text,interval,integer,timestamp with time zone)',
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'public.v3_requeue_outbox(uuid,text,timestamp with time zone,text)',
      'execute'
    )
    and not has_function_privilege(
      'service_role',
      'public.v3_skip_outbox(uuid,text,text,timestamp with time zone)',
      'execute'
    ),
    'legacy global/unguarded RPCs not executable'

  union all

  select
    'isolation:no_v2_tables_touched',
    not exists (
      select 1
      from pg_depend d
      join pg_class source on source.oid = d.objid
      join pg_class target on target.oid = d.refobjid
      join pg_namespace ns on ns.oid = source.relnamespace
      join pg_namespace nt on nt.oid = target.relnamespace
      where ns.nspname = 'public'
        and source.relname like 'v3\_%' escape '\'
        and nt.nspname = 'public'
        and target.relkind = 'r'
        and target.relname not like 'v3\_%' escape '\'
        and target.relname <> 'users'
    ),
    'v3 depende apenas de auth.users e objetos v3_*'
)
select check_name, ok, detail
from checks
order by ok, check_name;

