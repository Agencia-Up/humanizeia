-- Pedro v3: system-authored follow-up turns have no lead inbox event to claim.
-- Keep the ordinary-turn invariant strict while allowing only a correlated
-- followup:<anchor>:<stage> + followup_t<stage> decision to commit an empty
-- event-id set. The function body is patched in-place so this migration stays
-- compatible with the exact production definition already deployed.
do $migration$
declare
  v_signature regprocedure := 'public.v3_commit_turn(uuid,text,text,text,text,bigint,jsonb,jsonb,jsonb,jsonb,text[],text,text,timestamptz)'::regprocedure;
  v_definition text;
  v_old_guard text := $old$
  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    raise exception 'v3_empty_inbox_claim' using errcode = '22023';
  end if;$old$;
  v_new_guard text := $new$
  -- Follow-up is a legitimate system turn and therefore has no new lead
  -- inbox event. Cross-check turn identity and reason; ordinary turns still
  -- require at least one claimed event.
  if coalesce(array_length(p_event_ids, 1), 0) = 0 and not (
    p_turn_id ~ '^followup:.+:[123]$'
    and p_decision ->> 'reasonCode' = 'followup_t' || right(p_turn_id, 1)
  ) then
    raise exception 'v3_empty_inbox_claim' using errcode = '22023';
  end if;$new$;
  v_old_count text := 'if v_event_count <> array_length(p_event_ids, 1) then';
  v_new_count text := 'if v_event_count <> coalesce(array_length(p_event_ids, 1), 0) then';
  v_old_expected text := 'array_length(p_event_ids, 1), v_event_count';
  v_new_expected text := 'coalesce(array_length(p_event_ids, 1), 0), v_event_count';
begin
  select pg_get_functiondef(v_signature) into v_definition;
  -- pg_get_functiondef preserves the line endings used when the function was
  -- installed. Production currently has CRLF while this migration is LF.
  -- Normalize only line endings; structural drift is still rejected below.
  v_definition := replace(v_definition, E'\r\n', E'\n');

  if position('Follow-up is a legitimate system turn' in v_definition) > 0 then
    return;
  end if;
  if position(v_old_guard in v_definition) = 0
    or position(v_old_count in v_definition) = 0
    or position(v_old_expected in v_definition) = 0
  then
    raise exception 'v3_commit_turn_definition_drift';
  end if;

  v_definition := replace(v_definition, v_old_guard, v_new_guard);
  v_definition := replace(v_definition, v_old_count, v_new_count);
  v_definition := replace(v_definition, v_old_expected, v_new_expected);
  execute v_definition;
end;
$migration$;
