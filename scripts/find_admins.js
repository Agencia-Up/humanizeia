import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Manual .env parser
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

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

async function findUsers() {
  const emails = ['douglasaloan@gmail.com', 'wandercarvalho31@gmail.com'];
  
  console.log('Buscando usuários por email no Supabase...');
  
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  
  if (error) {
    console.error('Erro ao listar usuários:', error);
    return;
  }

  const found = users.filter(u => emails.includes(u.email));
  
  console.log('\n--- Usuários Encontrados ---');
  if (found.length === 0) {
    console.log('Nenhum usuário encontrado com esses emails.');
  } else {
    found.forEach(u => {
      console.log(`Email: ${u.email} | ID: ${u.id}`);
    });
  }
}

findUsers();
