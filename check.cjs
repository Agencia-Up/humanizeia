require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Pegar as ultimas 10 mensagens
  const { data: messages } = await supabase
    .from('wa_chat_history')
    .select('role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  console.log("---- ULTIMAS MENSAGENS ----");
  if(messages) {
    messages.reverse().forEach(m => {
      console.log(`[${m.role}] ${m.content.substring(0, 300)}`);
    });
  }
}

run();
