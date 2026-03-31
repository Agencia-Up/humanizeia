import { createClient } from '@supabase/supabase-js';

const url = "https://qrxsiixufdiemwwyhxvd.supabase.co";
const key = "sb_secret_IDsZ4xWArGiGPs8XIcy45g_iEGI0zgw";

const supabase = createClient(url, key);

async function test() {
    console.log("Testando com dados hardcoded...");
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error("Erro:", error);
    } else {
        console.log("Sucesso! Usuários encontrados:", data.users.length);
        data.users.forEach(u => console.log(u.email));
    }
}

test();
