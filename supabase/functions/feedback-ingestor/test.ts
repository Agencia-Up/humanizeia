// Testes da Fase 1 (ingestão). Rodar: deno test --allow-none
// LLM/WhatsApp/Meta não entram aqui (Fase 1 é só leitura). Mockamos o client.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildLeadThread } from '../_shared/feedback/ingestor.ts';

// Mock mínimo do SupabaseClient: retorna fixtures por tabela.
function mockClient(fixtures: Record<string, any[]>) {
  const single = (rows: any[]) => ({ data: rows[0] ?? null, error: null });
  const list = (rows: any[]) => ({ data: rows, error: null });
  const builder = (table: string) => {
    const rows = fixtures[table] || [];
    const q: any = {
      _rows: rows,
      select() { return q; },
      eq() { return q; },
      ilike() { return q; },
      order() { return Promise.resolve(list(q._rows)); },
      maybeSingle() { return Promise.resolve(single(q._rows)); },
    };
    return q;
  };
  return { from: (t: string) => builder(t) } as any;
}

Deno.test('monta thread ordenado combinando Pedro (IA) + vendedor', async () => {
  const admin = mockClient({
    ai_crm_leads: [{
      user_id: 't1', remote_jid: '5511999998888@s.whatsapp.net', lead_name: 'João',
      assigned_to_id: 'vend1', campaign_id: 'c1', ad_id: 'ad1', ad_name: 'Onix Promo',
      trade_in_vehicle: 'Gol 2015', down_payment: 20000,
    }],
    wa_chat_history: [
      { role: 'user', content: 'oi quero um carro', created_at: '2026-07-01T14:00:00Z' },
      { role: 'assistant', content: 'ótimo! tem carro na troca?', created_at: '2026-07-01T14:01:00Z' },
    ],
    wa_inbox: [
      { direction: 'outgoing', content: 'boa tarde João, aqui é o vendedor', created_at: '2026-07-01T15:00:00Z' },
    ],
  });
  const t = await buildLeadThread(admin, 'pedro', 'lead1');
  assertEquals(t?.tenant_id, 't1');
  assertEquals(t?.vendedor_id, 'vend1');
  assertEquals(t?.campanha_id, 'ad1'); // ad_id tem prioridade sobre campaign_id
  assertEquals(t?.thread.length, 3);
  assertEquals(t?.thread[0].from, 'cliente');
  assertEquals(t?.thread[1].from, 'ia');
  assertEquals(t?.thread[2].from, 'vendedor'); // veio depois no tempo -> fim do fio
  assertEquals(t?.thread[2].canal, 'marcos');
  assertEquals((t?.sinais_estruturados as any).trade_in_vehicle, 'Gol 2015');
});

Deno.test('lead sem conversa de vendedor NÃO quebra', async () => {
  const admin = mockClient({
    ai_crm_leads: [{ user_id: 't1', remote_jid: '5511999998888@s.whatsapp.net', lead_name: 'Maria', assigned_to_id: null }],
    wa_chat_history: [{ role: 'user', content: 'olá', created_at: '2026-07-01T10:00:00Z' }],
    wa_inbox: [],
  });
  const t = await buildLeadThread(admin, 'pedro', 'lead2');
  assertEquals(t?.thread.length, 1);
  assertEquals(t?.thread[0].canal, 'pedro');
  assertEquals(t?.vendedor_id, null);
});

Deno.test('lead inexistente retorna null', async () => {
  const admin = mockClient({ ai_crm_leads: [] });
  const t = await buildLeadThread(admin, 'pedro', 'nao-existe');
  assertEquals(t, null);
});
