const fs = require('fs');
const file = 'e:\\Projetos - Antigravity\\HUMANIZEIA\\humanizeia\\supabase\\functions\\uazapi-webhook\\index.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "if (!msgObj) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })",
  "if (!msgObj) { console.log('[Webhook] msgObj is null! payload keys:', Object.keys(payload), 'chat:', !!payload.chat, 'messages:', !!payload.messages, 'message:', !!payload.message); return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders }); }"
);

content = content.replace(
  "if (msgObj.fromMe === true) return new Response('Ignored fromMe', { headers: corsHeaders })",
  "if (msgObj.fromMe === true) { console.log('[Webhook] Ignored fromMe'); return new Response('Ignored fromMe', { headers: corsHeaders }); }"
);

content = content.replace(
  "if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return new Response('Ignored group/broadcast', { headers: corsHeaders });",
  "if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) { console.log('[Webhook] Ignored group/broadcast', remoteJid); return new Response('Ignored group/broadcast', { headers: corsHeaders }); }"
);

// Fallback search inside chat if Uazapi new format places message in chat.message
content = content.replace(
  "} else if (payload.message) {",
  "} else if (payload.message) {\n        msgObj = payload.message\n      } else if (payload.data && payload.data.message) {\n        msgObj = payload.data.message\n      } else if (payload.chat && payload.chat.messages) {\n        msgObj = Array.isArray(payload.chat.messages) ? payload.chat.messages[0] : payload.chat.messages\n      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {\n        msgObj = payload.data[0]\n      }"
);

fs.writeFileSync(file, content);
console.log('Added debug logs and deeper parsing to uazapi-webhook');
