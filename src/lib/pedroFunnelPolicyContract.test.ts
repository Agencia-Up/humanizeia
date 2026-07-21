import {
  buildTenantPolicyPromptSection,
  normalizeTenantPolicies,
  validateTenantPolicyDecision,
  validateTenantFunnelConfig,
  validateTenantPolicies,
} from './pedroFunnelPolicyContract';
import { buildTenantSdrSystemPrompt } from './pedroFunnelPrompt';

describe('Pedro v3 tenant funnel policies', () => {
  const noEntry = {
    id: 'no_entry',
    enabled: true,
    name: 'Sem entrada',
    domain: 'financial',
    when: 'O lead informa explicitamente que não possui entrada.',
    action: 'disqualify',
    evidenceRequirement: 'A fala literal do lead; não inferir a partir de financiamento.',
    responseGuidance: 'Encerrar cordialmente e cancelar o follow-up.',
    priority: 10,
  } as const;

  it('normalizes a policy without inventing a commercial route', () => {
    expect(normalizeTenantPolicies([noEntry])).toEqual([noEntry]);
  });

  it('blocks contradictory funnel instructions before prompt generation', () => {
    const issues = validateTenantFunnelConfig({
      bloco1_identidade: { agent_name: 'Carvalho', company: 'Icom Motors' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou o Carvalho.', first_question: 'Qual carro você procura?' },
      bloco4_qualificacao: { questions: ['Qual carro você procura?'] },
      bloco5_ramificacoes: { branches: [] },
      bloco6_criterios: { qualified_when: ['tem entrada'], disqualified_when: ['tem entrada'] },
      bloco7_transferencia: { required_data: [] },
      bloco8_regras: { always: ['Não pedir CPF'], never: ['não pedir cpf'] },
      bloco9_empresa: { name: 'Icom Motors' },
    });

    expect(issues.some((issue) => issue.code === 'always_never_conflict' && issue.severity === 'error')).toBe(true);
    expect(issues.some((issue) => issue.code === 'qualified_disqualified_overlap' && issue.severity === 'warning')).toBe(true);
    expect(issues.some((issue) => issue.code === 'duplicate_question' && issue.severity === 'warning')).toBe(true);
  });

  it('does not publish a structurally incomplete funnel as valid', () => {
    const issues = validateTenantFunnelConfig({
      bloco1_identidade: { agent_name: '', company: '' },
      bloco3_abordagem: { presentation: '' },
      bloco4_qualificacao: { questions: 'qualquer coisa' },
      bloco5_ramificacoes: { branches: [{ trigger: 'financiamento', questions: [] }] },
      bloco6_criterios: {},
      bloco7_transferencia: {},
      bloco8_regras: {},
      bloco9_empresa: { name: '' },
    });

    expect(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_identity',
      'missing_company',
      'missing_presentation',
      'invalid_list',
      'empty_branch',
    ]));
  });

  it('requires condition, evidence and response guidance', () => {
    const issues = validateTenantPolicies([{
      id: 'broken',
      enabled: true,
      name: 'Política incompleta',
      domain: 'financial',
      action: 'disqualify',
      priority: 10,
    }]);

    expect(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)).toEqual([
      'missing_condition',
      'missing_guidance',
      'missing_evidence',
    ]);
  });

  it('does not normalize invalid structural fields into a false green', () => {
    const issues = validateTenantPolicies([{
      id: '',
      name: '',
      domain: 'unknown',
      action: 'route_somewhere',
      when: 'quando qualquer coisa',
      responseGuidance: 'responder',
      evidenceRequirement: 'fala literal',
      priority: 0,
    }]);

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'missing_id',
      'missing_name',
      'invalid_domain',
      'invalid_action',
      'invalid_priority',
    ]));
  });

  it('warns about same-priority contradictory outcomes without deciding the conversation', () => {
    const issues = validateTenantPolicies([
      noEntry,
      { ...noEntry, id: 'continue_financing', name: 'Continuar financiamento', action: 'continue' },
    ]);

    expect(issues.some((issue) => issue.code === 'same_scope_conflict' && issue.severity === 'warning')).toBe(true);
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('compiles policies as LLM instructions with grounded evidence', () => {
    const prompt = buildTenantPolicyPromptSection([noEntry]);

    expect(prompt).toContain('# POLÍTICAS COMERCIAIS DA EMPRESA');
    expect(prompt).toContain('[no_entry] Sem entrada');
    expect(prompt).toContain('A engine não escolhe a política');
    expect(prompt).toContain('A fala literal do lead');
    expect(prompt).not.toContain('if (');
  });

  it('validates only a grounded declaration from the LLM', () => {
    const valid = validateTenantPolicyDecision(
      { policyId: 'no_entry', action: 'disqualify', evidence: 'não possui entrada' },
      'O lead disse que não possui entrada',
      [noEntry],
    );
    expect(valid).toEqual([]);

    const wrongAction = validateTenantPolicyDecision(
      { policyId: 'no_entry', action: 'continue', evidence: 'não possui entrada' },
      'O lead disse que não possui entrada',
      [noEntry],
    );
    expect(wrongAction.some((issue) => issue.code === 'action_mismatch')).toBe(true);

    const inventedEvidence = validateTenantPolicyDecision(
      { policyId: 'no_entry', action: 'disqualify', evidence: 'mora em outro estado' },
      'O lead disse que não possui entrada',
      [noEntry],
    );
    expect(inventedEvidence.some((issue) => issue.code === 'evidence_not_in_current_block')).toBe(true);
    expect(validateTenantPolicyDecision(null, 'qualquer bloco', [noEntry])).toEqual([]);
  });

  it('compiles one canonical SDR prompt with portal precedence and adaptive funnel semantics', () => {
    const prompt = buildTenantSdrSystemPrompt({
      bloco1_identidade: { agent_name: 'Carvalho', role: 'consultor', company: 'Icom Motors', niche: 'automóveis' },
      bloco3_abordagem: {
        objective: 'entender o veículo e o momento de compra',
        presentation: '[PERIODO]! Sou o Carvalho, consultor aqui de IA da Icom Motors 😊 Você é aqui de Taubaté mesmo já conhece a nossa loja?',
        first_question: 'Qual modelo você procura?',
        avoid: ['não repetir perguntas respondidas'],
      },
      bloco4_qualificacao: {
        objective: 'qualificar com naturalidade',
        questions: ['Você tem carro para troca?', 'Qual faixa de parcela cabe no orçamento?'],
        required_data: ['interesse real', 'forma de pagamento'],
        transfer_now_rules: ['lead pede um vendedor'],
      },
      bloco5_ramificacoes: { branches: [{ trigger: 'financiamento', questions: ['entender entrada e parcela'] }] },
      bloco6_criterios: {
        qualified_when: ['interesse confirmado e próximo passo claro'],
        disqualified_when: ['não possui entrada, quando essa regra estiver ativa'],
        closing_message: 'Tudo bem, não vou tomar mais seu tempo.',
      },
      bloco7_transferencia: {
        required_data: ['contexto confirmado'],
        customer_message: 'Vou te conectar com um consultor.',
        internal_summary_template: 'Interesse: (contexto real)',
      },
      bloco8_regras: { always: ['ser claro'], never: ['inventar preço'] },
      bloco9_empresa: { name: 'Icom Motors', address: 'Taubaté', hours: '9h às 19h', website: '', price_range: '', differentiators: '' },
      tenant_policies: [noEntry],
    });

    expect(prompt).toContain('# PEDRO V3 — PROMPT COMERCIAL DO PORTAL');
    expect(prompt).toContain('A mensagem atual do lead vence um objetivo antigo');
    expect(prompt).toContain('reproduza exatamente esta apresentação');
    expect(prompt).toContain('[PERIODO]! Sou o Carvalho');
    expect(prompt).toContain('se houver ');
    expect(prompt).toContain('trate o veículo do anúncio como assunto inicial');
    expect(prompt).toContain('lista ampla nesse primeiro contato');
    expect(prompt).toContain('transforme as perguntas abaixo em checklist');
    expect(prompt).toContain('A decisão de transferência pertence a você, a LLM');
    expect(prompt).toContain('Consulte estoque quando precisar de disponibilidade');
    expect(prompt).toContain('[no_entry] Sem entrada');
    expect((prompt.match(/## PRIMEIRO CONTATO/g) ?? []).length).toBe(1);
    expect((prompt.match(/## QUALIFICAÇÃO ADAPTATIVA/g) ?? []).length).toBe(1);
    expect((prompt.match(/## CAPACIDADES OPERACIONAIS/g) ?? []).length).toBe(1);
    expect(prompt).not.toContain('SE O CLIENTE RESPONDER');
    expect(prompt).not.toContain('if (');
  });
});
