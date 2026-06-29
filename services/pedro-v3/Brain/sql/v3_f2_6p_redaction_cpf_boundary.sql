-- Pedro v3 F2.6P - corrige FALSO POSITIVO de CPF em v3_payload_is_redacted (bordas \y em vez de [^0-9]).
-- O dono aplica MANUALMENTE no SQL Editor do Supabase. NUNCA via db push.
--
-- BUG (causa raiz do "v3 nao responde" depois do F2.6N):
--   O commit (v3_commit_turn) insere o evento turn_claimed cujo payload contem os event_ids do uazapi.
--   Cada event_id e um hash hex de 64 chars (ex.: "uazapi:b265f614...f77842555836c15a...").
--   O check v3_turn_events_payload_ck -> v3_payload_is_redacted barrava o payload porque o heuristico
--   de CPF '(^|[^0-9])[0-9]{3}...[0-9]{2}([^0-9]|$)' tratava letras hex (a-f) como delimitador valido,
--   entao 11 digitos seguidos DENTRO do hash (ex.: "77842555836") viravam falso positivo de CPF.
--   Resultado: INSERT viola a constraint -> erro 23514 -> PostgREST 400 -> HTTP_FAILURE no commit ->
--   turno falha sempre -> nenhuma resposta. Provado no banco:
--     '..f77842555836c..' ~* regex_antiga = TRUE (falso positivo) ; ~* regex_nova(\y) = FALSE (ok).
--
-- FIX: usar WORD-BOUNDARY (\y). Sequencias de digitos grudadas em letras/alfanumerico (hashes) NAO
--   casam; CPF real (cercado por espaco/pontuacao/inicio/fim) continua pego, formatado OU cru:
--     'meu cpf 123.456.789-00' ~* regex_nova = TRUE ; 'cpf 12345678900 ok' ~* regex_nova = TRUE.
--   create or replace preserva os grants; os checks (turn_events e outbox) passam a usar a versao nova
--   nos proximos inserts (linhas antigas nao sao re-validadas).

begin;

create or replace function public.v3_payload_is_redacted(p_payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    p_payload is not null
    and jsonb_typeof(p_payload) = 'object'
    and p_payload @> '{"__redacted": true}'::jsonb
    and p_payload::text !~* '\y[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}\y'
    and p_payload::text !~* '(bearer[[:space:]]+[a-z0-9._-]{20,}|sk-[a-z0-9_-]{16,})'
$$;

commit;

-- Verificacao read-only (esperado: passa_hash=true, pega_formatado=false, pega_cru=false):
--   select
--     public.v3_payload_is_redacted('{"eventIds":["uazapi:b265f614176af61086d5a75e46f77842555836c15a047f76a8a3b90c2f4699c8"],"__redacted":true}'::jsonb) as passa_hash,
--     public.v3_payload_is_redacted('{"text":"meu cpf 123.456.789-00","__redacted":true}'::jsonb) as pega_formatado,
--     public.v3_payload_is_redacted('{"text":"cpf 12345678900 ok","__redacted":true}'::jsonb)      as pega_cru;
