import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qrxsiixufdiemwwyhxvd.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyeHNpaXh1ZmRpZW13d3loeHZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTA4ODgsImV4cCI6MjA4ODc2Njg4OH0.uoc_aPSTxA7PYciKkwGU-lpi4D4b_wLXwaas2vpIyVg';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  console.log("Testing connection to client_briefings...");
  
  const { data, error } = await supabase
    .from('client_briefings')
    .select('id')
    .limit(1);

  if (error) {
    console.error("Error from Supabase:", error.message, error.details, error.hint);
  } else {
    console.log("Success! Data:", data);
  }
}

testConnection();
