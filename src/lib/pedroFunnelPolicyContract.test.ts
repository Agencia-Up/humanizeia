import {
  buildTenantPolicyPromptSection,
  normalizeTenantPolicies,
  validateTenantPolicyDecision,
  validateTenantFunnelConfig,
  validateTenantPolicies,
} from './pedroFunnelPolicyContract';
import {
  buildFunnelPromptEditorRequest,
  buildTenantSdrSystemPrompt,
  enforceCanonicalV3Sections,
  sanitizeTenantFunnelPromptConfig,
  validateAiGeneratedFunnelPrompt,
} from './pedroFunnelPrompt';

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
    expect(prompt).toContain('reproduza exatamente o texto entre as tags abaixo');
    expect(prompt).toContain('[PERIODO]! Sou o Carvalho');
    expect(prompt).toContain('se houver ');
    expect(prompt).toContain('trate o veículo do anúncio como assunto inicial');
    expect(prompt).toContain('lista ampla nesse primeiro contato');
    expect(prompt).toContain('transforme as perguntas abaixo em checklist');
    expect(prompt).toContain('não repita o mesmo fato');
    expect(prompt).toContain('mencione cada informação uma única vez');
    expect(prompt).toContain('A decisão de transferência pertence a você, a LLM');
    expect(prompt).toContain('use `stock_search` no mesmo turno lógico');
    expect(prompt).toContain('use `vehicle_ref` nos atributos e `money_ref` no preço');
    expect(prompt).toContain('faça `vehicle_photos_resolve`');
    expect(prompt).toContain('inclua o efeito `send_media`');
    expect(prompt).toContain('não podem ser herdados de um anúncio que o lead acabou de abandonar');
    expect(prompt).toContain('O teto de orçamento informado pelo lead não é o preço do veículo');
    expect(prompt).toContain('[no_entry] Sem entrada');
    expect((prompt.match(/## PRIMEIRO CONTATO/g) ?? []).length).toBe(1);
    expect((prompt.match(/## QUALIFICAÇÃO ADAPTATIVA/g) ?? []).length).toBe(1);
    expect((prompt.match(/## CAPACIDADES OPERACIONAIS/g) ?? []).length).toBe(1);
    expect(prompt).not.toContain('SE O CLIENTE RESPONDER');
    expect(prompt).not.toContain('if (');
  });

  it('normalizes a pasted legacy opening and duplicate company labels', () => {
    const prompt = buildTenantSdrSystemPrompt({
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', role: 'Marketing', company: 'Mônaco Automóveis', niche: 'automóveis' },
      bloco3_abordagem: {
        presentation: `# PRIMEIRO CONTATO\nNa primeira resposta, use exatamente esta apresentação, alterando somente a saudação conforme o horário atual do Brasil:\n"[PERIODO]! Muito prazer, meu nome é Aline e sou do Marketing da Mônaco Automóveis 😊"\nSubstitua [PERIODO] e não altere as demais palavras.`,
      },
      bloco9_empresa: {
        name: 'Empresa: Mônaco Automóveis',
        address: 'Endereço: Endereço: Avenida Central, 100',
        hours: 'Horário: Segunda a sábado, 8h30 às 18h',
      },
    });

    const firstContact = prompt.slice(prompt.indexOf('## PRIMEIRO CONTATO'), prompt.indexOf('## QUALIFICAÇÃO ADAPTATIVA'));
    expect(firstContact).toContain('<APRESENTACAO_LITERAL>\n[PERIODO]! Muito prazer, meu nome é Aline e sou do Marketing da Mônaco Automóveis 😊\n</APRESENTACAO_LITERAL>');
    expect(firstContact).not.toContain('Regra de saudação');
    expect(firstContact).not.toContain('Substitua [PERIODO]');
    expect(prompt).toContain('- Empresa: Mônaco Automóveis');
    expect(prompt).toContain('- Endereço: Avenida Central, 100');
    expect(prompt).not.toContain('Endereço: Endereço:');
  });

  it('extracts the spoken opening from the real Monaco greeting instructions', () => {
    const prompt = buildTenantSdrSystemPrompt({
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', role: 'Marketing', company: 'Mônaco Automóveis' },
      bloco3_abordagem: {
        presentation: `Regra de saudação por horário:
Se o horário for entre 00h e 11h59 → "Bom dia!"
Se o horário for entre 12h e 17h59 → "Boa tarde!"
Se o horário for entre 18h e 23h59 → "Boa noite!"

Texto completo para o campo:

Identifique o horário atual e cumprimente conforme o momento. Em seguida, apresente-se: " Muito prazer, sou do Marketing da Mônaco Automóveis"`,
      },
    });

    const firstContact = prompt.slice(prompt.indexOf('## PRIMEIRO CONTATO'), prompt.indexOf('## QUALIFICAÇÃO ADAPTATIVA'));
    expect(firstContact).toContain('<APRESENTACAO_LITERAL>\n[PERIODO]! Muito prazer, sou Aline, do Marketing da Mônaco Automóveis\n</APRESENTACAO_LITERAL>');
    expect(firstContact).not.toContain('Regra de saudação por horário');
    expect(firstContact).not.toContain('Identifique o horário atual');
    expect(firstContact).not.toContain('Texto completo para o campo');
  });

  it('restores immutable Pedro v3 sections after AI editorial changes', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', role: 'Marketing', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline, da Mônaco Automóveis 😊' },
      bloco7_transferencia: { customer_message: '{nome}, vou te conectar com um consultor.' },
      bloco9_empresa: { name: 'Mônaco Automóveis', address: 'Rua Central, 100' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const altered = canonical
      .replace('use `stock_search` no mesmo turno lógico', 'talvez consulte o estoque depois')
      .replace('[PERIODO]! Sou Aline, da Mônaco Automóveis 😊', 'Olá! Sou outra pessoa.')
      .replace('Sua identidade configurada é **Aline**.', 'Sua identidade configurada é **Outra pessoa**.')
      .replace('{nome}, vou te conectar com um consultor.', 'Seu financiamento foi aprovado.')
      .replace('- Endereço: Rua Central, 100', '- Endereço: Rua inventada, 999');

    expect(validateAiGeneratedFunnelPrompt(altered, canonical, config).valid).toBe(false);
    const protectedPrompt = enforceCanonicalV3Sections(altered, canonical);
    expect(protectedPrompt).toContain('use `stock_search` no mesmo turno lógico');
    expect(protectedPrompt).toContain('[PERIODO]! Sou Aline, da Mônaco Automóveis 😊');
    expect(protectedPrompt).toContain('Sua identidade configurada é **Aline**.');
    expect(protectedPrompt).toContain('{nome}, vou te conectar com um consultor.');
    expect(protectedPrompt).toContain('- Endereço: Rua Central, 100');
    expect(protectedPrompt).not.toContain('Seu financiamento foi aprovado.');
    expect(protectedPrompt).not.toContain('Rua inventada, 999');
    expect(validateAiGeneratedFunnelPrompt(protectedPrompt, canonical, config).valid).toBe(true);
  });

  it('restores the root heading and any fixed section omitted by the AI editor', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline, da Mônaco Automóveis 😊' },
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const firstContact = canonical.slice(
      canonical.indexOf('## PRIMEIRO CONTATO'),
      canonical.indexOf('## QUALIFICAÇÃO ADAPTATIVA'),
    ).trim();
    const altered = canonical
      .replace(/^# PEDRO V3[^\n]*\n+/, '')
      .replace(`${firstContact}\n\n`, '');

    expect(validateAiGeneratedFunnelPrompt(altered, canonical, config).valid).toBe(false);
    const protectedPrompt = enforceCanonicalV3Sections(altered, canonical);
    expect(protectedPrompt.startsWith('# PEDRO V3 — PROMPT COMERCIAL DO PORTAL')).toBe(true);
    expect((protectedPrompt.match(/## PRIMEIRO CONTATO/g) ?? []).length).toBe(1);
    expect(protectedPrompt).toContain('[PERIODO]! Sou Aline, da Mônaco Automóveis 😊');
    expect(validateAiGeneratedFunnelPrompt(protectedPrompt, canonical, config)).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('teaches the prompt editor to preserve tool chains without making the engine conduct the sale', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Duda', company: 'Wa Veículos' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Duda, da Wa Veículos 😊' },
      bloco9_empresa: { name: 'Wa Veículos' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const request = buildFunnelPromptEditorRequest(config, canonical);

    expect(request).toContain('SEÇÕES FIXAS DO PRODUTO');
    expect(request).toContain('Preserve literalmente a primeira linha');
    expect(request).toContain('anúncio, consulta de estoque, detalhes, aterramento, fotos, mídia');
    expect(request).toContain('Não troque o preço retornado por uma tool pelo teto de orçamento do lead');
    expect(request).toContain('não transforme a engine em cérebro do atendimento');
    expect(request).not.toContain('peça esclarecimento ao responsável pela configuração');
  });

  it('keeps the general SDR prompt free of automotive capabilities', () => {
    const config = {
      agent_type: 'sdr_geral',
      bloco1_identidade: { agent_name: 'Lia', role: 'SDR', company: 'Acme', niche: 'serviços' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Lia, da Acme.', objective: 'entender a necessidade' },
      bloco9_empresa: { name: 'Acme', address: 'Rua Central, 10', hours: '9h às 18h' },
    };
    const prompt = buildTenantSdrSystemPrompt(config);

    expect(prompt).toContain('Este é um SDR Geral');
    expect(prompt).toContain('Base de conhecimento');
    expect(prompt).not.toContain('stock_search');
    expect(prompt).not.toContain('vehicle_photos_resolve');
    expect(validateAiGeneratedFunnelPrompt(prompt, prompt, config).valid).toBe(true);
  });

  it('rejects an AI prompt that removes the v3 contract or invents engine routing', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Lia', company: 'Acme' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Lia, da Acme.' },
      bloco9_empresa: { name: 'Acme', address: 'Rua Central, 10', hours: '9h às 18h' },
    };
    const result = validateAiGeneratedFunnelPrompt(
      '# PEDRO V3\nA engine deve decidir o assunto e forçar stock_search.',
      buildTenantSdrSystemPrompt(config),
      config,
    );
    expect(result.valid).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('instrução concorrente'))).toBe(true);
  });

  it('rejects common rigid-SDR shortcuts that would compete with the portal prompt', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Lia', company: 'Acme' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Lia, da Acme.' },
      bloco9_empresa: { name: 'Acme', address: 'Rua Central, 10', hours: '9h às 18h' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const result = validateAiGeneratedFunnelPrompt(
      `${canonical}\nSempre termine toda mensagem com uma pergunta. Sempre peça o nome antes de qualquer coisa. Encerre o lead se ele não responder.`,
      canonical,
      config,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons.filter((reason) => reason.includes('instrução concorrente')).length).toBeGreaterThanOrEqual(3);
  });

  it('removes lifecycle and buyer-discouraging pseudo-criteria without deleting objective client policies', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Duda', company: 'Wa Veículos' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Duda, da Wa Veículos.' },
      bloco6_criterios: {
        qualified_when: ['interesse confirmado'],
        disqualified_when: [
          'Não respondeu',
          'Parou de falar no meio do funil',
          'Sem condições financeiras mínimas no momento',
          'Declarou explicitamente que não possui entrada',
          'Mora fora da região atendida pela empresa',
        ],
        closing_message: '{nome}, talvez não seja a melhor oportunidade de compra no momento.',
      },
      bloco9_empresa: { name: 'Wa Veículos' },
    };

    const prompt = buildTenantSdrSystemPrompt(config);
    expect(prompt).not.toContain('Não respondeu');
    expect(prompt).not.toContain('Parou de falar no meio do funil');
    expect(prompt).not.toContain('Sem condições financeiras mínimas no momento');
    expect(prompt).not.toContain('talvez não seja a melhor oportunidade');
    expect(prompt).toContain('Declarou explicitamente que não possui entrada');
    expect(prompt).toContain('Mora fora da região atendida pela empresa');
    expect(prompt).toContain('continuo à disposição');
  });

  it('rejects an AI-generated prompt that republishes a buyer-discouraging judgment', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Duda', company: 'Wa Veículos' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Duda, da Wa Veículos.' },
      bloco9_empresa: { name: 'Wa Veículos' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const result = validateAiGeneratedFunnelPrompt(
      `${canonical}\nMensagem ao lead: Talvez não seja o melhor cenário para comprar agora.`,
      canonical,
      config,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('mensagem que desencoraja ou julga o momento de compra do lead');
  });

  it('removes runtime directives from both the canonical prompt and the AI editing input', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Duda', company: 'Wa Veículos' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Duda, da Wa Veículos.' },
      bloco8_regras: {
        always: [
          'Toda mensagem termina com pergunta de condução',
          'Máximo 2 linhas por mensagem',
          'Respeitar o funil de vendas do prompt',
          'Follow-up mínimo 3-4 horas depois, sempre com contexto',
          'Tratar o cliente pelo nome assim que souber',
        ],
        never: [
          'Nunca deixar conversa terminar sem tentar capturar o contato',
          'Nunca dar desconto sem consultar o vendedor',
        ],
      },
      bloco9_empresa: { name: 'Wa Veículos' },
    };

    const canonical = buildTenantSdrSystemPrompt(config);
    const editorRequest = buildFunnelPromptEditorRequest(config, canonical);
    for (const unsafe of [
      'Toda mensagem termina com pergunta de condução',
      'Máximo 2 linhas por mensagem',
      'Respeitar o funil de vendas do prompt',
      'Follow-up mínimo 3-4 horas depois, sempre com contexto',
      'Nunca deixar conversa terminar sem tentar capturar o contato',
    ]) {
      expect(canonical).not.toContain(unsafe);
      expect(editorRequest).not.toContain(unsafe);
    }
    expect(canonical).toContain('Tratar o cliente pelo nome assim que souber');
    expect(canonical).toContain('Não dar desconto sem consultar o vendedor.');
  });

  it('answers requested facts before qualification and removes stale fact-withholding rules', () => {
    const unsafe = 'Falar preço antes de qualificar';
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: {
        presentation: 'Olá! Sou a Aline, da Mônaco Automóveis.',
        avoid: [unsafe, 'Não repetir perguntas respondidas'],
      },
      bloco8_regras: {
        always: ['Responder com clareza'],
        never: ['Nunca inventar preço'],
      },
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    };

    const canonical = buildTenantSdrSystemPrompt(config);
    const editorRequest = buildFunnelPromptEditorRequest(config, canonical);
    expect(canonical).not.toContain(unsafe);
    expect(editorRequest).not.toContain(unsafe);
    expect(canonical).toContain('Não repetir perguntas respondidas');
    expect(canonical).toContain('Não inventar preço.');
    expect(canonical).toContain('Qualificação não é pré-condição para entregar um fato solicitado');

    const generated = validateAiGeneratedFunnelPrompt(
      `${canonical}\nNunca informe preço antes de qualificar o lead.`,
      canonical,
      config,
    );
    expect(generated.valid).toBe(false);
    expect(generated.reasons).toContain('resposta factual condicionada à qualificação');
  });

  it('rejects AI output that reintroduces a rigid runtime directive', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Duda', company: 'Wa Veículos' },
      bloco3_abordagem: { presentation: 'Olá! Sou a Duda, da Wa Veículos.' },
      bloco9_empresa: { name: 'Wa Veículos' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    for (const directive of [
      'Toda mensagem termina com pergunta de condução.',
      'Máximo 2 linhas por mensagem.',
      'Respeitar o funil de vendas do prompt.',
    ]) {
      const result = validateAiGeneratedFunnelPrompt(`${canonical}\n${directive}`, canonical, config);
      expect(result.valid).toBe(false);
      expect(result.reasons).toContain('regra de runtime ou condução rígida concorrente com o Pedro v3');
    }
  });

  it('reconciles the real Monaco branch conflicts before either AI or fallback can publish them', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', role: 'Marketing', company: 'Mônaco Automóveis', niche: 'automóveis' },
      bloco3_abordagem: {
        presentation: '[PERIODO]! Muito prazer, meu nome é Aline e sou do Marketing da Mônaco Automóveis 😊',
        avoid: ['Pular etapas do funil', 'Repetir perguntas já respondidas'],
      },
      bloco5_ramificacoes: {
        branches: [
          {
            trigger: 'Financiamento',
            questions: ['Coletar CPF, data de nascimento, parcela ideal e valor de entrada. Avançar para aprovação comercial.'],
          },
          {
            trigger: 'Veículo na troca',
            questions: ['Coletar modelo, ano e km do carro. Dar faixa de avaliação e coletar contato para o avaliador.'],
          },
        ],
      },
      bloco8_regras: {
        always: ['Sempre repassar um consultor caso o cliente queira uma avaliação no carro que quer dar na troca.'],
        never: ['Nunca avaliar quanto vale o carro do cliente.'],
      },
      bloco9_empresa: {
        name: 'Mônaco Automóveis',
        hours: 'SEGUNDA À SEXTA 08:00 às 18:30. Sábado é feriado 8:30 às 14:30',
      },
    };

    const safe = sanitizeTenantFunnelPromptConfig(config) as {
      bloco3_abordagem: { avoid: string[] };
      bloco9_empresa: { hours: string };
    };
    const prompt = buildTenantSdrSystemPrompt(config);
    const branches = prompt.slice(prompt.indexOf('## RAMIFICAÇÕES DO FUNIL'), prompt.indexOf('## QUALIFICAÇÃO, DESQUALIFICAÇÃO'));

    expect(safe.bloco3_abordagem.avoid).toEqual(['Repetir perguntas já respondidas']);
    expect(safe.bloco9_empresa.hours).toBe('SEGUNDA À SEXTA 08:00 às 18:30. Sábados e feriados 8:30 às 14:30');
    expect(branches).not.toContain('Coletar CPF, data de nascimento');
    expect(branches).not.toContain('Avançar para aprovação comercial');
    expect(branches).not.toContain('Dar faixa de avaliação');
    expect(branches).toContain('solicitando CPF ou data de nascimento somente se uma análise escolhida pelo lead realmente exigir esses dados');
    expect(branches).toContain('usando handoff quando disponível, sem afirmar aprovação');
    expect(branches).toContain('Coletar modelo, ano e km do carro');
    expect(branches).toContain('usando handoff quando disponível, sem estimar nem afirmar o valor do veículo');
    expect(prompt).toContain('Não avaliar quanto vale o carro do cliente.');
    expect(prompt).not.toContain('Pular etapas do funil');
    expect(validateAiGeneratedFunnelPrompt(prompt, prompt, config)).toEqual({ valid: true, reasons: [] });
  });

  it('rejects an AI edit that reintroduces impossible commercial actions or unconditional PII collection', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline, da Mônaco Automóveis 😊' },
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const candidate = `${canonical}\n- Dar faixa de avaliação do carro para troca.\n- Avançar para aprovação comercial.\n- Coletar CPF e data de nascimento.\n- Não pular etapas do funil.`;
    const result = validateAiGeneratedFunnelPrompt(candidate, canonical, config);

    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'avaliação de veículo prometida sem fonte ou mecanismo executável',
      'aprovação comercial ou financeira prometida sem mecanismo executável',
      'coleta obrigatória de dado sensível sem necessidade e explicação contextual',
      'regra de runtime ou condução rígida concorrente com o Pedro v3',
    ]));
  });

  it('surfaces commercial reconciliation warnings without blocking prompt generation', () => {
    const issues = validateTenantFunnelConfig({
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline.', avoid: ['Pular etapas do funil'] },
      bloco4_qualificacao: {},
      bloco5_ramificacoes: {
        branches: [{
          trigger: 'Financiamento',
          questions: ['Coletar CPF e data de nascimento. Avançar para aprovação comercial.'],
        }],
      },
      bloco6_criterios: {},
      bloco7_transferencia: {},
      bloco8_regras: {},
      bloco9_empresa: { name: 'Mônaco Automóveis', hours: 'Sábado é feriado 8:30 às 14:30' },
    });

    expect(issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'rigid_funnel_sequence',
      'unsupported_commercial_action',
      'sensitive_data_requires_context',
      'ambiguous_business_hours',
    ]));
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('reconciles unsupported actions from Always while preserving explicit prohibitions from Never', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline.' },
      bloco8_regras: {
        always: [
          'Dar faixa de avaliação do carro da troca',
          'Avançar para aprovação comercial',
          'Coletar CPF e data de nascimento',
        ],
        never: [
          'Nunca avaliar quanto vale o carro do cliente',
          'Nunca coletar CPF sem necessidade',
        ],
      },
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    };

    const safe = sanitizeTenantFunnelPromptConfig(config) as {
      bloco8_regras: { always: string[]; never: string[] };
    };
    const prompt = buildTenantSdrSystemPrompt(config);

    expect(safe.bloco8_regras.always.join('\n')).not.toMatch(/Dar faixa de avaliação|Avançar para aprovação|Coletar CPF/);
    expect(safe.bloco8_regras.always.join('\n')).toContain('usando handoff quando disponível');
    expect(safe.bloco8_regras.never).toEqual([
      'Não avaliar quanto vale o carro do cliente.',
      'Não coletar CPF sem necessidade.',
    ]);
    expect(validateAiGeneratedFunnelPrompt(prompt, prompt, config)).toEqual({ valid: true, reasons: [] });
  });

  it('reconciles the residual Monaco prompt rules without competing with Pedro v3', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: {
        agent_name: 'Aline',
        role: 'consultor',
        company: 'MÔNACO AUTOMÓVEIS',
        niche: 'automóveis',
      },
      bloco3_abordagem: {
        presentation: '[PERIODO]! Muito prazer, meu nome é Aline e sou do Marketing da Mônaco Automóveis 😊',
        avoid: [
          'Não seja repetitivo falar as mesma coisas',
          'Não Fingir que sabe ou responder coisas aleatórios do lead',
        ],
      },
      bloco4_qualificacao: {
        required_data: ['Nome', 'Forma de pagamento'],
      },
      bloco5_ramificacoes: { branches: [] },
      bloco6_criterios: {
        qualified_when: [
          'Tem condições financeiras compatíveis',
          'Forneceu todos os dados obrigatórios',
          'Demonstrou interesse em avançar',
        ],
        disqualified_when: [],
      },
      bloco7_transferencia: {
        required_data: [],
        customer_message: '{nome}, vou te conectar agora com nosso especialista da MÔNACO AUTOMÓVEIS! 🤝',
      },
      bloco8_regras: {
        always: [
          'Variar tom e aberturas das mensagens',
          'Máximo 2 linhas por mensagem — uma ideia por vez',
          'Se o cliente pergunta quero o Jeep Renegade cinza mas no estoque tem um preto, mande o preto e informe que não tem o cinza; assim deve ser feito com todos os veículos do estoque',
          'Sempre consultar o BNDV para confirmar se o carro está no estoque e se é o carro pedido, ou similar.',
          'Respeitar o funil de vendas do prompt',
          'Sempre dar a saudação na primeira mensagem',
          'Nunca inventar dados de ano, km, preço ou câmbio',
        ],
        never: [
          'Não fazemos vendas de veículos na promissória.',
          'Não é possível contratar garantia estendida da loja',
          'Dar garantia que não seja câmbio e motor; qualquer outro item não tem garantia.',
        ],
      },
      bloco9_empresa: { name: 'MÔNACO AUTOMÓVEIS' },
    };

    const safe = sanitizeTenantFunnelPromptConfig(config) as {
      bloco3_abordagem: { avoid: string[] };
      bloco6_criterios: { qualified_when: string[] };
      bloco8_regras: { always: string[]; never: string[] };
    };
    const prompt = buildTenantSdrSystemPrompt(config);
    const safeRules = safe.bloco8_regras.always.join('\n');

    expect(safe.bloco3_abordagem.avoid).toEqual([
      'Repetir informações ou perguntas já respondidas.',
      'Fingir que entendeu ou responder algo sem relação com o que o lead disse.',
    ]);
    expect(safe.bloco6_criterios.qualified_when).not.toEqual(expect.arrayContaining([
      'Tem condições financeiras compatíveis',
      'Forneceu todos os dados obrigatórios',
    ]));
    expect(safe.bloco6_criterios.qualified_when).toEqual(expect.arrayContaining([
      'Demonstrou interesse em avançar',
      expect.stringContaining('dados preferenciais ainda ausentes não bloqueiam'),
    ]));
    expect(safeRules).not.toMatch(/BNDV|não tem o cinza|saudação na primeira mensagem|Nunca inventar|Máximo 2 linhas|Respeitar o funil/i);
    expect(safeRules).toContain('não foi confirmada no resultado atual');
    expect(safeRules).toContain('Depois da apresentação literal do primeiro contato');
    expect(safe.bloco8_regras.never).toEqual([
      'Não afirmar nem oferecer vendas de veículos na promissória como prática da empresa.',
      'Não afirmar que é possível contratar garantia estendida da loja.',
      'Não dar garantia que não seja câmbio e motor; qualquer outro item não tem garantia.',
      'Não inventar dados de ano, km, preço ou câmbio.',
    ]);
    expect(prompt).toContain('Sua identidade configurada é **Aline**. Seu cargo configurado é **consultor**');
    expect(prompt).toContain('nunca mostre `{nome}` ao lead');
    expect(prompt).not.toContain('Você é **Aline**, consultor');
    expect(validateAiGeneratedFunnelPrompt(prompt, prompt, config)).toEqual({ valid: true, reasons: [] });
    expect(sanitizeTenantFunnelPromptConfig(safe)).toEqual(safe);

    const warningCodes = validateTenantFunnelConfig(config)
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.code);
    expect(warningCodes).toEqual(expect.arrayContaining([
      'unsupported_stock_absence',
      'redundant_operational_directive',
      'undefined_qualification_criterion',
      'first_contact_conflict',
      'ambiguous_prohibition_wording',
    ]));
  });

  it('drops an undefined mandatory-data qualification criterion when no preferred data exists', () => {
    const safe = sanitizeTenantFunnelPromptConfig({
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline.' },
      bloco4_qualificacao: { required_data: [] },
      bloco6_criterios: { qualified_when: ['Forneceu todos os dados obrigatórios'] },
      bloco7_transferencia: { required_data: [] },
      bloco8_regras: {},
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    }) as { bloco6_criterios: { qualified_when: string[] } };

    expect(safe.bloco6_criterios.qualified_when).toEqual([]);
  });

  it('rejects an AI edit that reintroduces the residual semantic conflicts', () => {
    const config = {
      agent_type: 'sdr',
      bloco1_identidade: { agent_name: 'Aline', company: 'Mônaco Automóveis' },
      bloco3_abordagem: { presentation: '[PERIODO]! Sou Aline.' },
      bloco4_qualificacao: {},
      bloco5_ramificacoes: { branches: [] },
      bloco6_criterios: {},
      bloco7_transferencia: {},
      bloco8_regras: {},
      bloco9_empresa: { name: 'Mônaco Automóveis' },
    };
    const canonical = buildTenantSdrSystemPrompt(config);
    const candidate = `${canonical}
- Informe que não temos a cor cinza e apresente o preto.
- Sempre consultar o BNDV antes de responder.
- Sempre dar a saudação na primeira mensagem.
- Variar tom e aberturas das mensagens.
- Considere qualificado quando tiver condições financeiras compatíveis.
- Considere qualificado quando fornecer todos os dados obrigatórios.`;
    const result = validateAiGeneratedFunnelPrompt(candidate, canonical, config);

    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'ausência de característica de estoque afirmada sem prova factual suficiente',
      'instrução de provedor de estoque concorrente com o contrato operacional v3',
      'regra de saudação duplicada fora do contrato literal do primeiro contato',
      'variação de abertura concorrente com a apresentação literal do primeiro contato',
      'qualificação baseada em julgamento financeiro subjetivo sem critério objetivo',
      'qualificação condicionada a dados obrigatórios não definidos objetivamente',
    ]));
  });
});
