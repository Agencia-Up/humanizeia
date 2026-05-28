-- Instâncias
SELECT 'INST' AS section, instance_name, status, is_active,
  COALESCE(consecutive_undelivered,0) AS und,
  COALESCE(health_score,0) AS health,
  COALESCE(shadow_ban_suspect,false) AS shadow,
  last_message_at::text AS last_msg
FROM wa_instances
WHERE is_active = true
ORDER BY und DESC;

-- Últimas 15 mensagens
SELECT 'MSG' AS section, created_at::text AS ts, direction,
  RIGHT(phone, 6) AS tel,
  LEFT(COALESCE(content, ''), 80) AS preview
FROM wa_inbox
WHERE created_at >= NOW() - INTERVAL '3 hours'
ORDER BY created_at DESC
LIMIT 15;
