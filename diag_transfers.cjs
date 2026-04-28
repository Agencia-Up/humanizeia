
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://seyljsqmhlopkcauhlor.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM"
);

async function checkIds() {
  console.log('Checking IDs for user f49fd48a-4386-4009-95f3-26a5100b84f7');
  
  const { data: members } = await supabase
    .from('ai_team_members')
    .select('id, name, user_id')
    .eq('user_id', 'f49fd48a-4386-4009-95f3-26a5100b84f7');

  console.log('\nTeam Members:');
  members.forEach(m => console.log(`- ${m.name} (ID: ${m.id}) | User: ${m.user_id}`));

  const { data: transfers } = await supabase
    .from('ai_lead_transfers')
    .select('id, to_member_id, user_id, created_at')
    .eq('user_id', 'f49fd48a-4386-4009-95f3-26a5100b84f7')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\nRecent Transfers for this user:');
  transfers.forEach(t => console.log(`- To: ${t.to_member_id} | Created: ${t.created_at}`));
}

checkIds();
