const filePath = 'e:\\Projetos - Antigravity\\HUMANIZEIA\\humanizeia\\supabase\\functions\\uazapi-webhook\\index.ts';
const fs = require('fs');

let content = fs.readFileSync(filePath, 'utf8');

// replace the entire router part with a heavily logged version
const startMarker = `const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)`;
const endMarker = `    // --- FORMATO EVOLUTION API ---`;

const newCode = `const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)
    const isEvolution = !!(payload.event || payload.data)
    console.log('[Webhook] isUazapi:', isUazapi, 'isEvolution:', isEvolution);
    
    // --- FORMATO UAZAPI ---
    if (isUazapi) {
      const eventType = String(payload.EventType || payload.eventType || '').toLowerCase()
      console.log('[Webhook] eventType (Uazapi):', eventType);

      if (eventType === 'connection' || eventType === 'status' || eventType.includes('connect')) {
        console.log('[Webhook] Ignorando evento de conexao (retornando silenciosamente)');
        const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
        if (instanceName) {
          const state = String(payload.state || payload.status || '').toLowerCase()
          if (state === 'open' || state === 'connected') {
            await supabase.from('wa_instances')
              .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
              .eq('instance_name', instanceName)
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }
      
      if (eventType !== 'messages' && eventType !== 'message' && !eventType.includes('message')) {
        console.log('[Webhook] Ignorando evento Uazapi que nao e messages:', eventType);
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
      const chat = payload.chat || {}
      
      let msgObj = null
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        msgObj = payload.messages[0]
      } else if (payload.message) {
        msgObj = payload.message
      } else if (payload.data && payload.data.message) {
        msgObj = payload.data.message
      } else if (payload.chat && payload.chat.messages) {
        msgObj = Array.isArray(payload.chat.messages) ? payload.chat.messages[0] : payload.chat.messages
      } else if (payload.data && Array.isArray(payload.data) && payload.data.length > 0) {
        msgObj = payload.data[0]
      }
      
      console.log('[Webhook] Extraiu msgObj?', !!msgObj);
      if (!msgObj) {
        console.log('[Webhook] Estrutura completa para inspecao:', JSON.stringify(payload).substring(0, 500));
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      
      if (msgObj.fromMe === true) {
         console.log('[Webhook] Ignored fromMe');
         return new Response('Ignored fromMe', { headers: corsHeaders });
      }
      
      const remoteJid = msgObj.chatId || msgObj.chatid || msgObj.from || chat.id || chat.chatId || '';
      console.log('[Webhook] remoteJid extraido:', remoteJid);
      
      if (!remoteJid) {
         console.log('[Webhook] No remoteJid, ignorando.');
         return new Response('No remoteJid', { headers: corsHeaders });
      }
      
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
         console.log('[Webhook] Ignored group/broadcast', remoteJid);
         return new Response('Ignored group/broadcast', { headers: corsHeaders });
      }

      const userText = (msgObj.body || msgObj.text || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';
      
      console.log(\`[Webhook] Mensagem final a repassar -> Instance: \${instanceName}, From: \${remoteJid}, Text: \${userText}\`);
      return await processMessage(supabase, instanceName, remoteJid, userText, pushName, msgObj);
    }
`;

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + newCode + content.substring(endIndex);
  fs.writeFileSync(filePath, content);
  console.log('Successfully injected advanced tracing');
} else {
  console.log('Markers not found');
}
