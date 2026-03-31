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

const supabase = createClient(url, key);

async function inspectSchema() {
  console.log('Inspecionando tabelas do esquema public...');
  
  // Usando rpc para listar tabelas se houver permissão, ou apenas tentando listar via metadados de consulta
  const { data, error } = await supabase.rpc('get_tables_info'); // Se existir
  
  if (error) {
    // Fallback: tentar listar via query direta se service role permitir (embora rpc seja mais seguro)
    console.log('RPC falhou, tentando query direta...');
    const { data: tables, error: queryError } = await supabase
      .from('profiles') // só para testar conexão
      .select('id')
      .limit(1);
      
    if (queryError) {
      console.error('Conexão falhou:', queryError);
      return;
    }
    console.log('Conexão establecida. Vou basear nas migrations para listar as tabelas.');
  }
}

inspectSchema();
