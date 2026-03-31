import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

function getEnv() {
  const envPath = path.resolve('.env');
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value.length > 0) {
      env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1');
    }
  });
  return env;
}

const env = getEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`URL: ${url}`);
console.log(`Key length: ${key.length}`);
console.log(`Key prefix: ${key.substring(0, 15)}...`);

const supabase = createClient(url, key);

async function testConnection() {
  // Test with a simple table select (requires RLS to be bypassed by Service Role)
  console.log('Testando conexão via SQL...');
  const { data, error } = await supabase.from('profiles').select('id').limit(1);
  
  if (error) {
    console.error('Erro:', error);
  } else {
    console.log('Conexão OK! Dados:', data);
  }
}

testConnection();
