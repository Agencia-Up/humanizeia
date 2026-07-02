// ============================================================================
// asaas-health — diagnóstico READ-ONLY do Asaas (NÃO cria cobrança)
// ----------------------------------------------------------------------------
// Confirma, usando o ASAAS_BASE_URL + ASAAS_API_KEY já configurados nos secrets:
//   - se a chave BATE com o ambiente (GET /myAccount → 200 = alinhado; erro
//     "não pertence a este ambiente" = desalinhado);
//   - qual ambiente (produção vs sandbox);
//   - se há chave Pix cadastrada (GET /pix/addressKeys) — pro método PIX.
// Só faz GET. Nunca POST em /payments|/subscriptions|/customers. Não expõe PII.
// ============================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ASAAS_BASE_URL = Deno.env.get('ASAAS_BASE_URL') || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = Deno.env.get('ASAAS_API_KEY') || '';

function ambienteDe(url: string): 'producao' | 'sandbox' | 'desconhecido' {
  if (/sandbox/i.test(url)) return 'sandbox';
  if (/(^|\.)asaas\.com/i.test(url)) return 'producao';
  return 'desconhecido';
}

async function asaasGet(path: string) {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'access_token': ASAAS_API_KEY, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!ASAAS_API_KEY) {
      return json({ ok: false, erro: 'ASAAS_API_KEY não configurada nos secrets' });
    }

    // 1) alinhamento chave x ambiente (read-only)
    const acc = await asaasGet('/myAccount');
    const errTxt = JSON.stringify(acc.data?.errors || acc.data || '');
    const envMismatch = !acc.ok && /não pertence a este ambiente|does not belong|invalid.*environment/i.test(errTxt);

    // 2) chave Pix cadastrada (read-only)
    const pix = await asaasGet('/pix/addressKeys?limit=10');
    const pixList = pix.ok && Array.isArray(pix.data?.data) ? pix.data.data : [];

    return json({
      ok: acc.ok,
      base_url_host: (() => { try { return new URL(ASAAS_BASE_URL).host; } catch { return ASAAS_BASE_URL; } })(),
      ambiente: ambienteDe(ASAAS_BASE_URL),
      env_ok: acc.ok,                 // 200 no /myAccount = chave bate com o ambiente
      env_mismatch: envMismatch,      // true = chave é de outro ambiente que a URL
      my_account_status: acc.status,
      erro_myaccount: acc.ok ? null : (acc.data?.errors?.[0]?.description || acc.data?.message || `HTTP ${acc.status}`),
      tem_pix: pixList.length > 0,
      qtd_pix_keys: pix.ok ? pixList.length : null,
      erro_pix: pix.ok ? null : (pix.data?.errors?.[0]?.description || `HTTP ${pix.status}`),
    });
  } catch (e) {
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) });
  }
});
