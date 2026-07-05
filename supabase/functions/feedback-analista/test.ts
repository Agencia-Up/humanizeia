// Testes da Fase 2 (cérebro). Rodar: deno test. LLM + banco MOCKADOS (sem API real).
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { analisarLead, decidirVeredito, LlmCall } from '../_shared/feedback/analista.ts';

Deno.test('veredito de atribuição (tabela do prompt)', () => {
  assertEquals(decidirVeredito('1_alto', 80, false, true), 'rotulagem_incorreta'); // bom + descartado
  assertEquals(decidirVeredito('2_medio', 30, false, false), 'falha_atendimento');  // bom + atendimento fraco
  assertEquals(decidirVeredito('1_alto', 90, false, false), 'perda_legitima');       // bom + atendimento forte
  assertEquals(decidirVeredito('4_nao_lead', 10, false, false), 'lead_ruim');         // 3/4 -> lead ruim
  assertEquals(decidirVeredito('3_baixo', 70, false, false), 'lead_ruim');
  assertEquals(decidirVeredito('2_medio', 10, true, false), 'venda_realizada');       // vendeu manda
  assertEquals(decidirVeredito(null, 50, false, false), null);                        // indeterminado
});

function mockAdmin(tables: Record<string, any>, rpc: Record<string, any>) {
  const captured: any = {};
  const chain = (rows: any): any => {
    const list = Array.isArray(rows) ? rows : rows == null ? [] : [rows];
    const c: any = {
      select() { return c; }, eq() { return c; }, ilike() { return c; },
      or() { return c; }, order() { return c; }, limit() { return c; },
      maybeSingle() {
        return Promise.resolve({ data: Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null), error: null });
      },
      upsert(p: any) { captured.upsert = p; return Promise.resolve({ data: null, error: null }); },
      then(res: any, rej: any) { return Promise.resolve({ data: list, error: null }).then(res, rej); },
    };
    return c;
  };
  const admin: any = {
    _captured: captured,
    from(t: string) { return chain(tables[t] ?? []); },
    rpc(name: string) { return Promise.resolve({ data: rpc[name], error: null }); },
  };
  return admin;
}

Deno.test('lead com troca+entrada que o vendedor descartou -> rotulagem_incorreta', async () => {
  const contrato = JSON.stringify({
    versao: '1.0',
    sinais: { carro_na_troca: true, entrada_pct: 60, tem_entrada: true, nome_limpo: true, restricao: false },
    competencias: { velocidade: { nota: 30, evidencia: 'demorou' }, qualificacao: { nota: 20, evidencia: 'nao perguntou' } },
    houve_venda: false,
    vendedor_descartou_lead_bom: true,
    frase_coaching: 'cliente com troca é venda quase certa',
  });
  const llm: LlmCall = async () => ({ text: contrato, tokens: 1500, custo: 0.01 });

  const admin = mockAdmin(
    {
      ai_crm_leads: { user_id: 't1', remote_jid: '5511999998888@s.whatsapp.net', lead_name: 'João', assigned_to_id: 'v1', ad_id: 'ad1', trade_in_vehicle: 'Civic 2019' },
      wa_chat_history: [{ role: 'user', content: 'tenho um Civic pra troca', created_at: '2026-07-01T10:00:00Z' }],
      wa_inbox: [],
      feedback_config: { nicho: 'automotivo', framework: { competencias: { velocidade: 15, qualificacao: 15 } }, prompt_especialista: 'especialista' },
    },
    {
      feedback_cost_gate: { allowed: true },
      feedback_classificar_qualidade: '1_alto',   // troca + entrada 60% -> 1_alto (motor de regras)
      feedback_cost_record: null,
    },
  );

  const r = await analisarLead(admin, llm, 'pedro', 'lead1');
  assertEquals(r.status, 'concluido');
  assertEquals(r.qualidade_lead, '1_alto');
  assertEquals(r.veredito, 'rotulagem_incorreta');
  assertEquals(r.rotulagem_incorreta, true);
  // persistiu com os campos certos
  assertEquals(admin._captured.upsert.qualidade_lead, '1_alto');
  assertEquals(admin._captured.upsert.rotulagem_incorreta, true);
  assertEquals(admin._captured.upsert.status, 'concluido');
});

Deno.test('cap batido -> pula sem chamar o LLM', async () => {
  let chamouLlm = false;
  const llm: LlmCall = async () => { chamouLlm = true; return { text: '{}', tokens: 0, custo: 0 }; };
  const admin = mockAdmin(
    { ai_crm_leads: { user_id: 't1', remote_jid: '5511999998888@s.whatsapp.net' }, wa_chat_history: [], wa_inbox: [], feedback_config: { nicho: 'automotivo', framework: {}, prompt_especialista: '' } },
    { feedback_cost_gate: { allowed: false, reason: 'cap_analises_dia' } },
  );
  const r = await analisarLead(admin, llm, 'pedro', 'lead2');
  assertEquals(r.status, 'pulado');
  assertEquals(r.motivo, 'cap_analises_dia');
  assertEquals(chamouLlm, false); // não gastou IA
});
