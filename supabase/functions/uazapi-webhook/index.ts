// ─── Inline PostgREST client (no external imports) ──────────────────────────
function createSupabaseClient(url: string, key: string) {
  const restBase = `${url}/rest/v1`;
  const baseHeaders: Record<string, string> = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  type FilterEntry = { col: string; op: string; val: string };
  type OrderEntry = { column: string; ascending: boolean; nullsFirst: boolean };

  function buildQuery(table: string) {
    let _select: string | null = null;
    let _filters: FilterEntry[] = [];
    let _orders: OrderEntry[] = [];
    let _limit: number | null = null;
    let _maybeSingle = false;
    let _body: any = null;
    let _method: 'GET' | 'POST' | 'PATCH' = 'GET';
    let _returnSelect: string | null = null;
    let _upsertConflict: string | null = null;
    let _ignoreDuplicates = false;

    const builder: any = {
      select(cols?: string) {
        if (_method === 'PATCH') {
          _returnSelect = cols || '*';
          return builder;
        }
        _select = cols || '*';
        return builder;
      },
      eq(col: string, val: any) {
        _filters.push({ col, op: 'eq', val: String(val) });
        return builder;
      },
      gt(col: string, val: any) {
        _filters.push({ col, op: 'gt', val: String(val) });
        return builder;
      },
      lte(col: string, val: any) {
        _filters.push({ col, op: 'lte', val: String(val) });
        return builder;
      },
      is(col: string, val: any) {
        _filters.push({ col, op: 'is', val: String(val) });
        return builder;
      },
      not(col: string, op: string, val: any) {
        _filters.push({ col, op: `not.${op}`, val: String(val) });
        return builder;
      },
      in(col: string, vals: any[]) {
        const list = vals.map((v: any) => `"${v}"`).join(',');
        _filters.push({ col, op: 'in', val: `(${list})` });
        return builder;
      },
      contains(col: string, val: any) {
        // PostgREST @> operator → cs. filter
        const encodedVal = Array.isArray(val)
          ? `{${val.map((v: any) => String(v).replace(/"/g, '\\"')).join(',')}}`
          : JSON.stringify(val);
        _filters.push({ col, op: 'cs', val: encodedVal });
        return builder;
      },
      ilike(col: string, val: string) {
        _filters.push({ col, op: 'ilike', val });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        _orders.push({
          column,
          ascending: opts?.ascending ?? true,
          nullsFirst: opts?.nullsFirst ?? false,
        });
        return builder;
      },
      limit(n: number) {
        _limit = n;
        return builder;
      },
      maybeSingle() {
        _maybeSingle = true;
        return builder._execute();
      },
      update(data: any) {
        _method = 'PATCH';
        _body = data;
        return builder;
      },
      insert(data: any) {
        _method = 'POST';
        _body = data;
        return builder._execute();
      },
      upsert(data: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        _method = 'POST';
        _body = data;
        if (opts?.onConflict) _upsertConflict = opts.onConflict;
        if (opts?.ignoreDuplicates) _ignoreDuplicates = true;
        return builder._execute();
      },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        return builder._execute().then(resolve, reject);
      },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();

        // select param
        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);

        // filters
        for (const f of _filters) {
          params.append(f.col, `${f.op}.${f.val}`);
        }

        // order
        for (const o of _orders) {
          let orderStr = o.column;
          if (!o.ascending) orderStr += '.desc';
          else orderStr += '.asc';
          if (o.nullsFirst) orderStr += '.nullsfirst';
          else orderStr += '.nullslast';
          params.append('order', orderStr);
        }

        // limit
        if (_limit !== null) {
          params.set('limit', String(_limit));
        }

        // upsert on_conflict
        if (_upsertConflict) {
          params.set('on_conflict', _upsertConflict);
        }

        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;

        const headers: Record<string, string> = { ...baseHeaders };

        if (_method === 'PATCH' && _returnSelect) {
          headers['Prefer'] = 'return=representation';
        }
        if (_method === 'POST' && _upsertConflict) {
          // upsert
          const parts = ['return=minimal', 'resolution=merge-duplicates'];
          if (_ignoreDuplicates) parts[1] = 'resolution=ignore-duplicates';
          headers['Prefer'] = parts.join(',');
        } else if (_method === 'POST') {
          headers['Prefer'] = 'return=minimal';
        }
        if (_maybeSingle) {
          headers['Accept'] = 'application/vnd.pgrst.object+json';
        }

        try {
          const res = await fetch(urlStr, {
            method: _method,
            headers,
            body: _body ? JSON.stringify(_body) : undefined,
          });

          if (_maybeSingle && res.status === 406) {
            return { data: null, error: null };
          }

          if (!res.ok) {
            const errBody = await res.text();
            return { data: null, error: { message: errBody, status: res.status } };
          }

          if (_method === 'POST' && !_returnSelect) {
            return { data: null, error: null };
          }
          if (_method === 'PATCH' && !_returnSelect) {
            return { data: null, error: null };
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('json')) {
            return { data: null, error: null };
          }

          const data = await res.json();
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return buildQuery(table);
    },
    async rpc(fnName: string, params: any): Promise<{ data: any; error: any }> {
      const urlStr = `${restBase}/rpc/${fnName}`;
      try {
        const res = await fetch(urlStr, {
          method: 'POST',
          headers: { ...baseHeaders },
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          const errBody = await res.text();
          return { data: null, error: { message: errBody, status: res.status } };
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('json')) {
          return { data: null, error: null };
        }
        const data = await res.json();
        return { data, error: null };
      } catch (err: any) {
        return { data: null, error: { message: err.message } };
      }
    },
  };
}

// ─── CORS headers ───────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// PEDRO CONVERSATION STATE — extração + formatação + merge
// ============================================================================
// Resolve causa raiz de 12/16 bugs (caso Roberta 2026-05-15): agente não tinha
// memória estruturada, só histórico cru. Resultado: pedia nome 4x, troca 3x,
// re-apresentava ficha 3x, etc.
//
// Fluxo:
//  1. Cliente envia mensagem
//  2. extractEntitiesWithClaude(msg, currentState) → delta JSON via Claude Haiku 4.5
//  3. deepMerge(currentState, delta) → newState
//  4. UPSERT em pedro_conversation_state
//  5. formatStateForPrompt(newState) → bloco de texto injetado no system prompt do GPT-4o
//  6. GPT-4o vê "✅ Nome: Roberta" e NUNCA mais pergunta o nome.
// ============================================================================

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;
  const result: any = Array.isArray(target) ? [...(target || [])] : { ...(target || {}) };
  for (const key of Object.keys(source)) {
    const srcVal = (source as any)[key];
    const tgtVal = result[key];
    if (srcVal === null || srcVal === undefined) continue; // não sobrescreve com null
    if (typeof srcVal === 'object' && !Array.isArray(srcVal) && typeof tgtVal === 'object' && tgtVal !== null && !Array.isArray(tgtVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
      // Para arrays, faz union deduplicado (caso de objecoes[])
      result[key] = Array.from(new Set([...tgtVal, ...srcVal]));
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

const CLAUDE_HAIKU_MODEL_CANDIDATES = [
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20260101',
  'claude-3-5-haiku-20241022', // fallback antigo se nada acima funcionar
];

async function extractEntitiesWithClaude(args: {
  message: string;
  currentState: any;
  previousAgentMessage: string;
  apiKey: string;
}): Promise<{ delta: any; eco: boolean; objecoes: string[] }> {
  const { message, currentState, previousAgentMessage, apiKey } = args;

  const systemPrompt = `Você é um extrator de entidades pra um SDR de concessionária automotiva no WhatsApp. Sua única tarefa: receber a mensagem do cliente e devolver SOMENTE os campos NOVOS extraídos, em JSON. NÃO repita dados já presentes no estado atual. NÃO invente. Se não tem certeza, deixe null.

Schema possível (extraia só o que se aplica à mensagem atual):
{
  "lead": { "nome", "nome_completo", "telefone", "cidade", "conhece_loja" (bool), "acompanhante_decisao" },
  "interesse": { "modelo_desejado", "configuracao", "combustivel", "cambio", "ano_desejado" },
  "negociacao": { "forma_pagamento" ("à vista"|"financiado"|"troca"), "valor_entrada", "tem_troca" (bool), "carro_troca": { "modelo", "ano", "cambio", "configuracao", "km", "status" } },
  "atendimento": { "pode_visitar_loja" (bool), "modo_atendimento" ("remoto"|"presencial") },
  "objecoes_novas": ["nao_pode_visitar"|"esposo_decide"|"longe"|"nao_quer_financiar"|"orcamento_baixo"|...],
  "eco_detectado": true/false (cliente repetiu uma palavra que o agente acabou de dizer? ex: agente disse "Sou o Carvalho" e cliente respondeu "Carvalho" — isso é ECO, não é o nome do cliente)
}

Regras críticas:
- "este é um problema" / "fica longe" / "não posso ir" / "só na folga do esposo" → atendimento.pode_visitar_loja=false E objecoes_novas inclui "nao_pode_visitar"
- "à vista" / "vou pagar à vista" / "tô com o dinheiro" → negociacao.forma_pagamento="à vista"
- "não quero financiar" → negociacao.forma_pagamento="à vista" (provavelmente)
- "tenho um/uma X" (carro) → negociacao.tem_troca=true E carro_troca.modelo=X
- "Cabine dupla, manual, 2018" como resposta a pergunta sobre carro → preencher carro_troca
- Telefone (10-13 dígitos) → lead.telefone
- Se a mensagem é claramente eco/repetição do que o agente acabou de dizer → eco_detectado=true E NÃO preencha lead.nome
- Mensagens curtas tipo só "Sim", "Não", "Ok" sem contexto novo → retorne {}

Se nada de novo, retorne {}.`;

  const userMsg = `ESTADO ATUAL DA CONVERSA:\n\`\`\`json\n${JSON.stringify(currentState, null, 2)}\n\`\`\`\n\nÚLTIMA MENSAGEM DO AGENTE (para detectar eco):\n"${previousAgentMessage || '(início da conversa)'}"\n\nNOVA MENSAGEM DO CLIENTE:\n"${message}"\n\nResponda APENAS com JSON válido. Sem markdown, sem explicação.`;

  // Tenta cada modelo até um funcionar (Anthropic às vezes muda IDs)
  for (const model of CLAUDE_HAIKU_MODEL_CANDIDATES) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 404 || err.includes('model')) {
          console.warn(`[extractEntities] modelo ${model} indisponível, tentando próximo`);
          continue;
        }
        console.warn(`[extractEntities] Claude ${model} erro ${res.status}: ${err.slice(0, 200)}`);
        return { delta: {}, eco: false, objecoes: [] };
      }

      const data = await res.json();
      const text = data?.content?.[0]?.text || '{}';

      // Parse — extrai JSON do texto
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { delta: {}, eco: false, objecoes: [] };

      const parsed = JSON.parse(jsonMatch[0]);
      const eco = !!parsed.eco_detectado;
      const objecoes: string[] = Array.isArray(parsed.objecoes_novas) ? parsed.objecoes_novas : [];
      delete parsed.eco_detectado;
      delete parsed.objecoes_novas;

      console.log(`[extractEntities] modelo=${model} eco=${eco} objecoes=${objecoes.length} keys=${Object.keys(parsed).join(',')}`);
      return { delta: parsed, eco, objecoes };
    } catch (err) {
      console.warn(`[extractEntities] exception com ${model}:`, err);
      continue;
    }
  }
  console.error('[extractEntities] TODOS os modelos Claude falharam — extração desabilitada neste turno');
  return { delta: {}, eco: false, objecoes: [] };
}

// Camada 2 do Bug #2 (re-apresentação): detector de auto-apresentação
// expandido pra cobrir 7 padrões variantes. A regex one-liner antiga falhava
// em "Consultor da BNDV", "Sou Carvalho" (sem artigo), "Sou consultor da loja".
function isAgentSelfIntroduction(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /\bsou (o|a)\s+\w+/i,                                  // "Sou o Carvalho", "Sou a Maria"
    /\bsou (carvalho|consultor|representante|atendente|gerente|vendedor)\b/i, // "Sou Carvalho", "Sou consultor"
    /\beu sou\s+\w+/i,                                     // "Eu sou Carvalho"
    /\bme chamo\s+\w+/i,                                   // "Me chamo Carvalho"
    /\baqui (é|fala)\s+(o\s+|a\s+)?\w+/i,                  // "Aqui é o Carvalho", "Aqui fala Carvalho"
    /\bconsultor (d[aoe]|do|da)\s+\w+/i,                   // "Consultor da BNDV", "Consultor do showroom"
    /\b(meu nome|chamo-me)\s+(é\s+)?\w+/i,                 // "Meu nome é Carvalho", "Chamo-me Carvalho"
  ];
  return patterns.some((p) => p.test(text));
}

// Camada 3 do Bug #2: guard programático. Remove auto-apresentação da resposta
// se o agente JÁ se apresentou antes (state.atendimento.consultor_apresentado=true).
// Defesa contra o LLM ignorar a regra do system prompt esporadicamente.
// Estratégia: split em frases mantendo pontuação, descarta as que contêm padrão
// de apresentação, reconstrói. Se a resposta era SÓ apresentação, retorna fallback.
function stripIntroIfAlreadyPresented(text: string, state: any): string {
  if (!text || !state?.atendimento?.consultor_apresentado) return text;
  if (!isAgentSelfIntroduction(text)) return text;

  const sentences = text.split(/([.!?]+\s*)/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (isAgentSelfIntroduction(s)) {
      // pula essa frase + o separador de pontuação subsequente (se houver)
      if (i + 1 < sentences.length && /^[.!?]+\s*$/.test(sentences[i + 1])) i++;
      continue;
    }
    kept.push(s);
  }
  const result = kept.join('').trim();
  if (result.length < 10) {
    console.warn(`[Pedro-Guard] Resposta era SÓ apresentação ("${text.slice(0, 80)}..."), substituída por fallback`);
    return 'Pode mandar 😊';
  }
  console.warn(`[Pedro-Guard] Removida re-apresentação | original: "${text.slice(0, 100)}" → final: "${result.slice(0, 100)}"`);
  return result;
}

function applyAgentSelfFlags(state: any, agentReply: string): any {
  // Heurísticas pós-resposta do agente: detecta auto-apresentação, envio de ficha, etc.
  const txt = (agentReply || '').toLowerCase();
  const updates: any = {};
  if (isAgentSelfIntroduction(agentReply) && !state?.atendimento?.consultor_apresentado) {
    updates.atendimento = { ...(updates.atendimento || {}), consultor_apresentado: true };
  }
  // Envio de ficha completa (heurística: 3+ campos típicos juntos)
  const fichaSignals = ['modelo:', 'ano:', 'preço:', 'cor:', 'kilometragem', 'câmbio', 'combustível'];
  const fichaMatches = fichaSignals.filter(s => txt.includes(s)).length;
  if (fichaMatches >= 3) {
    updates.veiculo_apresentado = { ...(updates.veiculo_apresentado || {}), ja_apresentado: true };
  }
  return updates;
}

function formatStateForPrompt(state: any): string {
  if (!state || Object.keys(state).length === 0) return '';

  const lines: string[] = [];
  lines.push('## ESTADO DA CONVERSA — DADOS JÁ COLETADOS (NÃO PERGUNTAR DE NOVO)');
  lines.push('');

  // Lead
  if (state.lead?.nome || state.lead?.nome_completo) {
    lines.push(`✅ Nome: ${state.lead.nome_completo || state.lead.nome}`);
  }
  if (state.lead?.telefone) lines.push(`✅ Telefone: ${state.lead.telefone}`);
  if (state.lead?.cidade) lines.push(`✅ Cidade: ${state.lead.cidade}`);
  if (state.lead?.conhece_loja !== null && state.lead?.conhece_loja !== undefined) {
    lines.push(`✅ Conhece a loja: ${state.lead.conhece_loja ? 'sim' : 'não'}`);
  }
  if (state.lead?.acompanhante_decisao) lines.push(`✅ Acompanhante na decisão: ${state.lead.acompanhante_decisao}`);

  // Interesse
  if (state.interesse?.modelo_desejado) {
    const conf = [state.interesse.configuracao, state.interesse.combustivel, state.interesse.cambio, state.interesse.ano_desejado].filter(Boolean).join(', ');
    lines.push(`✅ Modelo de interesse: ${state.interesse.modelo_desejado}${conf ? ' (' + conf + ')' : ''}`);
  }

  // Negociação
  if (state.negociacao?.forma_pagamento) lines.push(`✅ Forma de pagamento: ${state.negociacao.forma_pagamento}`);
  if (state.negociacao?.valor_entrada) lines.push(`✅ Valor de entrada: ${state.negociacao.valor_entrada}`);
  if (state.negociacao?.tem_troca && state.negociacao?.carro_troca) {
    const ct = state.negociacao.carro_troca;
    const trocaParts = [ct.modelo, ct.ano, ct.configuracao, ct.cambio].filter(Boolean).join(' ');
    lines.push(`✅ Carro de troca: ${trocaParts || 'sim'}${ct.status ? ' (status: ' + ct.status + ')' : ''}`);
    if (ct.km) lines.push(`   - KM: ${ct.km}`);
  }

  // Veículo apresentado
  if (state.veiculo_apresentado?.ja_apresentado) {
    const vp = state.veiculo_apresentado;
    lines.push(`✅ Veículo APRESENTADO: ${vp.modelo || ''} ${vp.ano || ''}${vp.preco ? ' — R$ ' + vp.preco : ''}`);
    lines.push(`   - ${vp.foto_enviada ? 'Foto JÁ enviada' : 'Foto não enviada'}${vp.vehicle_id ? ' (id: ' + vp.vehicle_id + ')' : ''}`);
  }

  // Atendimento
  if (state.atendimento?.consultor_apresentado) lines.push(`✅ Você (consultor) JÁ se apresentou`);
  if (state.atendimento?.pode_visitar_loja === false) {
    lines.push(`⚠️ Cliente NÃO pode visitar a loja (${state.atendimento.recusas_visita || 0} recusas) — modo: REMOTO`);
  }
  if (state.atendimento?.objecoes && state.atendimento.objecoes.length > 0) {
    lines.push(`⚠️ Objeções já levantadas: ${state.atendimento.objecoes.join(', ')}`);
  }

  lines.push('');
  lines.push('## REGRAS BASEADAS NO ESTADO ACIMA (CRÍTICAS):');
  lines.push('- NUNCA pergunte dados marcados com ✅ — você JÁ TEM essa informação.');
  lines.push('- Para dados ausentes, peça UM por vez na ordem natural.');
  if (state.atendimento?.pode_visitar_loja === false) {
    lines.push('- ❌ NÃO ofereça visita à loja — cliente já recusou. Foque em fechar 100% remoto.');
  }
  if (state.veiculo_apresentado?.ja_apresentado) {
    lines.push('- ❌ NÃO reapresente a ficha completa do veículo — já enviou. Responda perguntas pontuais em UMA frase curta.');
    lines.push('');
    lines.push('  EXEMPLOS DE RESPOSTA CURTA (siga este padrão — espelhe o tamanho do cliente):');
    lines.push('  • Cliente: "Que ano?" → Você: "É 2023 😊"');
    lines.push('  • Cliente: "Qual KM e ano?" → Você: "53.700 km, 2023" (compound: 2 dados, 2 valores curtos)');
    lines.push('  • Cliente: "É flex?" → Você: "Sim, é flex"');
    lines.push('  • Cliente: "Tem em outra cor?" → Você: "Tenho em prata e branco também"');
    lines.push('  • Cliente: "Me conta mais sobre" → APRESENTAÇÃO COMPLETA OK (cliente pediu detalhe)');
    lines.push('');
  }
  if (state.atendimento?.consultor_apresentado) {
    lines.push('- ❌ NÃO se reapresente como "Sou o Carvalho..." — cliente já sabe. Se perguntar, responda só "É o Carvalho 😊"');
  }
  if (state.veiculo_apresentado?.foto_enviada) {
    lines.push('- ❌ NÃO reenvie fotos do mesmo veículo (a menos que o cliente peça explicitamente).');
  }
  lines.push('- Espelhe o tamanho da mensagem do cliente. Cliente curto → resposta curta.');

  // Lembrete final em CAPS — combate recency bias do GPT-4o (regra colocada no fim
  // tem mais peso na atenção do modelo do que regras enterradas no meio)
  if (state.veiculo_apresentado?.ja_apresentado) {
    lines.push('');
    lines.push('⚠️ LEMBRETE FINAL: VEÍCULO JÁ APRESENTADO. ESPELHE O TAMANHO DA PERGUNTA. CLIENTE CURTO = VOCÊ CURTO. SEMPRE.');
  }

  // IT-2.1: apenda bloco BANT quando flag on. Mostra ao LLM em que estagio
  // de qualificacao o lead esta + sugere proxima acao. NAO altera state.
  if (isPedroFeatureEnabled('BANT_QUALIFICATION')) {
    const bant = deriveBantFromState(state);
    const bantBlock = formatBantBlock(bant);
    if (bantBlock) {
      lines.push('');
      lines.push(bantBlock);
    }
  }

  // IT-2.2: apenda bloco LEAD SCORE quando flag on. Inclui breakdown
  // (criterios passados + penalidades + faltam) - LLM enxerga o que esta
  // pesando no score atual e o que precisa coletar pra subir o tier.
  if (isPedroFeatureEnabled('LEAD_SCORING')) {
    const scoreResult = calcLeadScoreV2(state);
    lines.push('');
    lines.push(formatLeadScoreBlock(scoreResult));
  }

  return lines.join('\n');
}

// ─── BANT Schema (INLINED from _shared/qualification/bantSchema.ts) ────────
// IT-2.1: deriva estagio Budget/Authority/Need/Timeline do state existente.
// NAO adiciona campos no JSONB — apenas calcula status e formata bloco
// pro system prompt. Fonte canônica + testes:
// supabase/functions/_shared/qualification/bantSchema.ts
type BantBudgetStatus = 'known' | 'unknown';
type BantAuthorityStatus = 'sole' | 'shared' | 'unknown';
type BantNeedStatus = 'specific' | 'exploring' | 'unknown';
type BantTimelineStatus = 'ready_to_close' | 'evaluating' | 'discovery';
type BantStatus = {
  budget: { status: BantBudgetStatus; detail: string };
  authority: { status: BantAuthorityStatus; detail: string };
  need: { status: BantNeedStatus; detail: string };
  timeline: { status: BantTimelineStatus; detail: string };
  overallStage: 'cold' | 'discovery' | 'qualifying' | 'qualified' | 'ready_to_handoff';
  nextSuggestedAsk: string;
};

function deriveBantFromState(state: any): BantStatus {
  const s = state || {};
  const formaPagamento = s.negociacao?.forma_pagamento;
  const valorEntrada = s.negociacao?.valor_entrada;
  const temTroca = s.negociacao?.tem_troca;
  let budgetStatus: BantBudgetStatus = 'unknown';
  let budgetDetail = 'forma de pagamento não informada';
  if (formaPagamento) {
    budgetStatus = 'known';
    const parts = [`forma: ${formaPagamento}`];
    if (valorEntrada) parts.push(`entrada: ${valorEntrada}`);
    if (temTroca === true) parts.push('com troca');
    budgetDetail = parts.join(', ');
  } else if (temTroca === true) {
    budgetStatus = 'known';
    budgetDetail = 'troca declarada, forma pendente';
  }

  const acompanhante = s.lead?.acompanhante_decisao;
  let authorityStatus: BantAuthorityStatus = 'unknown';
  let authorityDetail = 'não sabemos se decide sozinho';
  if (typeof acompanhante === 'string' && acompanhante.trim().length > 0) {
    authorityStatus = 'shared';
    authorityDetail = `precisa consultar ${acompanhante}`;
  } else if (s.lead?.nome) {
    authorityStatus = 'sole';
    authorityDetail = 'decide sozinho (sem acompanhante mencionado)';
  }

  const modelo = s.interesse?.modelo_desejado;
  const jaApresentado = !!s.veiculo_apresentado?.ja_apresentado;
  let needStatus: BantNeedStatus = 'unknown';
  let needDetail = 'modelo de interesse não definido';
  if (modelo) {
    needStatus = 'specific';
    const conf = [s.interesse?.configuracao, s.interesse?.combustivel, s.interesse?.cambio, s.interesse?.ano_desejado].filter(Boolean).join(', ');
    needDetail = jaApresentado ? `${modelo} já apresentado` : `${modelo}${conf ? ` (${conf})` : ''}`;
  } else if (jaApresentado) {
    needStatus = 'exploring';
    needDetail = 'veículo apresentado mas modelo de interesse não setado';
  }

  let timelineStatus: BantTimelineStatus = 'discovery';
  let timelineDetail = 'início da conversa, ainda explorando';
  const budgetOk = budgetStatus === 'known';
  const needOk = needStatus === 'specific' || jaApresentado;
  const authorityOk = authorityStatus === 'sole';
  if (budgetOk && needOk && authorityOk) {
    timelineStatus = 'ready_to_close';
    timelineDetail = 'BNA completo + decide sozinho';
  } else if (needOk && (budgetOk || authorityOk)) {
    timelineStatus = 'evaluating';
    timelineDetail = 'tem clareza de necessidade, falta detalhe';
  } else if (needOk || budgetOk) {
    timelineStatus = 'evaluating';
    timelineDetail = '1 dimensão clara, outras pendentes';
  }

  const knownCount = [budgetStatus === 'known', authorityStatus !== 'unknown', needStatus !== 'unknown'].filter(Boolean).length;
  let overallStage: BantStatus['overallStage'] = 'cold';
  if (timelineStatus === 'ready_to_close') overallStage = 'ready_to_handoff';
  else if (knownCount === 3) overallStage = 'qualified';
  else if (knownCount === 2) overallStage = 'qualifying';
  else if (knownCount === 1) overallStage = 'discovery';

  let nextSuggestedAsk = 'Perguntar qual modelo o cliente está procurando';
  if (needStatus === 'unknown') {
    nextSuggestedAsk = 'Perguntar qual modelo/tipo de carro o cliente quer';
  } else if (budgetStatus === 'unknown') {
    nextSuggestedAsk = 'Perguntar forma de pagamento (à vista, financiar, troca)';
  } else if (authorityStatus === 'unknown') {
    nextSuggestedAsk = 'Confirmar nome do cliente (ajuda a saber se decide sozinho)';
  } else if (overallStage === 'ready_to_handoff') {
    nextSuggestedAsk = 'Transferir pra vendedor humano via tool transferir_para_vendedor';
  } else if (jaApresentado && !s.lead?.telefone) {
    nextSuggestedAsk = 'Pedir telefone pra preparar o handoff';
  }

  return {
    budget: { status: budgetStatus, detail: budgetDetail },
    authority: { status: authorityStatus, detail: authorityDetail },
    need: { status: needStatus, detail: needDetail },
    timeline: { status: timelineStatus, detail: timelineDetail },
    overallStage,
    nextSuggestedAsk,
  };
}

function formatBantBlock(bant: BantStatus): string {
  if (bant.overallStage === 'cold') return '';
  const lines: string[] = [];
  lines.push('## QUALIFICAÇÃO BANT (status atual)');
  lines.push(`- **Budget**: ${bant.budget.status} — ${bant.budget.detail}`);
  lines.push(`- **Authority**: ${bant.authority.status} — ${bant.authority.detail}`);
  lines.push(`- **Need**: ${bant.need.status} — ${bant.need.detail}`);
  lines.push(`- **Timeline**: ${bant.timeline.status} — ${bant.timeline.detail}`);
  lines.push(`- **Estágio geral**: ${bant.overallStage}`);
  lines.push(`- **Próxima ação sugerida**: ${bant.nextSuggestedAsk}`);
  return lines.join('\n');
}

function calcQualificationScore(state: any): number {
  let s = 0;
  if (state?.lead?.nome) s += 10;
  if (state?.lead?.telefone) s += 20;
  if (state?.interesse?.modelo_desejado) s += 15;
  if (state?.negociacao?.forma_pagamento) s += 15;
  if (state?.negociacao?.tem_troca !== null && state?.negociacao?.tem_troca !== undefined) s += 10;
  if (state?.veiculo_apresentado?.ja_apresentado) s += 10;
  if (state?.lead?.cidade || state?.lead?.conhece_loja !== null) s += 5;
  if (state?.atendimento?.modo_atendimento) s += 5;
  return Math.min(100, s);
}

// ─── Lead Scoring V2 (INLINED from _shared/qualification/leadScoring.ts) ───
// IT-2.2: scoring com criterios explicitos, breakdown e tier categorico.
// Mantém compat com V1 (mesmo intervalo 0-100). Quando flag on, substitui
// V1 no UPSERT da coluna qualificacao_score.
// Fonte canônica + testes: supabase/functions/_shared/qualification/leadScoring.ts
type LeadTier = 'cold' | 'warm' | 'hot' | 'qualified';
type ScoringCriterion = {
  key: string;
  label: string;
  weight: number;
  passed: boolean;
  reason: string;
};
type LeadScoreResult = {
  score: number;
  tier: LeadTier;
  breakdown: ScoringCriterion[];
  rawPositive: number;
  rawPenalties: number;
};

function getLeadTier(score: number): LeadTier {
  if (score >= 80) return 'qualified';
  if (score >= 50) return 'hot';
  if (score >= 20) return 'warm';
  return 'cold';
}

function calcLeadScoreV2(state: any): LeadScoreResult {
  const s = state || {};
  const breakdown: ScoringCriterion[] = [
    { key: 'nome', label: 'Nome do cliente coletado', weight: 10, passed: !!s.lead?.nome, reason: s.lead?.nome ? `nome="${s.lead?.nome_completo || s.lead?.nome}"` : 'lead.nome ausente' },
    { key: 'telefone', label: 'Telefone direto confirmado', weight: 20, passed: !!s.lead?.telefone, reason: s.lead?.telefone ? `telefone="${s.lead.telefone}"` : 'lead.telefone ausente' },
    { key: 'modelo_desejado', label: 'Modelo de interesse declarado', weight: 15, passed: !!s.interesse?.modelo_desejado, reason: s.interesse?.modelo_desejado ? `modelo="${s.interesse.modelo_desejado}"` : 'interesse.modelo_desejado ausente' },
    { key: 'forma_pagamento', label: 'Forma de pagamento definida (BANT Budget)', weight: 15, passed: !!s.negociacao?.forma_pagamento, reason: s.negociacao?.forma_pagamento ? `forma="${s.negociacao.forma_pagamento}"` : 'negociacao.forma_pagamento ausente' },
    { key: 'tem_troca_definido', label: 'Cliente respondeu sobre troca (sim/nao)', weight: 10, passed: s.negociacao?.tem_troca !== null && s.negociacao?.tem_troca !== undefined, reason: s.negociacao?.tem_troca === true ? 'tem troca declarada' : s.negociacao?.tem_troca === false ? 'sem troca declarada' : 'tem_troca pendente' },
    { key: 'veiculo_apresentado', label: 'Veiculo ja apresentado (engagement avancou)', weight: 10, passed: !!s.veiculo_apresentado?.ja_apresentado, reason: s.veiculo_apresentado?.ja_apresentado ? `${s.veiculo_apresentado?.modelo || 'veiculo'} apresentado` : 'ainda nao apresentou veiculo' },
    { key: 'decide_sozinho', label: 'Decide sozinho (BANT Authority sole)', weight: 10, passed: !!s.lead?.nome && !(typeof s.lead?.acompanhante_decisao === 'string' && s.lead.acompanhante_decisao.trim().length > 0), reason: s.lead?.acompanhante_decisao ? `compartilhada com ${s.lead.acompanhante_decisao}` : s.lead?.nome ? 'sem acompanhante mencionado' : 'nome ausente — nao da pra inferir' },
    { key: 'dados_auxiliares', label: 'Cidade ou conhecimento da loja', weight: 5, passed: !!s.lead?.cidade || (s.lead?.conhece_loja !== null && s.lead?.conhece_loja !== undefined), reason: s.lead?.cidade ? `cidade="${s.lead.cidade}"` : (s.lead?.conhece_loja !== null && s.lead?.conhece_loja !== undefined) ? 'conhece_loja respondido' : 'cidade/conhece_loja ausentes' },
    { key: 'modo_atendimento', label: 'Modo de atendimento confirmado (remoto/presencial)', weight: 5, passed: !!s.atendimento?.modo_atendimento, reason: s.atendimento?.modo_atendimento ? `modo="${s.atendimento.modo_atendimento}"` : 'atendimento.modo_atendimento pendente' },
    { key: 'objecao_visita_nao_resolvida', label: 'Penalidade: recusou visita mas modo remoto nao definido', weight: -15, passed: s.atendimento?.pode_visitar_loja === false && !s.atendimento?.modo_atendimento, reason: (s.atendimento?.pode_visitar_loja === false && !s.atendimento?.modo_atendimento) ? 'recusou visita E sem modo remoto = atendimento travado' : 'objecao visita nao aplicavel ou ja tratada' },
  ];

  let rawPositive = 0;
  let rawPenalties = 0;
  breakdown.forEach((c) => {
    if (c.passed) {
      if (c.weight > 0) rawPositive += c.weight;
      else rawPenalties += c.weight;
    }
  });
  const total = rawPositive + rawPenalties;
  const score = Math.max(0, Math.min(100, total));
  return { score, tier: getLeadTier(score), breakdown, rawPositive, rawPenalties };
}

function formatLeadScoreBlock(result: LeadScoreResult): string {
  const lines: string[] = [];
  lines.push('## LEAD SCORE');
  lines.push(`- **Score**: ${result.score}/100 (tier: ${result.tier})`);
  const passed = result.breakdown.filter((c) => c.passed && c.weight > 0);
  const penalties = result.breakdown.filter((c) => c.passed && c.weight < 0);
  const missing = result.breakdown.filter((c) => !c.passed && c.weight > 0);
  if (passed.length > 0) {
    lines.push('- Pontos coletados:');
    passed.forEach((c) => lines.push(`  - ✅ ${c.label} (+${c.weight}): ${c.reason}`));
  }
  if (penalties.length > 0) {
    lines.push('- Penalidades aplicadas:');
    penalties.forEach((c) => lines.push(`  - ⚠️ ${c.label} (${c.weight}): ${c.reason}`));
  }
  if (missing.length > 0) {
    lines.push('- Faltam coletar (pesos):');
    missing.forEach((c) => lines.push(`  - ⏳ ${c.label} (+${c.weight}): ${c.reason}`));
  }
  return lines.join('\n');
}

// Wrapper: V1 (legacy) ou V2 se flag on. Garante compat com qualificacao_score numeric.
function getQualificationScore(state: any): number {
  if (isPedroFeatureEnabled('LEAD_SCORING')) {
    return calcLeadScoreV2(state).score;
  }
  return calcQualificationScore(state);
}

function buildBriefingForSeller(state: any, leadName: string, leadPhone: string, agentName: string): string {
  const lines: string[] = [];
  lines.push(`🆕 *LEAD QUALIFICADO — ${state?.lead?.nome_completo || state?.lead?.nome || leadName || 'Lead'}*`);
  lines.push(`📱 Telefone: ${state?.lead?.telefone || leadPhone}`);
  if (state?.lead?.cidade) lines.push(`🏙️ Cidade: ${state.lead.cidade}`);
  lines.push('');
  if (state?.interesse?.modelo_desejado) {
    const conf = [state.interesse.configuracao, state.interesse.combustivel, state.interesse.cambio].filter(Boolean).join(', ');
    lines.push(`🚗 *Interesse:* ${state.interesse.modelo_desejado}${conf ? ' (' + conf + ')' : ''}`);
  }
  if (state?.veiculo_apresentado?.ja_apresentado) {
    const vp = state.veiculo_apresentado;
    lines.push(`📋 *Veículo apresentado:* ${vp.modelo || ''} ${vp.ano || ''}${vp.preco ? ' — R$ ' + vp.preco : ''}`);
  }
  if (state?.negociacao?.forma_pagamento) lines.push(`💰 *Forma de pagamento:* ${state.negociacao.forma_pagamento}`);
  if (state?.negociacao?.valor_entrada) lines.push(`💵 *Entrada:* ${state.negociacao.valor_entrada}`);
  if (state?.negociacao?.tem_troca && state?.negociacao?.carro_troca) {
    const ct = state.negociacao.carro_troca;
    const trocaParts = [ct.modelo, ct.ano, ct.configuracao, ct.cambio].filter(Boolean).join(' ');
    lines.push(`🔄 *Troca:* ${trocaParts || 'sim'}${ct.status ? ' (' + ct.status + ')' : ''}`);
  }
  if (state?.atendimento?.pode_visitar_loja === false) {
    lines.push(`📍 *Visita:* NÃO pode visitar — atendimento REMOTO`);
  }
  if (state?.atendimento?.objecoes && state.atendimento.objecoes.length > 0) {
    lines.push(`⚠️ *Objeções:* ${state.atendimento.objecoes.join(', ')}`);
  }
  if (state?.lead?.acompanhante_decisao) lines.push(`👥 *Decisão envolve:* ${state.lead.acompanhante_decisao}`);
  lines.push('');
  lines.push(`👉 *Atender:* https://wa.me/${(state?.lead?.telefone || leadPhone || '').replace(/\D/g, '')}`);
  lines.push('');
  lines.push(`_Briefing gerado pelo Pedro SDR (${agentName})_`);
  return lines.join('\n');
}

// ─── BNDV Synonym classes (Lote 2 Fase 2) ──────────────────────────────────
// Resolve ERR_01/04 do benchmark Roberta: cliente diz "cabine dupla flex manual"
// e BNDV grava "Strada Freedom CD MT Flex". Sem sinônimos, .includes() falha.
//
// Classes BIDIRECIONAIS de equivalência (não pares): qualquer termo da classe
// bate com qualquer outro. Tokens curtos (≤3 chars como "cd", "mt", "at") usam
// word boundary regex pra evitar falso positivo (ex: "cd" matchar "Picanto SE Acdi").
const BNDV_SYNONYM_CLASSES: string[][] = [
  ['cabine dupla', 'cab. dupla', 'cab dupla', 'cd', 'doble cab', 'double cab', 'crew cab'],
  ['cabine simples', 'cab. simples', 'cs', 'single cab', 'reg cab'],
  ['cabine estendida', 'ce', 'ed', 'extended cab'],
  ['manual', 'mt', 'mec', 'mecanico', 'mecânico'],
  ['automatico', 'automatica', 'at', 'aut', 'automatic'],
  ['cvt', 'automatica cvt', 'continuamente variavel'],
  ['flex', 'flexfuel', 'bicombustivel', 'bi-combustivel'],
  ['gasolina', 'gas'],
  ['diesel', 'dsl'],
];

function bndvNormalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Testa se token aparece em haystack. Pra tokens curtos (≤3 chars como "cd",
// "mt", "at"), exige word boundary pra evitar falso positivo (ex: "cd" não pode
// dar match em "Picanto SE Acdi"). Pra tokens >3 chars, .includes() basta.
function bndvTokenInHaystack(token: string, haystack: string): boolean {
  if (token.replace(/[^a-z0-9]/g, '').length <= 3) {
    const escaped = token.replace(/[.()\\\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return re.test(haystack);
  }
  return haystack.includes(token);
}

// Match com sinônimos. Retorna { matched, exact }:
//   - exact=true: needle aparece literal em haystack (match forte, score 2)
//   - exact=false: needle e haystack pertencem à mesma classe (match fraco, score 1)
function semanticMatch(needle: string, haystack: string): { matched: boolean; exact: boolean } {
  const n = bndvNormalize(needle);
  const h = bndvNormalize(haystack);
  if (!n) return { matched: true, exact: true }; // sem filtro = OK
  if (!h) return { matched: false, exact: false };

  // 1. Match literal (com word boundary se needle for curto)
  if (bndvTokenInHaystack(n, h)) return { matched: true, exact: true };

  // 2. Encontra a classe do needle
  const needleClass = BNDV_SYNONYM_CLASSES.find(cls => cls.some(t => bndvNormalize(t) === n));
  if (!needleClass) return { matched: false, exact: false };

  // 3. Tenta cada termo da classe (também com word boundary se curto)
  for (const term of needleClass) {
    const t = bndvNormalize(term);
    if (t === n) continue; // já tentamos
    if (bndvTokenInHaystack(t, h)) return { matched: true, exact: false };
  }
  return { matched: false, exact: false };
}

// ─── BNDV Stock Search ──────────────────────────────────────────────────────
async function consultarEstoqueBndv(supabase: any, userId: string, filters: any) {
  try {
    // 1. Lookup BNDV token from platform_integrations
    const { data: integration } = await supabase
      .from('platform_integrations')
      .select('api_key_encrypted')
      .eq('user_id', userId)
      .eq('platform', 'bndv')
      .maybeSingle();

    if (!integration?.api_key_encrypted) {
      console.log('[BNDV] Nenhuma integração BNDV encontrada para user_id:', userId);
      return { success: false, total: 0, items: [], error: 'Integração BNDV não configurada.' };
    }

    let apiToken = '';
    try {
      const parsed = JSON.parse(integration.api_key_encrypted);
      apiToken = parsed.api_token || '';
    } catch {
      apiToken = integration.api_key_encrypted;
    }

    if (!apiToken) {
      return { success: false, total: 0, items: [], error: 'Token BNDV inválido.' };
    }

    // 2. GraphQL query to BNDV
    const graphqlQuery = `query BndvVehicles {
  vehiclesBy {
    modelName
    markName
    year
    km
    saleValue
    color
    fuelName
    transmissionName
    versionName
    pictureJs
  }
}`;

    console.log('[BNDV] Consultando estoque...');
    const gqlRes = await fetch('https://api-estoque.azurewebsites.net/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ query: graphqlQuery }),
    });

    if (!gqlRes.ok) {
      const errText = await gqlRes.text();
      console.error('[BNDV] Erro GraphQL:', gqlRes.status, errText);
      return { success: false, total: 0, items: [], error: `Erro BNDV: ${gqlRes.status}` };
    }

    const gqlData = await gqlRes.json();
    let vehicles = gqlData?.data?.vehiclesBy || [];
    console.log(`[BNDV] Total veículos retornados: ${vehicles.length}`);

    // 3. Filter/rank results
    // Lote 2 Fase 2: matching semântico com mapa de sinônimos (Roberta benchmark ERR_01/04).
    // Feature flag pra rollback rápido sem redeploy: PEDRO_BNDV_SYNONYMS_ENABLED.
    const SYNONYMS_ENABLED = Deno.env.get('PEDRO_BNDV_SYNONYMS_ENABLED') !== 'false';
    const normalize = bndvNormalize; // reusa helper compartilhado

    // Score por veículo: cada filtro string que bate exato vale 2 pontos, sinonimico 1.
    // Filtro que falha → veículo descartado. Itens ranqueados por score decrescente
    // (preferência por matches exatos). Filtros numéricos são all-or-nothing.
    const STRING_FILTERS: Array<[string, string]> = [
      ['marca', 'markName'],
      ['modelo', 'modelName'],
      ['versao', 'versionName'],
      ['combustivel', 'fuelName'],
      ['cambio', 'transmissionName'],
      ['cor', 'color'],
    ];

    vehicles = vehicles.map((v: any) => {
      let score = 0;
      let kept = true;

      // Filtros string (com ou sem sinônimos conforme flag)
      for (const [filterKey, fieldKey] of STRING_FILTERS) {
        const needle = filters[filterKey];
        if (!needle) continue;
        const haystack = v[fieldKey] || '';
        if (SYNONYMS_ENABLED) {
          const result = semanticMatch(needle, haystack);
          if (!result.matched) { kept = false; break; }
          score += result.exact ? 2 : 1;
          if (!result.exact) {
            console.log(`[BNDV] Match sinonimico: needle='${needle}' campo='${fieldKey}' haystack='${haystack.slice(0, 50)}'`);
          }
        } else {
          // Comportamento legacy (literal apenas) — fallback se flag desligada
          if (!normalize(haystack).includes(normalize(needle))) { kept = false; break; }
          score += 2;
        }
      }

      // Filtros numéricos (all-or-nothing, não somam score)
      if (kept && filters.ano_min && (v.year || 0) < filters.ano_min) kept = false;
      if (kept && filters.ano_max && (v.year || 9999) > filters.ano_max) kept = false;
      if (kept && filters.preco_max && (v.saleValue || 0) > filters.preco_max) kept = false;
      if (kept && filters.km_max && (v.km || 0) > filters.km_max) kept = false;

      return { ...v, _filterScore: kept ? score : -1 };
    }).filter((v: any) => v._filterScore >= 0)
      .sort((a: any, b: any) => b._filterScore - a._filterScore);

    // Free text query ranking — combina com _filterScore acima (não sobrescreve)
    if (filters.query) {
      const queryTokens = normalize(filters.query).split(/\s+/).filter(Boolean);
      vehicles = vehicles.map((v: any) => {
        const text = normalize(`${v.markName} ${v.modelName} ${v.versionName} ${v.color} ${v.fuelName} ${v.transmissionName} ${v.year}`);
        let queryScore = 0;
        for (const token of queryTokens) {
          if (text.includes(token)) queryScore++;
        }
        return { ...v, _score: (v._filterScore || 0) + queryScore };
      }).filter((v: any) => (v._score || 0) > 0)
        .sort((a: any, b: any) => b._score - a._score);
    }

    console.log(`[BNDV] synonyms_enabled=${SYNONYMS_ENABLED} | filters_aplicados=${STRING_FILTERS.filter(([k]) => filters[k]).map(([k]) => k).join(',')} | resultados=${vehicles.length}`);

    // 4. Build result items with images
    const items = vehicles.slice(0, 20).map((v: any) => {
      let principalImage = '';
      const images: string[] = [];

      if (v.pictureJs) {
        try {
          const pics = typeof v.pictureJs === 'string' ? JSON.parse(v.pictureJs) : v.pictureJs;
          if (Array.isArray(pics)) {
            for (const pic of pics) {
              if (pic.Link) {
                images.push(pic.Link);
                if (pic.Principal === true || pic.Principal === 'true') {
                  principalImage = pic.Link;
                }
              }
            }
            if (!principalImage && images.length > 0) {
              principalImage = images[0];
            }
          }
        } catch {
          // pictureJs parse failed
        }
      }

      const preco = v.saleValue || 0;
      const label = `${v.markName || ''} ${v.modelName || ''} ${v.versionName || ''} ${v.year || ''} - R$ ${preco.toLocaleString('pt-BR')}`.trim();

      return {
        marca: v.markName || '',
        modelo: v.modelName || '',
        versao: v.versionName || '',
        ano: v.year || 0,
        km: v.km || 0,
        preco,
        cor: v.color || '',
        combustivel: v.fuelName || '',
        cambio: v.transmissionName || '',
        label,
        principal_image: principalImage,
        images,
      };
    });

    console.log(`[BNDV] Resultados filtrados: ${items.length}`);
    return { success: true, total: items.length, items };
  } catch (err: any) {
    console.error('[BNDV] Erro na consulta:', err);
    return { success: false, total: 0, items: [], error: err.message };
  }
}

// ─── Pedro Feature Flags (INLINED from _shared/config/features.ts) ─────────
// Lê env var PEDRO_FF_<FLAG> e aceita true/1/yes/on/enabled (case-insensitive).
// Default fail-safe: false. NUNCA quebra (excecao -> false).
// Fonte canônica + testes: supabase/functions/_shared/config/features.ts
const PEDRO_FF_TRUE_VALUES = new Set(['true', '1', 'yes', 'on', 'enabled']);
function isPedroFeatureEnabled(flag: string): boolean {
  try {
    const raw = Deno.env.get(`PEDRO_FF_${flag}`);
    if (!raw) return false;
    return PEDRO_FF_TRUE_VALUES.has(String(raw).trim().toLowerCase());
  } catch {
    return false;
  }
}

// ─── Persona + Few-Shots (INLINED from _shared/prompt/personaFewShots.ts) ──
// IT-1.3: bloco apendado ao FINAL do system prompt (recency bias do GPT-4o).
// Cobre 5 cenarios: saudacao, qualificacao, objecao, fechamento, despedida.
// Fonte canônica + testes: supabase/functions/_shared/prompt/personaFewShots.ts
const PEDRO_PERSONA_BLOCK = `
Você é Pedro, atendente de WhatsApp de uma revenda de carros. Suas características:

- **Tom**: humano, próximo, brasileiro coloquial — sem ser informal demais. Usa emoji com moderação (1 por turno no máximo, e só quando combina).
- **Tamanho da resposta**: espelha o tamanho do cliente. Cliente curto = você curto. Cliente longo (pediu detalhe) = você pode estender.
- **Não invente dados**: preço, estoque, ano, KM, cor — SÓ se vieram da ferramenta consultar_estoque_bndv ou do contexto do agente.
- **Foco**: vender carro. Não opina sobre concorrentes, política, religião, vida pessoal. Desvia educadamente.
- **Honestidade**: se não tem o veículo pedido, OFEREÇA alternativas similares. Nunca diga só "não temos" e fecha a porta.
- **Handoff**: quando o cliente já tem decisão (modelo + forma de pagamento + nome), use a tool transferir_para_vendedor — não tente fechar você mesmo.
`.trim();

const PEDRO_FEW_SHOTS_INLINE: Array<{ label: string; customer: string; agent: string }> = [
  { label: '1. Saudação simples', customer: 'Oi', agent: 'Oi! Sou o Pedro 😊 Tô aqui pra te ajudar a achar seu próximo carro. Tá olhando algum modelo?' },
  { label: '2. Qualificação não-invasiva', customer: 'Tem Onix 2022?', agent: 'Tenho sim. Você tá pensando em à vista, financiar ou troca?' },
  { label: '3. Objeção "tô só olhando"', customer: 'Tô só olhando ainda', agent: 'Tranquilo! Quando quiser ver algum modelo ou bater um papo sobre opção, é só chamar 👍' },
  { label: '4. Fechamento → transfere', customer: 'Decidi, quero o Tracker 2023 financiado', agent: 'Excelente! Vou te conectar com nosso vendedor pra preparar a proposta e a entrega. Me passa seu nome e telefone?' },
  { label: '5. Despedida educada', customer: 'Cara, deixa pra outra hora', agent: 'Beleza! Quando quiser, é só chamar. Boa semana 👋' },
];

function buildPersonaFewShotsBlock(): string {
  const fewShotsText = PEDRO_FEW_SHOTS_INLINE.map(
    (fs) => `### ${fs.label}\nCliente: "${fs.customer}"\nVocê: "${fs.agent}"`
  ).join('\n\n');
  return `## PERSONA E TOM (REFERÊNCIA)\n${PEDRO_PERSONA_BLOCK}\n\n## EXEMPLOS DE RESPOSTA (FEW-SHOTS)\n${fewShotsText}\n\n## LEMBRETE FINAL\nEspelhe o tamanho do cliente. Não invente dados. Se não tem o veículo pedido, ofereça similar. Para fechar, use a tool transferir_para_vendedor.`;
}

// ─── Typing Simulator (INLINED from _shared/humanization/typingSimulator.ts)
// IT-1.2: delay realista + best-effort presence "digitando" antes de enviar.
// Fonte canônica + testes: supabase/functions/_shared/humanization/typingSimulator.ts
function calculateTypingDelayMs(
  text: string,
  opts?: { minMs?: number; maxMs?: number; baseCps?: number; jitterCps?: number; randomFn?: () => number }
): number {
  const minMs = opts?.minMs ?? 800;
  const maxMs = opts?.maxMs ?? 4000;
  const baseCps = opts?.baseCps ?? 18;
  const jitterCps = opts?.jitterCps ?? 10;
  const randomFn = opts?.randomFn ?? Math.random;
  const len = (text ?? '').length;
  if (len === 0) return minMs;
  const cps = baseCps + randomFn() * jitterCps;
  const raw = (len / cps) * 1000;
  return Math.max(minMs, Math.min(raw, maxMs));
}

async function sendTypingPresence(
  baseUrl: string,
  instKey: string,
  phoneNumber: string,
  presence: 'composing' | 'paused' | 'available' = 'composing'
): Promise<boolean> {
  const headers = { 'Content-Type': 'application/json', token: instKey };
  const body = JSON.stringify({ number: phoneNumber, presence });
  const endpoints = [`${baseUrl}/message/presence`, `${baseUrl}/chat/presence`];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.ok) return true;
    } catch {
      // ignora
    }
  }
  return false;
}

// ─── Message Split (INLINED from _shared/humanization/messageSplit.ts) ─────
// IT-1.1: divide resposta longa em ate N mensagens curtas pra parecer humano.
// Fonte canônica + testes: supabase/functions/_shared/humanization/messageSplit.ts
function splitMessageForHumanization(
  text: string,
  opts?: { maxParts?: number; minLength?: number }
): string[] {
  const maxParts = opts?.maxParts ?? 3;
  const minLength = opts?.minLength ?? 200;

  const trimmed = (text ?? '').trim();
  if (!trimmed) return [''];
  if (trimmed.length <= minLength) return [trimmed];

  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) return [trimmed];

  const targetParts = Math.min(maxParts, sentences.length);
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const targetCharsPerPart = totalChars / targetParts;

  const parts: string[] = [];
  let currentBuf: string[] = [];
  let currentLen = 0;
  let partsFilled = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const remaining = sentences.length - i;
    const slotsLeft = targetParts - partsFilled;

    currentBuf.push(sentence);
    currentLen += sentence.length + 1;

    const isLastSentence = i === sentences.length - 1;
    const isLastPart = partsFilled === targetParts - 1;
    const reachedTarget = currentLen >= targetCharsPerPart * 0.7;
    const mustFlushToReserveSlot = remaining <= slotsLeft - 1;

    if (
      isLastSentence ||
      (!isLastPart && (reachedTarget || mustFlushToReserveSlot))
    ) {
      parts.push(currentBuf.join(' ').trim());
      currentBuf = [];
      currentLen = 0;
      partsFilled++;
    }
  }

  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned : [trimmed];
}

// ─── WhatsApp Image Sending ─────────────────────────────────────────────────
async function sendVehicleImage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, imageUrl: string, caption: string) {
  // UazAPI V6: POST /send/media com campo "file" (não "url" nem "media")
  // Testado e confirmado: {number, file, type, caption} funciona
  try {
    console.log(`[BNDV-IMG] Enviando imagem via /send/media (file)...`);
    const res = await fetch(`${baseUrl}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'token': instKey },
      body: JSON.stringify({ number: phoneNumber, file: imageUrl, type: 'image', caption }),
    });
    if (res.ok) {
      console.log(`[BNDV-IMG] ✅ Imagem enviada com sucesso`);
      return true;
    }
    const errText = await res.text();
    console.error(`[BNDV-IMG] ❌ Falhou: ${res.status} - ${errText}`);
  } catch (err) {
    console.error(`[BNDV-IMG] ❌ Erro no envio:`, err);
  }
  return false;
}

// ─── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createSupabaseClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const payload = await req.json()
    console.log("[Webhook] Payload COMPLETO:", JSON.stringify(payload))

    const isUazapi = !!(payload.BaseUrl || payload.EventType || payload.instanceId)
    const isEvolution = !!(payload.event || payload.data)

    // --- FORMATO UAZAPI ---
    if (isUazapi) {
      const eventType = String(payload.EventType || payload.eventType || '').toLowerCase()

      if (eventType === 'connection' || eventType === 'status' || eventType.includes('connect')) {
        const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
        if (instanceName) {
          const state = String(payload.state || payload.status || '').toLowerCase()
          if (state === 'open' || state === 'connected') {
            await supabase.from('wa_instances')
              .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
              .eq('instance_name', instanceName)
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      if (eventType !== 'messages' && eventType !== 'message' && !eventType.includes('message')) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const instanceName = payload.instance || payload.instanceName || payload.InstanceId || payload.instanceId || ''
      const chat = payload.chat || {}

      let msgObj = null
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        msgObj = payload.messages[0]
      } else if (payload.message) {
        msgObj = payload.message
      }

      if (!msgObj) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      if (msgObj.fromMe === true) return new Response('Ignored fromMe', { headers: corsHeaders })

      const remoteJid = msgObj.chatId || msgObj.chatid || msgObj.from || chat.id || chat.chatId || '';
      if (!remoteJid) { console.log('[Webhook] No remoteJid'); return new Response('No remoteJid', { headers: corsHeaders }); }
      if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return new Response('Ignored group/broadcast', { headers: corsHeaders });

      // UazAPI V6: texto está em content (string para texto, objeto para mídia), text, ou caption
      const rawContent = msgObj.content;
      const textContent = (typeof rawContent === 'string') ? rawContent : '';
      const userText = (msgObj.body || msgObj.text || textContent || msgObj.caption || '').trim();
      const pushName = msgObj.senderName || chat.name || msgObj.notifyName || msgObj.pushName || 'Lead';

      console.log(`[Webhook] Mensagem recebida [UAZAPI]. Instance: ${instanceName}, From: ${remoteJid}, Text: ${userText}`);

      // ── DEDUP: se wa-inbox-webhook já processou esta mensagem, pular ──
      const messageIdForDedup = msgObj.messageid || msgObj.id?.id || msgObj.key?.id || '';
      if (messageIdForDedup) {
        const { data: alreadyInInbox } = await supabase.from('wa_inbox')
          .select('id')
          .eq('remote_message_id', messageIdForDedup)
          .maybeSingle();
        if (alreadyInInbox) {
          console.log(`[Webhook] ⏭️ Mensagem ${messageIdForDedup} já processada pelo wa-inbox-webhook. Pulando.`);
          return new Response(JSON.stringify({ ok: true, skipped: 'dedup' }), { headers: corsHeaders });
        }
      }

      return await processMessage(supabase, instanceName, remoteJid, userText, pushName, msgObj);
    }

    // --- FORMATO EVOLUTION API ---
    const eventRaw = payload.event || ''
    const event = String(eventRaw).toLowerCase()

    if (event.includes('connection.update') || event.includes('connection_update')) {
      const data = payload.data || payload
      const instance = payload.instance || data.instance || ''
      const state = String(data.state || data.status || '').toLowerCase()
      if ((state === 'open' || state === 'connected') && instance) {
        await supabase.from('wa_instances')
          .update({ is_active: true, status: 'connected', updated_at: new Date().toISOString() })
          .eq('instance_name', instance)
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    if (event !== 'messages.upsert' && event !== 'messages_upsert') {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    let data = payload.data || payload
    if (Array.isArray(data)) data = data[0]

    const instance = payload.instance || data.instance || ''
    const { key, message, pushName, messageType } = data

    if (!instance || !key || !message) return new Response('Incomplete payload', { headers: corsHeaders })
    if (key.fromMe) return new Response('Ignored fromMe', { headers: corsHeaders })
    if (key.remoteJid?.includes('@broadcast') || key.remoteJid?.includes('@g.us')) return new Response('Ignored group/broadcast', { headers: corsHeaders })

    let userText = message.conversation || message.extendedTextMessage?.text || message.text || data.text || ''

    // ── DEDUP: se wa-inbox-webhook já processou esta mensagem, pular ──
    const evMsgId = key.id || '';
    if (evMsgId) {
      const { data: alreadyInInbox } = await supabase.from('wa_inbox')
        .select('id')
        .eq('remote_message_id', evMsgId)
        .maybeSingle();
      if (alreadyInInbox) {
        console.log(`[Webhook] ⏭️ Mensagem ${evMsgId} já processada pelo wa-inbox-webhook. Pulando.`);
        return new Response(JSON.stringify({ ok: true, skipped: 'dedup' }), { headers: corsHeaders });
      }
    }

    return await processMessage(supabase, instance, key.remoteJid, userText.trim(), pushName || 'Lead', data)

  } catch (error: any) {
    console.error("[Webhook] Erro Critico:", error)
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 })
  }
})

async function processMessage(supabase: any, instanceName: string, remoteJid: string, userText: string, pushName: string, rawMsgObj: any) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

  const { data: waInstance } = await supabase.from('wa_instances').select('*').eq('instance_name', instanceName).maybeSingle()
  if (!waInstance) {
    console.log(`[Webhook] Instance not found: ${instanceName}`);
    return new Response('Instance not found', { headers: corsHeaders })
  }

  const { data: agent } = await supabase.from('wa_ai_agents')
    .select('*').eq('user_id', waInstance.user_id).eq('is_active', true).contains('instance_ids', [waInstance.id]).maybeSingle()

  if (!agent) {
    console.log(`[Webhook] No matching active agent for instanceId: ${waInstance.id}`);
    return new Response('No matching active agent', { headers: corsHeaders })
  }

  console.log(`[Webhook] Agente encontrado: ${agent.name} (ID: ${agent.id})`);

  // ── DETECÇÃO DE RESPOSTA DE VENDEDOR ────────────────────────────────
  // Se a mensagem vier do número de um vendedor, confirma o transfer pendente,
  // envia mensagem de confirmação e retorna sem deixar o Pedro responder.
  const senderDigits = remoteJid.replace(/\D/g, '').slice(-10); // últimos 10 dígitos

  // 1. Busca vendedor por agent_id
  // IMPORTANTE: usar .limit(1) antes de .maybeSingle() porque o vendedor pode
  // ter MÚLTIPLOS registros em ai_team_members (um por agente). Sem .limit(1),
  // o .maybeSingle() FALHA quando bate em >1 row e a confirmação do "Ok" fica
  // quebrada — o cron acaba repassando o lead pra outro vendedor.
  let { data: senderSeller } = await supabase
    .from('ai_team_members')
    .select('id, name')
    .eq('agent_id', agent.id)
    .eq('is_active', true)
    .ilike('whatsapp_number', `%${senderDigits}`)
    .order('auth_user_id', { ascending: false, nullsFirst: false }) // prefere o registro com login
    .limit(1)
    .maybeSingle();

  // 2. Fallback: busca vendedor por user_id (vendedores podem não ter agent_id)
  if (!senderSeller) {
    const { data: fallbackSeller } = await supabase
      .from('ai_team_members')
      .select('id, name')
      .eq('user_id', agent.user_id)
      .eq('is_active', true)
      .ilike('whatsapp_number', `%${senderDigits}`)
      .order('auth_user_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    senderSeller = fallbackSeller;
  }

  if (senderSeller) {
    console.log(`[Transfer] Mensagem do vendedor ${senderSeller.name} (id=${senderSeller.id}, jid=${remoteJid}) — verificando transfer pendente`);
    const now = new Date().toISOString();
    // Busca QUALQUER transfer recente do vendedor — não só pending. Cobre casos
    // onde confirmation_timeout_at já passou mas vendedor está respondendo.
    const { data: pendingTransfer } = await supabase
      .from('ai_lead_transfers')
      .select('id, lead_id, transfer_status, is_confirmed, created_at')
      .eq('to_member_id', senderSeller.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingTransfer) {
      console.log(`[Transfer] Último transfer do vendedor: id=${pendingTransfer.id} status=${pendingTransfer.transfer_status} confirmed=${pendingTransfer.is_confirmed} created=${pendingTransfer.created_at}`);
    } else {
      console.log(`[Transfer] Nenhum transfer encontrado para vendedor ${senderSeller.name}`);
    }
    // Só confirma se ainda está pending E não confirmado
    const shouldConfirm = pendingTransfer
      && pendingTransfer.transfer_status === 'pending'
      && !pendingTransfer.is_confirmed;

    if (shouldConfirm && pendingTransfer) {
      // Confirma o transfer
      const { error: updTransferErr } = await supabase.from('ai_lead_transfers').update({
        transfer_status: 'confirmed',
        is_confirmed: true,
        confirmed_at: now,
      }).eq('id', pendingTransfer.id);
      if (updTransferErr) {
        console.error(`[Transfer] FALHA ao marcar transfer ${pendingTransfer.id} como confirmed:`, updTransferErr);
      } else {
        console.log(`[Transfer] ✅ transfer ${pendingTransfer.id} marcado como confirmed`);
      }

      await supabase.from('ai_team_members').update({
        last_lead_received_at: now,
      }).eq('id', senderSeller.id);

      // Atualiza status do lead para 'em_atendimento' — CRÍTICO pra cron não repassar
      if (pendingTransfer.lead_id) {
        const { error: updLeadErr } = await supabase.from('ai_crm_leads').update({
          status: 'em_atendimento',
          last_interaction_at: now,
        }).eq('id', pendingTransfer.lead_id);
        if (updLeadErr) {
          console.error(`[Transfer] FALHA ao atualizar lead.status para em_atendimento (lead ${pendingTransfer.lead_id}):`, updLeadErr);
        } else {
          console.log(`[Transfer] ✅ lead ${pendingTransfer.lead_id} status → em_atendimento`);
        }
      }

      // Envia mensagem de confirmação para o vendedor via WhatsApp
      try {
        const sellerBaseUrl = (waInstance.api_url || '').replace(/\/$/, '');
        const sellerInstKey = waInstance.api_key_encrypted || '';
        let sellerDest = remoteJid.replace(/\D/g, '');
        if (sellerDest.length === 10 || sellerDest.length === 11) sellerDest = `55${sellerDest}`;

        const confirmMsg = `✅ *Atendimento Confirmado!*\n\nO lead foi atribuído a você no CRM. Pode seguir com a venda! 🚀`;

        await fetch(`${sellerBaseUrl}/send/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': sellerInstKey },
          body: JSON.stringify({ number: sellerDest, text: confirmMsg }),
        });
        console.log(`[Transfer] ✅ Confirmação enviada para vendedor ${senderSeller.name}`);
      } catch (confirmErr) {
        console.warn(`[Transfer] Erro ao enviar confirmação para vendedor:`, confirmErr);
      }

      console.log(`[Transfer] ✅ Vendedor ${senderSeller.name} confirmou o lead`);
    }
    // Vendedor não recebe resposta do Pedro (IA)
    return new Response(JSON.stringify({ ok: true, seller_ack: true }), { headers: corsHeaders });
  }
  // ────────────────────────────────────────────────────────────────────

  // Registrar Lead no CRM
  // Prompt 1.1: lead criado via WhatsApp recebe origem='outros' por default.
  // O upsert tem ignoreDuplicates=true, então NÃO sobrescreve origem em leads
  // existentes (preserva valor manual do master/vendedor).
  const nowStr = new Date().toISOString();
  await supabase.from('ai_crm_leads').upsert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: waInstance.id,
    remote_jid: remoteJid,
    lead_name: pushName,
    message_count: 1,
    origem: 'outros',
    last_interaction_at: nowStr
  }, { onConflict: 'agent_id, remote_jid', ignoreDuplicates: true });

  // ── CRITICAL: Atualiza timestamps para as regras de 5min/10min (cron-lead-followup) ──
  // last_user_reply_at = quando o CLIENTE enviou a última mensagem
  // followup_5min_sent = reset para false para o cron enviar novo follow-up se necessário
  await supabase.from('ai_crm_leads').update({
    instance_id: waInstance.id,
    last_user_reply_at: nowStr,
    followup_5min_sent: false,
  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

  // ── DETECÇÃO DE LEAD QUE RETORNOU (já transferido/qualificado) ─────────────
  // Se o lead já estava com vendedor, notifica o vendedor e reseta o status
  // para que as regras de 5min/10min voltem a funcionar nesta nova conversa.
  {
    const { data: existingLead } = await supabase
      .from('ai_crm_leads')
      .select('id, status, assigned_to_id, lead_name')
      .eq('agent_id', agent.id)
      .eq('remote_jid', remoteJid)
      .maybeSingle();

    if (existingLead &&
        ['transferido', 'qualificado', 'em_atendimento'].includes(existingLead.status) &&
        existingLead.assigned_to_id) {
      console.log(`[Webhook] 🔄 Lead RETORNOU! Status era '${existingLead.status}', assigned_to=${existingLead.assigned_to_id}. Resetando...`);

      // 1. Buscar vendedor que estava atendendo + última notificação de retorno
      const { data: existingLeadFull } = await supabase
        .from('ai_crm_leads')
        .select('last_return_notify_at')
        .eq('id', existingLead.id)
        .maybeSingle();

      const { data: assignedSeller } = await supabase
        .from('ai_team_members')
        .select('id, name, whatsapp_number')
        .eq('id', existingLead.assigned_to_id)
        .maybeSingle();

      // 2. Manter vendedor atribuído — só reativar follow-ups
      // NÃO resetar assigned_to_id (senão cron faz round-robin para vendedor errado)
      // NÃO mudar para 'novo' (senão cron redistribui)
      await supabase.from('ai_crm_leads').update({
        status: 'em_atendimento',
        followup_5min_sent: false,
      }).eq('id', existingLead.id);

      // 3. Throttle: notifica vendedor APENAS se passou >= 24h da última
      // notificação de retorno desse lead (ou se nunca foi notificado).
      // Antes: spam — toda mensagem do cliente disparava notificação.
      const lastNotifyMs = existingLeadFull?.last_return_notify_at
        ? new Date(existingLeadFull.last_return_notify_at).getTime()
        : 0;
      const hoursSinceLastNotify = (Date.now() - lastNotifyMs) / 3_600_000;
      const shouldNotify = hoursSinceLastNotify >= 24;

      if (shouldNotify && assignedSeller?.whatsapp_number) {
        try {
          const retBaseUrl = (waInstance.api_url || '').replace(/\/$/, '');
          const retInstKey = waInstance.api_key_encrypted || '';
          let sellerNum = assignedSeller.whatsapp_number.replace(/\D/g, '');
          if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;
          const clientPhone = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');

          const returnNotification =
            `🔄 *LEAD RETORNOU!*\n\n` +
            `O cliente *${pushName || existingLead.lead_name || 'Desconhecido'}* voltou a conversar.\n` +
            `📱 *Contato:* +${clientPhone}\n\n` +
            `O lead continua atribuído a você. A IA está respondendo enquanto isso.\n` +
            `👉 https://wa.me/${clientPhone}`;

          await fetch(`${retBaseUrl}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': retInstKey },
            body: JSON.stringify({ number: sellerNum, text: returnNotification }),
          });

          // Marca timestamp pra throttle de 24h não notificar de novo
          await supabase
            .from('ai_crm_leads')
            .update({ last_return_notify_at: new Date().toISOString() })
            .eq('id', existingLead.id);

          console.log(`[Webhook] 🔄 Notificação de retorno enviada para ${assignedSeller.name} (próxima só após 24h)`);
        } catch (notifyErr) {
          console.error('[Webhook] Erro ao notificar vendedor sobre retorno:', notifyErr);
        }
      } else if (!shouldNotify) {
        console.log(`[Webhook] 🔇 Notificação de retorno SUPRIMIDA (throttle 24h) — última foi há ${hoursSinceLastNotify.toFixed(1)}h`);
      }
    }
  }

  const handoffMsg = "Excelente! Já informei o meu time de especialistas comerciais e eles vão dar continuidade no seu atendimento. Eles vão te chamar aqui mesmo neste número agora mesmo! Muito obrigado.";

  // Tools
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "atualizar_etapa_crm",
        description: "Atualiza o Kanban/CRM conforme a evolução da conversa. Chame esta função secretamente para categorizar o lead. Valores válidos de status: 'interessado' (quando tem interesse inicial), 'qualificado' (quando pediu para comprar ou quer falar com humano) e 'encerrado' (quando não quer comprar). OBS IMPORTANTE: Ao chamar esta função para status 'interessado' ou 'encerrado', VOCÊ DEVE TAMBÉM gerar uma mensagem normal para o cliente. Só encerre a conversa se for status 'qualificado'.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["interessado", "qualificado", "encerrado"], description: "A etapa atual do cliente." },
            resumo: { type: "string", description: "O que o cliente deseja e as informações que você coletou dele até o momento. Seja breve." }
          },
          required: ["status", "resumo"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "consultar_estoque_bndv",
        description: "Consulta o estoque real de veículos integrado ao BNDV. Use quando o cliente perguntar sobre carros disponíveis, preço, ano, versão, câmbio, combustível, cor ou faixa de valor. Nunca invente estoque sem usar esta ferramenta.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Busca livre do cliente." },
            marca: { type: "string", description: "Marca do veículo." },
            modelo: { type: "string", description: "Modelo do veículo." },
            versao: { type: "string", description: "Versão do veículo." },
            combustivel: { type: "string", description: "Combustível desejado." },
            cambio: { type: "string", description: "Tipo de câmbio." },
            cor: { type: "string", description: "Cor desejada." },
            ano_min: { type: "number", description: "Ano mínimo." },
            ano_max: { type: "number", description: "Ano máximo." },
            preco_max: { type: "number", description: "Preço máximo." },
            km_max: { type: "number", description: "Quilometragem máxima." },
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "transferir_para_vendedor",
        description: "Transfere o lead para um vendedor humano com briefing estruturado. SÓ chame quando o ESTADO DA CONVERSA mostrar coletados: nome ✅, telefone ✅, modelo de interesse ✅, forma de pagamento ✅. Após chamar, AGUARDE o resultado antes de responder ao cliente. Se a tool retornar success=false, NÃO diga que transferiu — diga que vai chamar o consultor manualmente. Se retornar success=true, diga ao cliente o nome do vendedor que vai atendê-lo.",
        parameters: {
          type: "object",
          properties: {
            motivo: {
              type: "string",
              description: "Por que transferir agora. Ex: 'lead totalmente qualificado, pronto pra fechar à vista', 'cliente pediu falar com humano', 'detalhes de troca precisam de avaliação'."
            },
            resumo_breve: {
              type: "string",
              description: "1-2 frases resumindo o que o cliente quer e o que ainda falta. Será usado no briefing pro vendedor."
            }
          },
          required: ["motivo"]
        }
      }
    }
  ];

  // Helper function to decode base64
  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, {type: contentType});
  }

  // UazAPI V6 envia messageType em PascalCase (ex: "AudioMessage", "ImageMessage", "Conversation")
  // Normalizar para lowercase para comparação consistente
  const rawMsgType = rawMsgObj?.messageType || rawMsgObj?.type || '';
  const msgType = rawMsgType.toLowerCase();
  // UazAPI também tem campo mediaType com valores como "ptt", "image", "video", "audio"
  const mediaType = (rawMsgObj?.mediaType || '').toLowerCase();
  const messageId = rawMsgObj?.messageid || rawMsgObj?.id?.id || rawMsgObj?.key?.id || '';

  console.log(`[Webhook] msgType: "${rawMsgType}" → "${msgType}", mediaType: "${mediaType}", messageId: "${messageId}"`);

  const baseUrl = (waInstance.api_url || Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/$/, '')
  const instKey = waInstance.api_key_encrypted || Deno.env.get('EVOLUTION_API_KEY') || ''
  const phoneNumber = remoteJid.replace(/@.*$/, '').replace(/\D/g, '')
  // Normaliza para o formato sem DDI "55" — crm_leads armazena sem prefixo (ex: "12996200820")
  const crmPhone = (phoneNumber.startsWith('55') && (phoneNumber.length === 13 || phoneNumber.length === 12))
    ? phoneNumber.slice(2)
    : phoneNumber
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) return new Response('Missing AI Key', { status: 500 })

  let finalUserText = userText;
  let userMessageContentForOpenAi: any = finalUserText;

  // Detectar mídia: UazAPI envia "AudioMessage"/"ImageMessage" em messageType, ou "ptt"/"image" em mediaType
  const isAudio = msgType.includes('audio') || msgType === 'ptt' || mediaType === 'ptt' || mediaType === 'audio';
  const isImage = msgType.includes('image') || mediaType === 'image';

  // Process Media se houver
  // UazAPI V6: content é um objeto com URL, mimetype, mediaKey, etc. para mídia
  const contentObj = (typeof rawMsgObj?.content === 'object' && rawMsgObj?.content) || {};
  let mediaMimetype = contentObj.mimetype || rawMsgObj?.mimetype || '';

  if (isAudio || isImage) {
    console.log(`[Webhook] 📎 Mídia detectada: isAudio=${isAudio}, isImage=${isImage}, mime=${mediaMimetype}`);
    let base64 = rawMsgObj?.base64 || rawMsgObj?.message?.base64 || '';

    // Se não veio base64, baixar via UazAPI V6: POST /message/download
    // Testado e confirmado: endpoint aceita {id: messageId, return_base64: true}
    // Resposta: {base64Data: "...", mimetype: "...", fileURL: "...", transcription: "..."}
    if (!base64 && messageId) {
      console.log(`[Webhook] Baixando mídia ID: ${messageId}, type: ${msgType}`);

      try {
        const dRes = await fetch(`${baseUrl}/message/download?instance=${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': instKey, 'token': instKey },
          body: JSON.stringify({ id: messageId, return_base64: true })
        });

        if (dRes.ok) {
          const dData = await dRes.json();
          // UazAPI V6 retorna base64Data (não base64)
          base64 = dData.base64Data || dData.base64 || dData.file || '';
          // Atualizar mimetype se veio na resposta
          if (dData.mimetype) {
            mediaMimetype = dData.mimetype;
          }
          console.log(`[Webhook] ✅ Mídia baixada! length: ${base64.length}, mime: ${dData.mimetype || 'N/A'}, cached: ${dData.cached || false}`);

          // UazAPI V6 pode incluir transcrição automática para áudio
          if (isAudio && dData.transcription && !finalUserText) {
            console.log(`[Webhook] UazAPI já transcreveu o áudio: "${dData.transcription}"`);
          }
        } else {
          const errText = await dRes.text();
          console.error(`[Webhook] ❌ Download falhou: ${dRes.status} - ${errText}`);
        }
      } catch (err) {
        console.error('[Webhook] ❌ Erro no download de mídia:', err);
      }

      if (!base64) {
        console.error(`[Webhook] FALHA: Não foi possível baixar mídia ${msgType} ID: ${messageId}`);
      }
    }

    if (base64) {
      if (isAudio) {
        try {
          const audioMime = mediaMimetype || 'audio/ogg';
          const blob = b64toBlob(base64, audioMime);
          const formData = new FormData();
          formData.append('file', blob, 'audio.ogg');
          formData.append('model', 'whisper-1');

          console.log(`[Webhook] 🎤 Enviando áudio para Whisper (${base64.length} chars base64, mime: ${audioMime})...`);
          const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
            body: formData
          });
          const wData = await wRes.json();
          if (wData.text) {
             finalUserText = wData.text;
             userMessageContentForOpenAi = finalUserText;
             console.log('[Webhook] ✅ Transcrição (Whisper):', finalUserText);
          } else {
             console.error('[Webhook] ❌ Whisper não retornou texto:', JSON.stringify(wData));
          }
        } catch(err) {
          console.error('[Webhook] Erro no Whisper:', err);
        }
      } else if (isImage) {
        // UazAPI V6: mimetype pode estar em content.mimetype ou rawMsgObj.mimetype
        const mimeType = mediaMimetype || rawMsgObj?.mimetype || 'image/jpeg';
        finalUserText = finalUserText || '[Imagem recebida]';
        userMessageContentForOpenAi = [
          { type: "text", text: finalUserText },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
        ];
        console.log(`[Webhook] 🖼️ Imagem preparada para visão (mime: ${mimeType}, base64 length: ${base64.length})`);
      }
    } else if (isImage) {
      // Fallback: se base64 falhou mas temos URL da mídia, enviar URL direto ao GPT-4o
      const mediaUrl = contentObj.URL || contentObj.url || rawMsgObj?.mediaUrl || rawMsgObj?.directUrl || '';
      if (mediaUrl) {
        console.log(`[Webhook] 🖼️ Fallback: usando URL da mídia direto: ${mediaUrl.substring(0, 80)}...`);
        finalUserText = finalUserText || '[Imagem recebida]';
        userMessageContentForOpenAi = [
          { type: "text", text: finalUserText },
          { type: "image_url", image_url: { url: mediaUrl } }
        ];
      } else {
        // Sem base64 e sem URL — informa ao usuário que não pode ver a imagem
        finalUserText = finalUserText || '[Imagem recebida - não foi possível visualizar]';
        userMessageContentForOpenAi = finalUserText;
        console.error(`[Webhook] ⚠️ Imagem sem base64 e sem URL — IA responderá sem ver a imagem`);
      }
    }
  }

  if (!finalUserText && typeof userMessageContentForOpenAi === 'string') {
    if (isAudio || isImage) {
      console.error(`[Webhook] ⚠️ Mídia ${msgType} recebida mas não foi possível processar (download/transcrição falhou). Mensagem ignorada.`);
    } else {
      console.log('[Webhook] Empty text message — ignorando');
    }
    return new Response('Empty text', { headers: corsHeaders });
  }

  console.log(`[Webhook] Salvando histórico e chamando OpenAI para: ${finalUserText}`);

  // Salvar histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id,
    agent_id: agent.id,
    instance_id: instanceName,
    remote_jid: remoteJid,
    role: 'user',
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Mídia/Imagem]',
    lead_name: pushName
  })

  // ========================================================================
  // PEDRO STATE — extrair entidades da mensagem do cliente e atualizar state
  // ========================================================================
  // Roda EM PARALELO com o resto (não bloqueia a query do histórico).
  // O resultado é usado no system prompt do GPT-4o.
  let conversationState: any = {};
  const stateUpdatePromise = (async () => {
    try {
      // 1. Buscar lead_id (necessário pra PK composta)
      const { data: leadForState } = await supabase
        .from('ai_crm_leads')
        .select('id')
        .eq('agent_id', agent.id)
        .eq('remote_jid', remoteJid)
        .maybeSingle();
      if (!leadForState?.id) {
        console.log('[PedroState] Lead ainda não existe — pulando extração neste turno');
        return;
      }
      const leadIdForState = leadForState.id;

      // 2. Buscar state atual
      const { data: stateRow } = await supabase
        .from('pedro_conversation_state')
        .select('state')
        .eq('lead_id', leadIdForState)
        .eq('agent_id', agent.id)
        .maybeSingle();
      const currentState = stateRow?.state || {};

      // 3. Buscar última mensagem do AGENTE (pra detectar eco)
      const { data: lastAgentMsgRow } = await supabase
        .from('wa_chat_history')
        .select('content')
        .eq('agent_id', agent.id)
        .eq('remote_jid', remoteJid)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const previousAgentMessage = lastAgentMsgRow?.content || '';

      // 4. Extrair entidades via Claude Haiku 4.5
      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
      if (!anthropicApiKey) {
        console.warn('[PedroState] ANTHROPIC_API_KEY não configurada — pulando extração');
        conversationState = currentState;
        return;
      }

      const userMsgPlain = typeof userMessageContentForOpenAi === 'string' ? finalUserText : '[Mídia recebida]';
      const { delta, eco, objecoes } = await extractEntitiesWithClaude({
        message: userMsgPlain,
        currentState,
        previousAgentMessage,
        apiKey: anthropicApiKey,
      });

      // 5. Se for eco do nome do agente, NÃO sobrescrever lead.nome
      const safeDelta = { ...delta };
      if (eco && safeDelta.lead) {
        delete safeDelta.lead.nome;
        delete safeDelta.lead.nome_completo;
      }

      // 6. Adicionar objeções acumulativas
      if (objecoes.length > 0) {
        safeDelta.atendimento = safeDelta.atendimento || {};
        safeDelta.atendimento.objecoes = objecoes;
        if (objecoes.includes('nao_pode_visitar')) {
          // incrementa recusas_visita (currentState pode ter o counter atual)
          const curRecusas = currentState?.atendimento?.recusas_visita || 0;
          safeDelta.atendimento.recusas_visita = curRecusas + 1;
          safeDelta.atendimento.modo_atendimento = 'remoto';
        }
      }

      // 7a. Camada 1 do Bug #2 (race): re-fetch state fresco do banco antes
      // do merge. Defesa contra webhook concorrente (turno N+1) sobrescrever
      // flag setada por turno anterior (N). Sem isso, consultor_apresentado=true
      // pode ser apagado e Pedro re-apresenta no próximo turno.
      const { data: freshStateRow } = await supabase
        .from('pedro_conversation_state')
        .select('state')
        .eq('lead_id', leadIdForState)
        .eq('agent_id', agent.id)
        .maybeSingle();
      const baseStateForMerge = (freshStateRow?.state && Object.keys(freshStateRow.state).length > 0)
        ? freshStateRow.state
        : currentState;

      // 7b. Merge + UPSERT
      const newState = deepMerge(baseStateForMerge, safeDelta);
      const score = getQualificationScore(newState); // IT-2.2: wrapper V1/V2
      conversationState = newState;

      await supabase.from('pedro_conversation_state').upsert({
        lead_id: leadIdForState,
        agent_id: agent.id,
        user_id: agent.user_id,
        state: newState,
        qualificacao_score: score,
        last_extracted_at: new Date().toISOString(),
      }, { onConflict: 'lead_id,agent_id' });

      console.log(`[PedroState] state atualizado | score=${score} | eco=${eco} | delta_keys=${Object.keys(delta).join(',')}`);
    } catch (extractErr) {
      console.warn('[PedroState] erro na extração (não bloqueia resposta):', extractErr);
    }
  })();
  // Aguarda extração completar antes de montar system prompt
  await stateUpdatePromise;

  // Salvar mensagem RECEBIDA no wa_inbox (para aparecer no Inbox do Marcos)
  const incomingMediaType = isAudio ? 'audio' : (isImage ? 'image' : 'text');
  // Para mídia, extrair URL se disponível no payload UazAPI (content.URL ou directUrl)
  const incomingMediaUrl = contentObj.URL || rawMsgObj?.mediaUrl || rawMsgObj?.directUrl || rawMsgObj?.media_url || rawMsgObj?.url || null;
  await supabase.from('wa_inbox').insert({
    user_id: waInstance.user_id,
    instance_id: waInstance.id,
    phone: phoneNumber,
    contact_name: pushName || null,
    direction: 'incoming',
    message_type: incomingMediaType,
    content: typeof userMessageContentForOpenAi === 'string' ? finalUserText : (incomingMediaType === 'image' ? '[Imagem recebida]' : '[Áudio recebido]'),
    media_url: incomingMediaUrl,
    is_read: false,
    remote_message_id: messageId || null,
  }).then(({ error }: any) => {
    if (error) console.error('[uazapi-webhook] wa_inbox incoming insert error:', error.message);
  });

  // Buscar histórico
  const { data: pausedLead } = await supabase
    .from('ai_crm_leads')
    .select('ai_paused')
    .eq('agent_id', agent.id)
    .eq('remote_jid', remoteJid)
    .maybeSingle();

  if (pausedLead?.ai_paused) {
    console.log(`[Webhook] IA pausada para ${remoteJid}. Mensagem registrada, resposta automatica ignorada.`);
    return new Response(JSON.stringify({ ok: true, ai_paused: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { data: history } = await supabase.from('wa_chat_history')
    .select('role, content').eq('instance_id', instanceName).eq('remote_jid', remoteJid).order('created_at', { ascending: false }).limit(10)

  const chatHistory = (history || []).reverse().map((m: any) => ({ role: m.role, content: m.content }))

  // RAG - Busca Base de Conhecimento
  let knowledgeContext = ''
  try {
    const { data: agentKbs } = await supabase.from('agent_knowledge_bases').select('kb_id').eq('agent_id', agent.id)
    const kbIds = (agentKbs || []).map((k: any) => k.kb_id)

    if (kbIds.length > 0) {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
      if (OPENAI_API_KEY) {
        const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: userText.slice(0, 8000) })
        })
        if (embedRes.ok) {
          const embedData = await embedRes.json()
          const { data: chunks } = await supabase.rpc('search_knowledge', {
            query_embedding: embedData.data[0].embedding, kb_ids: kbIds, match_threshold: 0.60, match_count: 5
          })
          if (chunks && chunks.length > 0) knowledgeContext = chunks.map((c: any) => c.content).join('\n\n---\n\n')
        }
      }
    }
  } catch (err: any) {}

  let systemPrompt = agent.system_prompt || 'Você é um assistente prestativo.'
  if (agent.company_name) systemPrompt += `\n\nEmpresa: ${agent.company_name}`
  if (knowledgeContext) systemPrompt += `\n\n## BASE DE CONHECIMENTO:\n${knowledgeContext}`

  // ── PEDRO STATE: bloco com dados já coletados + regras anti-repetição ──
  const stateBlock = formatStateForPrompt(conversationState);
  if (stateBlock) {
    systemPrompt += `\n\n${stateBlock}`;
  }

  // ── BNDV: Check if user has BNDV integration and append system prompt instruction ──
  let hasBndvIntegration = false;
  try {
    const { data: bndvInteg } = await supabase
      .from('platform_integrations')
      .select('id')
      .eq('user_id', agent.user_id)
      .eq('platform', 'bndv')
      .maybeSingle();
    if (bndvInteg) {
      hasBndvIntegration = true;
      systemPrompt += `\n\nFERRAMENTA DE ESTOQUE BNDV:\nVocê tem acesso à ferramenta "consultar_estoque_bndv". USE quando o cliente perguntar sobre carros, preço, estoque, opções disponíveis. Nunca invente estoque sem consultar. Após consultar, as fotos dos veículos serão enviadas automaticamente.`;
    }
  } catch (bndvCheckErr) {
    console.error('[Webhook] Erro ao verificar integração BNDV:', bndvCheckErr);
  }

  // ── IT-1.3: Persona consolidada + 5 few-shots ────────────────────────────
  // Apenda ao FINAL do system prompt pra recency bias do GPT-4o. Reforca
  // tom, escopo, regras de honestidade e handoff. Apenas quando flag ligada.
  // Flag OFF = system prompt identico ao atual.
  if (isPedroFeatureEnabled('PERSONA_FEW_SHOTS')) {
    systemPrompt += `\n\n${buildPersonaFewShotsBlock()}`;
    console.log('[Humanization] PERSONA_FEW_SHOTS on - bloco apendado no system prompt');
  }

  let aiModel = agent.model || 'gpt-4o';
  // Fallbacks para evitar crashes na OpenAI caso o frontend envie modelos do Google/Anthropic
  if (aiModel.startsWith('openai/')) {
    aiModel = aiModel.replace('openai/', '');
  } else if (aiModel.includes('google/') || aiModel.includes('anthropic/')) {
    // Fallback para gpt-4o (NÃO gpt-4o-mini) para manter capacidade de visão/imagem
    console.log(`[Webhook] Aviso: Modelo externo (${aiModel}) detectado no endpoint OpenAI nativo. Fazendo fallback para gpt-4o (com visão).`);
    aiModel = 'gpt-4o';
  }

  // Se temos uma imagem para analisar, garantir que o modelo suporta visão
  const hasImageContent = Array.isArray(userMessageContentForOpenAi) && userMessageContentForOpenAi.some((c: any) => c.type === 'image_url');
  if (hasImageContent && (aiModel === 'gpt-4o-mini' || aiModel === 'gpt-3.5-turbo')) {
    console.log(`[Webhook] Imagem detectada — upgrade de ${aiModel} para gpt-4o para suporte a visão`);
    aiModel = 'gpt-4o';
  }

  if (hasImageContent) {
    console.log(`[Webhook] 🖼️ Enviando imagem para análise com modelo: ${aiModel}`);
  }

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: aiModel,
      messages: [{ role: 'system', content: systemPrompt }, ...chatHistory, { role: 'user', content: userMessageContentForOpenAi }],
      temperature: agent.temperature || 0.7,
      tools: tools,
      tool_choice: "auto"
    })
  })

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    console.error(`[Webhook] OpenAI Erro: ${openaiRes.status} - ${errText}`);
    return new Response('OpenAI erro', { status: 500 });
  }
  const openaiData = await openaiRes.json()
  const aiMessage = openaiData.choices?.[0]?.message

  console.log(`[Webhook] Resposta da IA recebida. ToolCalls: ${aiMessage?.tool_calls?.length || 0}`);

  let aiResponse = aiMessage?.content || ''

  // ── Variable to hold BNDV results for image sending after text response ──
  let bndvResultForImages: any = null;

  // Verificar se o modelo decidiu chamar ferramentas
  if (aiMessage?.tool_calls && aiMessage.tool_calls.length > 0) {

    // ── BNDV Tool Call ──────────────────────────────────────────────────
    const bndvToolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'consultar_estoque_bndv');
    if (bndvToolCall) {
      try {
        const bndvArgs = JSON.parse(bndvToolCall.function.arguments);
        console.log(`[BNDV] Tool call com args:`, JSON.stringify(bndvArgs));

        const bndvResult = await consultarEstoqueBndv(supabase, agent.user_id, bndvArgs);
        console.log(`[BNDV] Resultado: success=${bndvResult.success}, total=${bndvResult.total}`);

        // Store for image sending later
        if (bndvResult.success && bndvResult.items.length > 0) {
          bndvResultForImages = bndvResult;
        }

        // Build tool messages for OpenAI follow-up
        const toolMessages: any[] = [
          { role: 'system', content: systemPrompt },
          ...chatHistory,
          { role: 'user', content: userMessageContentForOpenAi },
          aiMessage,
          {
            role: 'tool',
            tool_call_id: bndvToolCall.id,
            name: 'consultar_estoque_bndv',
            content: JSON.stringify(bndvResult),
          },
        ];

        // If there was also a CRM tool call, add its result too
        const crmToolCallInBndv = aiMessage.tool_calls.find((t: any) => t.function.name === 'atualizar_etapa_crm');
        if (crmToolCallInBndv) {
          toolMessages.push({
            role: 'tool',
            tool_call_id: crmToolCallInBndv.id,
            name: 'atualizar_etapa_crm',
            content: '{"success": true}',
          });
        }

        // Get follow-up text response from OpenAI
        const bndvFollowupRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
          body: JSON.stringify({
            model: aiModel,
            messages: toolMessages,
            temperature: agent.temperature || 0.7,
          }),
        });

        if (bndvFollowupRes.ok) {
          const bndvFollowupData = await bndvFollowupRes.json();
          const bndvTextResponse = bndvFollowupData.choices?.[0]?.message?.content || '';
          if (bndvTextResponse) {
            aiResponse = bndvTextResponse;
            console.log(`[BNDV] Resposta de texto gerada (${aiResponse.length} chars)`);
          }
        }
      } catch (bndvErr) {
        console.error('[BNDV] Erro ao processar tool call:', bndvErr);
      }
    }

    // ── TRANSFERIR PARA VENDEDOR (tool explícita com sync feedback) ─────
    // Resolve ERR_15 (anunciou transfer mas não executou) e ERR_16 (handoff sem briefing)
    const transferToolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'transferir_para_vendedor');
    if (transferToolCall) {
      let transferResult: any = { success: false, error: 'unknown' };
      try {
        const transferArgs = JSON.parse(transferToolCall.function.arguments || '{}');
        console.log(`[Transfer-Tool] motivo=${transferArgs.motivo} resumo=${transferArgs.resumo_breve?.slice(0, 100)}`);

        // 1. Validar checklist mínimo no state
        const st = conversationState || {};
        const missing: string[] = [];
        if (!st.lead?.nome && !st.lead?.nome_completo) missing.push('nome');
        if (!st.lead?.telefone) missing.push('telefone');
        if (!st.interesse?.modelo_desejado) missing.push('modelo_de_interesse');
        if (!st.negociacao?.forma_pagamento) missing.push('forma_de_pagamento');

        if (missing.length > 0) {
          transferResult = {
            success: false,
            error: 'checklist_incompleto',
            missing_fields: missing,
            message: `Não posso transferir ainda — faltam: ${missing.join(', ')}. Pergunte ao cliente antes de tentar de novo.`,
          };
          console.warn(`[Transfer-Tool] BLOQUEADO — checklist incompleto: ${missing.join(',')}`);
        } else {
          // 2. Buscar lead row
          const { data: leadRow } = await supabase
            .from('ai_crm_leads')
            .select('id, assigned_to_id')
            .eq('agent_id', agent.id)
            .eq('remote_jid', remoteJid)
            .maybeSingle();

          if (!leadRow?.id) {
            transferResult = { success: false, error: 'lead_not_found' };
          } else {
            // 3. Selecionar vendedor — preferência: assigned_to_id existente (lead retornou)
            let chosenSeller: any = null;
            if (leadRow.assigned_to_id) {
              const { data: prevSeller } = await supabase
                .from('ai_team_members')
                .select('*')
                .eq('id', leadRow.assigned_to_id)
                .eq('is_active', true)
                .maybeSingle();
              if (prevSeller) {
                chosenSeller = prevSeller;
                console.log(`[Transfer-Tool] Reusando vendedor previamente atribuído: ${prevSeller.name}`);
              }
            }

            // Fallback: round-robin (mesma lógica do handler atualizar_etapa_crm)
            if (!chosenSeller) {
              let { data: sellers } = await supabase
                .from('ai_team_members').select('*')
                .eq('agent_id', agent.id).eq('is_active', true)
                .order('last_lead_received_at', { ascending: true, nullsFirst: true });
              if (!sellers || sellers.length === 0) {
                const { data: fallbackSellers } = await supabase
                  .from('ai_team_members').select('*')
                  .eq('user_id', agent.user_id).eq('is_active', true)
                  .order('last_lead_received_at', { ascending: true, nullsFirst: true });
                sellers = fallbackSellers;
              }
              const { data: recentTransfers } = await supabase
                .from('ai_lead_transfers').select('to_member_id, created_at')
                .eq('user_id', agent.user_id)
                .order('created_at', { ascending: false }).limit(100);
              const lastMap = new Map<string, number>();
              for (const t of (recentTransfers || [])) {
                if (t.to_member_id && !lastMap.has(t.to_member_id))
                  lastMap.set(t.to_member_id, new Date(t.created_at).getTime());
              }
              const activeSellers = sellers || [];
              const neverReceived = activeSellers.filter((s: any) => !lastMap.has(s.id));
              chosenSeller = neverReceived.length > 0
                ? neverReceived[0]
                : [...activeSellers].sort((a: any, b: any) => (lastMap.get(a.id) || 0) - (lastMap.get(b.id) || 0))[0] || null;
              console.log(`[Transfer-Tool] Round-robin escolheu: ${chosenSeller?.name || 'NENHUM'}`);
            }

            if (!chosenSeller) {
              transferResult = { success: false, error: 'no_active_seller_available' };
            } else {
              // 4. Inserir transfer record
              const timeoutAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
              await supabase.from('ai_lead_transfers').insert({
                user_id: agent.user_id,
                lead_id: leadRow.id,
                to_member_id: chosenSeller.id,
                transfer_reason: leadRow.assigned_to_id === chosenSeller.id ? 'returning_lead' : 'qualified_handoff',
                notes: transferArgs.resumo_breve || transferArgs.motivo || `Qualificado pela tool transferir_para_vendedor`,
                transfer_status: 'pending',
                is_confirmed: false,
                confirmation_timeout_at: timeoutAt,
              });

              await supabase.from('ai_crm_leads').update({
                status: 'transferido',
                status_crm: 'qualificado',
                assigned_to_id: chosenSeller.id,
                summary: transferArgs.resumo_breve || null,
              }).eq('id', leadRow.id);

              // 5. Briefing estruturado pro vendedor
              const briefing = buildBriefingForSeller(
                conversationState,
                pushName || conversationState?.lead?.nome || 'Lead',
                phoneNumber,
                agent.name || 'Pedro SDR',
              );

              let sellerNum = String(chosenSeller.whatsapp_number || '').replace(/\D/g, '');
              if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

              let briefingSent = false;
              if (sellerNum) {
                try {
                  const sendRes = await fetch(`${baseUrl}/send/text`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': instKey },
                    body: JSON.stringify({ number: sellerNum, text: briefing }),
                  });
                  briefingSent = sendRes.ok;
                  console.log(`[Transfer-Tool] Briefing → ${chosenSeller.name} HTTP ${sendRes.status}`);
                } catch (sendErr) {
                  console.error('[Transfer-Tool] Falha ao enviar briefing:', sendErr);
                }
              }

              // 6. Atualizar state com flags de transferência
              try {
                const updatedState = deepMerge(conversationState || {}, {
                  atendimento: {
                    transferencia_solicitada: true,
                    transferencia_executada: true,
                    briefing_enviado_ao_vendedor: briefingSent,
                  },
                });
                await supabase.from('pedro_conversation_state').upsert({
                  lead_id: leadRow.id,
                  agent_id: agent.id,
                  user_id: agent.user_id,
                  state: updatedState,
                  qualificacao_score: getQualificationScore(updatedState), // IT-2.2
                  last_extracted_at: new Date().toISOString(),
                }, { onConflict: 'lead_id,agent_id' });
                conversationState = updatedState;
              } catch (stUpdErr) {
                console.warn('[Transfer-Tool] erro ao atualizar state pós-transfer:', stUpdErr);
              }

              transferResult = {
                success: true,
                vendedor_nome: chosenSeller.name,
                vendedor_id: chosenSeller.id,
                briefing_enviado: briefingSent,
                message: briefingSent
                  ? `Transferi com sucesso pra ${chosenSeller.name}. Pode dizer ao cliente o nome do vendedor que vai atendê-lo.`
                  : `Transferência registrada pra ${chosenSeller.name} mas o WhatsApp dele falhou. Diga ao cliente que o consultor vai entrar em contato em instantes.`,
              };
              console.log(`[Transfer-Tool] ✅ SUCCESS — vendedor=${chosenSeller.name} briefing=${briefingSent}`);
            }
          }
        }
      } catch (transferErr: any) {
        console.error('[Transfer-Tool] exception:', transferErr);
        transferResult = { success: false, error: transferErr?.message || 'exception' };
      }

      // 7. SECOND CALL pra OpenAI gerar mensagem final ciente do resultado
      try {
        const followupRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              ...chatHistory,
              { role: 'user', content: userMessageContentForOpenAi },
              aiMessage,
              {
                role: 'tool',
                tool_call_id: transferToolCall.id,
                name: 'transferir_para_vendedor',
                content: JSON.stringify(transferResult),
              },
            ],
            temperature: agent.temperature || 0.7,
          }),
        });
        if (followupRes.ok) {
          const followupData = await followupRes.json();
          const finalText = followupData.choices?.[0]?.message?.content || '';
          if (finalText) aiResponse = finalText;
        }
      } catch (followupErr) {
        console.error('[Transfer-Tool] erro no follow-up OpenAI:', followupErr);
        // Fallback determinístico se a IA falhar
        if (transferResult.success) {
          aiResponse = `Pronto! Acabei de passar todos os seus dados pro ${transferResult.vendedor_nome}. Ele já vai te chamar aqui em instantes pra fechar tudo. 👌`;
        } else if (transferResult.error === 'checklist_incompleto') {
          aiResponse = `Antes de te passar pro consultor, só preciso confirmar: ${transferResult.missing_fields?.join(', ')}.`;
        } else {
          aiResponse = `Só um momento, vou chamar nosso consultor manualmente pra te atender.`;
        }
      }
    }

    // ── CRM Tool Call (atualizar_etapa_crm) ─────────────────────────────
    const toolCall = aiMessage.tool_calls.find((t: any) => t.function.name === 'atualizar_etapa_crm');
    if (toolCall) {
      try {
        const args = JSON.parse(toolCall.function.arguments);

        // 1. Atualizar banco de dados CRM (arrastar cartão para a coluna correta)
        // Mantém status_crm sincronizado com status, exceto se já estiver
        // explicitamente definido pelo vendedor (negociacao, fechado, etc.)
        const statusCrmMap: Record<string, string> = {
          interessado: 'interessado',
          pouco_qualificado: 'pouco_qualificado',
          medio_qualificado: 'medio_qualificado',
          qualificado: 'qualificado',
        };
        await supabase.from('ai_crm_leads').update({
          status: args.status,
          status_crm: statusCrmMap[args.status] || args.status,
          summary: args.resumo,
          last_interaction_at: new Date().toISOString()
        }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

        console.log(`[CRM] Lead ${phoneNumber} movido para: ${args.status}`);

        // 2. Alertar vendedor SE status indicar transferencia
        if (args.status === 'qualificado' || args.status === 'medio_qualificado' || args.status === 'pouco_qualificado') {
          try {
            console.log(`[Transfer] Qualificado. agent.id=${agent.id} agent.user_id=${agent.user_id}`);

            // ── Busca lead e detecta se é retorno ─────────────────────────
            const { data: leadRow } = await supabase
              .from('ai_crm_leads').select('id')
              .eq('agent_id', agent.id).eq('remote_jid', remoteJid).maybeSingle();

            let skipTransfer = false;
            let isReturnLead = false;
            let returnSeller: any = null;

            if (leadRow?.id) {
              // Tem transfer PENDENTE? → duplicata, ignorar
              const { data: pendingTransfer } = await supabase
                .from('ai_lead_transfers').select('id')
                .eq('lead_id', leadRow.id)
                .eq('transfer_status', 'pending')
                .maybeSingle();

              if (pendingTransfer) {
                console.log(`[Transfer] Lead já tem transfer pendente — ignorando duplicata`);
                skipTransfer = true;
              } else {
                // Tem transfer CONFIRMADO? → lead retornou, vai para o mesmo vendedor
                const { data: lastConfirmed } = await supabase
                  .from('ai_lead_transfers').select('to_member_id')
                  .eq('lead_id', leadRow.id)
                  .eq('transfer_status', 'confirmed')
                  .order('created_at', { ascending: false })
                  .limit(1).maybeSingle();

                if (lastConfirmed?.to_member_id) {
                  const { data: prevSeller } = await supabase
                    .from('ai_team_members').select('*')
                    .eq('id', lastConfirmed.to_member_id)
                    .maybeSingle();

                  if (prevSeller?.is_active) {
                    isReturnLead = true;
                    returnSeller = prevSeller;
                    console.log(`[Transfer] Lead retornou — reencaminhando para ${prevSeller.name}`);
                  }
                }
              }
            }

            if (!skipTransfer) {
              const timeoutAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

              if (isReturnLead && returnSeller) {
                // ── LEAD RETORNOU: vai direto ao vendedor que já o atendeu ─
                await supabase.from('ai_lead_transfers').insert({
                  user_id: agent.user_id,
                  lead_id: leadRow?.id || null,
                  to_member_id: returnSeller.id,
                  transfer_reason: 'round_robin',
                  notes: `Retorno do lead — reencaminhado para ${returnSeller.name}`,
                  transfer_status: 'pending',
                  is_confirmed: false,
                  confirmation_timeout_at: timeoutAt,
                });

                await supabase.from('ai_crm_leads').update({
                  status: 'transferido',
                  assigned_to_id: returnSeller.id,
                }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

                let sellerNum = returnSeller.whatsapp_number.replace(/\D/g, '');
                if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

                const returnMsg =
                  `🔄 *RETORNO DE LEAD — JÁ É SEU CONTATO*\n\n` +
                  `*Nome:* ${pushName}\n` +
                  `*Telefone:* ${phoneNumber}\n\n` +
                  `📝 *O que ele quer agora:*\n${args.resumo}\n\n` +
                  `👉 *Atender:* https://wa.me/${phoneNumber}\n\n` +
                  `⏰ *Responda em até 15 minutos para confirmar o recebimento.*`;

                const sendRes = await fetch(`${baseUrl}/send/text`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'token': instKey },
                  body: JSON.stringify({ number: sellerNum, text: returnMsg }),
                });
                console.log(`[Transfer] 🔄 Retorno → ${returnSeller.name} (HTTP ${sendRes.status})`);

                // Notifica gerente sobre o retorno
                if (agent.gerente_phone) {
                  try {
                    const transferredAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    let gerenteNum = String(agent.gerente_phone).replace(/\D/g, '');
                    if (gerenteNum.length === 10 || gerenteNum.length === 11) gerenteNum = `55${gerenteNum}`;

                    const gerenteMsg =
                      `🔄 *RETORNO DE LEAD — ${agent.name}*\n\n` +
                      `🕐 *Horário:* ${transferredAt}\n\n` +
                      `👤 *Lead:* ${pushName}\n` +
                      `📱 *Telefone:* wa.me/${phoneNumber}\n` +
                      `${args.resumo ? `\n📝 *O que ele quer agora:* ${args.resumo.substring(0, 300)}\n` : ''}` +
                      `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                      `🎯 *Reencaminhado para:* ${returnSeller.name}\n` +
                      `\n━━━━━━━━━━━━━━━━━━━━\n` +
                      `_Gerado automaticamente pelo Pedro SDR_`;

                    await fetch(`${baseUrl}/send/text`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'token': instKey },
                      body: JSON.stringify({ number: gerenteNum, text: gerenteMsg }),
                    });
                  } catch (gerenteErr) {
                    console.error('[Transfer] Falha ao notificar gerente (retorno):', gerenteErr);
                  }
                }

                // Atualiza CRM do Marcos com novo resumo
                try {
                  const { data: crmExisting } = await supabase
                    .from('crm_leads').select('id')
                    .eq('user_id', agent.user_id).eq('phone', crmPhone).maybeSingle();
                  const crmNotes = `Vendedor: ${returnSeller.name}\nAgente IA: ${agent.name}${args.resumo ? `\n\nRetorno — ${args.resumo}` : ''}`;
                  if (crmExisting?.id) {
                    await supabase.from('crm_leads').update({ notes: crmNotes }).eq('id', crmExisting.id);
                  }
                } catch (crmErr) {
                  console.error('[Transfer] Erro ao atualizar CRM Marcos (retorno):', crmErr);
                }

              } else {
                // ── LEAD NOVO: round-robin normal ─────────────────────────
                let { data: sellers, error: sellersErr } = await supabase
                  .from('ai_team_members').select('*')
                  .eq('agent_id', agent.id).eq('is_active', true)
                  .order('last_lead_received_at', { ascending: true, nullsFirst: true });

                console.log(`[Transfer] Vendedores por agent_id: ${sellers?.length ?? 0}${sellersErr ? ' | erro: ' + sellersErr.message : ''}`);

                if (!sellers || sellers.length === 0) {
                  console.warn(`[Transfer] Fallback por user_id=${agent.user_id}...`);
                  const { data: fallbackSellers } = await supabase
                    .from('ai_team_members').select('*')
                    .eq('user_id', agent.user_id).eq('is_active', true)
                    .order('last_lead_received_at', { ascending: true, nullsFirst: true });
                  sellers = fallbackSellers;
                  console.log(`[Transfer] Vendedores por user_id: ${sellers?.length ?? 0}`);
                }

                const { data: recentTransfers } = await supabase
                  .from('ai_lead_transfers').select('to_member_id, created_at')
                  .eq('user_id', agent.user_id)
                  .order('created_at', { ascending: false }).limit(100);

                const lastMap = new Map<string, number>();
                for (const t of (recentTransfers || [])) {
                  if (t.to_member_id && !lastMap.has(t.to_member_id))
                    lastMap.set(t.to_member_id, new Date(t.created_at).getTime());
                }
                const activeSellers = sellers || [];
                const neverReceived = activeSellers.filter((s: any) => !lastMap.has(s.id));
                const nextSeller = neverReceived.length > 0
                  ? neverReceived[0]
                  : [...activeSellers].sort((a: any, b: any) => (lastMap.get(a.id) || 0) - (lastMap.get(b.id) || 0))[0] || null;

                console.log(`[Transfer] nextSeller=${nextSeller ? nextSeller.name : 'NULO'} | total ativos=${activeSellers.length}`);

                if (nextSeller) {
                  await supabase.from('ai_lead_transfers').insert({
                    user_id: agent.user_id,
                    lead_id: leadRow?.id || null,
                    to_member_id: nextSeller.id,
                    transfer_reason: 'round_robin',
                    notes: `Qualificado por ${agent.name}`,
                    transfer_status: 'pending',
                    is_confirmed: false,
                    confirmation_timeout_at: timeoutAt,
                  });

                  await supabase.from('ai_crm_leads').update({
                    status: 'transferido',
                    assigned_to_id: nextSeller.id,
                  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

                  let sellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
                  if (sellerNum.length === 10 || sellerNum.length === 11) sellerNum = `55${sellerNum}`;

                  const sellerMsg =
                    `🚨 *LEAD QUALIFICADO — VOCÊ É O PRÓXIMO DA FILA*\n\n` +
                    `*Agente IA:* ${agent.name}\n` +
                    `*Nome:* ${pushName}\n` +
                    `*Contato:* ${phoneNumber}\n\n` +
                    `📝 *Resumo:*\n${args.resumo}\n\n` +
                    `👉 *Atender:* https://wa.me/${phoneNumber}\n\n` +
                    `⏰ *Responda esta mensagem em até 15 minutos para confirmar o recebimento. Se não responder, o lead passa para o próximo da fila.*`;

                  const sendRes = await fetch(`${baseUrl}/send/text`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'token': instKey },
                    body: JSON.stringify({ number: sellerNum, text: sellerMsg }),
                  });
                  console.log(`[Transfer] ✅ ${nextSeller.name} → HTTP ${sendRes.status}`);

                  // Notifica Gerente
                  if (agent.gerente_phone) {
                    try {
                      const transferredAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                      let gerenteNum = String(agent.gerente_phone).replace(/\D/g, '');
                      if (gerenteNum.length === 10 || gerenteNum.length === 11) gerenteNum = `55${gerenteNum}`;

                      const gerenteMsg =
                        `📊 *RELATÓRIO DE LEAD — ${agent.name}*\n\n` +
                        `🕐 *Horário:* ${transferredAt}\n\n` +
                        `👤 *Lead:* ${pushName}\n` +
                        `📱 *Telefone:* wa.me/${phoneNumber}\n` +
                        `📊 *Status:* qualificado\n` +
                        `${args.resumo ? `\n📝 *Resumo:* ${args.resumo.substring(0, 300)}\n` : ''}` +
                        `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `🎯 *Enviado para:* ${nextSeller.name}\n` +
                        `📲 *WhatsApp vendedor:* ${nextSeller.whatsapp_number}\n` +
                        `\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `_Gerado automaticamente pelo Pedro SDR_`;

                      const gerenteRes = await fetch(`${baseUrl}/send/text`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'token': instKey },
                        body: JSON.stringify({ number: gerenteNum, text: gerenteMsg }),
                      });
                      console.log(`[Transfer] WA gerente → HTTP ${gerenteRes.status}`);
                    } catch (gerenteErr) {
                      console.error('[Transfer] Falha ao notificar gerente:', gerenteErr);
                    }
                  }

                  // Push CRM Marcos
                  try {
                    const { data: firstStage } = await supabase
                      .from('crm_pipeline_stages').select('id')
                      .eq('user_id', agent.user_id)
                      .order('position', { ascending: true }).limit(1).maybeSingle();

                    const { data: crmExisting } = await supabase
                      .from('crm_leads').select('id')
                      .eq('user_id', agent.user_id).eq('phone', crmPhone).maybeSingle();

                    const crmNotes = `Vendedor: ${nextSeller.name}\nAgente IA: ${agent.name}${args.resumo ? `\n\nResumo: ${args.resumo}` : ''}`;
                    const crmTags  = ['Pedro SDR', nextSeller.name];

                    if (crmExisting?.id) {
                      await supabase.from('crm_leads')
                        .update({ notes: crmNotes, tags: crmTags }).eq('id', crmExisting.id);
                    } else {
                      const { data: maxPosRow } = await supabase
                        .from('crm_leads').select('position')
                        .eq('user_id', agent.user_id).eq('stage_id', firstStage?.id || null)
                        .order('position', { ascending: false }).limit(1).maybeSingle();
                      await supabase.from('crm_leads').insert({
                        user_id: agent.user_id, stage_id: firstStage?.id || null,
                        name: pushName, phone: crmPhone,
                        source: `Pedro SDR — ${agent.name}`,
                        notes: crmNotes, tags: crmTags,
                        value: 0, currency: 'BRL', priority: 'medium',
                        position: (maxPosRow?.position ?? -1) + 1,
                      });
                    }
                    console.log(`[Transfer] Lead ${pushName} (${crmPhone}) → CRM Marcos (${nextSeller.name})`);
                  } catch (crmErr) {
                    console.error('[Transfer] Erro ao enviar lead ao CRM do Marcos:', crmErr);
                  }
                } else {
                  console.warn(`[Transfer] ⚠️ Nenhum vendedor ativo. agent_id=${agent.id} user_id=${agent.user_id}`);
                }
              }
            } // ── fecha if (!skipTransfer) ──────────────────────────────────
          } catch (transferErr) {
            console.error('[Transfer] Erro no round-robin:', transferErr);
          }
          // Se qualificou, substituir a resposta para a de Handoff
          aiResponse = handoffMsg;
        } else if (!aiResponse && !bndvToolCall) {
          // Se não é qualificado, e o GPT não retornou texto (só o tool_call), devemos devolver o resultado da tool e pedir o texto!
          // Only do this if we didn't already handle via BNDV tool call
          console.log(`[Webhook] IA apenas executou a tool sem texto. Solicitando resposta final...`);
          const secondRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
              model: aiModel,
              messages: [
                { role: 'system', content: systemPrompt },
                ...chatHistory,
                { role: 'user', content: userMessageContentForOpenAi },
                aiMessage,
                { role: 'tool', tool_call_id: toolCall.id, name: toolCall.function.name, content: `{"success": true}` }
              ],
              temperature: agent.temperature || 0.7
            })
          });
          if (secondRes.ok) {
            const secondData = await secondRes.json();
            aiResponse = secondData.choices?.[0]?.message?.content || '';
            console.log(`[Webhook] Resposta final capturada: ${aiResponse}`);
          }
        }
      } catch (err) {
        console.error("[Webhook] Erro no Handoff/CRM", err)
      }
    }
  }

  if (!aiResponse) return new Response('No AI Response', { headers: corsHeaders })

  // Salvar no histórico
  await supabase.from('wa_chat_history').insert({
    user_id: agent.user_id, agent_id: agent.id, instance_id: instanceName,
    remote_jid: remoteJid, role: 'assistant', content: aiResponse
  })

  // ── PEDRO STATE: heurísticas pós-resposta (auto-flags) ─────────────────
  // Detecta auto-apresentação ("Sou o Carvalho..."), envio de ficha completa, etc.
  // Sem chamar LLM — só regex barato. Evita perguntar de novo no próximo turno.
  try {
    const selfFlags = applyAgentSelfFlags(conversationState || {}, aiResponse);
    if (Object.keys(selfFlags).length > 0) {
      const { data: leadForFlags } = await supabase
        .from('ai_crm_leads')
        .select('id')
        .eq('agent_id', agent.id)
        .eq('remote_jid', remoteJid)
        .maybeSingle();
      if (leadForFlags?.id) {
        // Camada 1 do Bug #2 (race): re-fetch state fresco antes do upsert
        // pra preservar flags setadas por turno anterior em paralelo.
        const { data: freshStateForFlags } = await supabase
          .from('pedro_conversation_state')
          .select('state')
          .eq('lead_id', leadForFlags.id)
          .eq('agent_id', agent.id)
          .maybeSingle();
        const baseStateForFlags = (freshStateForFlags?.state && Object.keys(freshStateForFlags.state).length > 0)
          ? freshStateForFlags.state
          : (conversationState || {});

        const updatedState = deepMerge(baseStateForFlags, selfFlags);
        await supabase.from('pedro_conversation_state').upsert({
          lead_id: leadForFlags.id,
          agent_id: agent.id,
          user_id: agent.user_id,
          state: updatedState,
          qualificacao_score: getQualificationScore(updatedState), // IT-2.2
          last_extracted_at: new Date().toISOString(),
        }, { onConflict: 'lead_id,agent_id' });
        console.log(`[PedroState] auto-flags aplicadas: ${Object.keys(selfFlags).join(',')}`);
      }
    }
  } catch (flagErr) {
    console.warn('[PedroState] erro nas auto-flags (não bloqueia):', flagErr);
  }

  // ── CRITICAL: Atualiza last_agent_reply_at para regra de 5min/10min ──
  // O cron-lead-followup usa este campo para saber quando o agente IA respondeu pela última vez
  const agentReplyTs = new Date().toISOString();
  await supabase.from('ai_crm_leads').update({
    last_agent_reply_at: agentReplyTs,
    last_interaction_at: agentReplyTs,
  }).eq('agent_id', agent.id).eq('remote_jid', remoteJid);

  // Camada 3 do Bug #2: strip auto-apresentação se o agente já se apresentou
  // antes (consultor_apresentado=true no state). Defesa contra LLM ignorar a
  // regra do system prompt esporadicamente. Se a resposta inteira era só
  // apresentação, retorna fallback "Pode mandar 😊".
  const finalText = stripIntroIfAlreadyPresented(aiResponse, conversationState);

  // ─── IT-1.1 + IT-1.2: Message Splitting + Typing Simulation ──────────────
  // IT-1.1 PEDRO_FF_MESSAGE_SPLITTING: divide resposta em ate 3 partes.
  // IT-1.2 PEDRO_FF_TYPING_SIMULATION: antes de cada send, dispara presence
  // "composing" + sleep proporcional ao tamanho (clamp 800ms-4s), depois
  // envia, depois "paused" (best-effort - presence pode falhar silenciosamente).
  // Combina: humano-like (digitando -> mensagem -> pausa -> digitando -> ...).
  // FALLBACK total (ambas off): comportamento atual identico ao legado.
  const splitEnabled = isPedroFeatureEnabled('MESSAGE_SPLITTING');
  const typingEnabled = isPedroFeatureEnabled('TYPING_SIMULATION');
  const messageParts = splitEnabled
    ? splitMessageForHumanization(finalText)
    : [finalText];
  const INTER_MESSAGE_DELAY_MS = 600; // pausa entre partes (alem do typing)

  if (splitEnabled && messageParts.length > 1) {
    console.log(`[Humanization] MESSAGE_SPLITTING on - dividindo em ${messageParts.length} partes`);
  }
  if (typingEnabled) {
    console.log(`[Humanization] TYPING_SIMULATION on - delays proporcionais`);
  }

  for (let i = 0; i < messageParts.length; i++) {
    const partText = messageParts[i];

    // IT-1.2: typing presence + delay ANTES do send
    if (typingEnabled) {
      // best-effort: nao bloqueia se presence endpoint nao existir
      await sendTypingPresence(baseUrl, instKey, phoneNumber, 'composing');
      const typingDelay = calculateTypingDelayMs(partText);
      await new Promise((r) => setTimeout(r, typingDelay));
    }

    // Salvar cada parte no wa_inbox (registro outgoing por parte)
    await supabase.from('wa_inbox').insert({
      user_id: waInstance.user_id,
      instance_id: waInstance.id,
      phone: phoneNumber,
      contact_name: pushName || null,
      direction: 'outgoing',
      message_type: 'text',
      content: partText,
      is_read: true,
      ai_category: 'agent',
    }).then(({ error }: any) => {
      if (error) console.error('[uazapi-webhook] wa_inbox outgoing insert error:', error.message);
    });

    // Enviar para o cliente final
    try {
      await fetch(`${baseUrl}/send/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey },
        body: JSON.stringify({ number: phoneNumber, text: partText })
      })
    } catch (e) {
      console.error('[Webhook] Erro ao enviar mensagem (parte ' + (i + 1) + '):', e)
    }

    // IT-1.2: presence "paused" apos enviar (best-effort)
    if (typingEnabled) {
      await sendTypingPresence(baseUrl, instKey, phoneNumber, 'paused');
    }

    // Delay entre partes consecutivas (nao na ultima)
    if (i < messageParts.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_MESSAGE_DELAY_MS));
    }
  }

  // ── BNDV: Send vehicle images after text response ─────────────────────
  if (bndvResultForImages && bndvResultForImages.items.length > 0) {
    console.log(`[BNDV-IMG] Enviando fotos de ${Math.min(3, bndvResultForImages.items.length)} veículos...`);
    const vehiclesToSend = bndvResultForImages.items.slice(0, 3);
    for (const vehicle of vehiclesToSend) {
      if (vehicle.principal_image) {
        try {
          const caption = `${vehicle.marca} ${vehicle.modelo} ${vehicle.versao} ${vehicle.ano}\n💰 R$ ${vehicle.preco.toLocaleString('pt-BR')}\n🔄 ${vehicle.km.toLocaleString('pt-BR')} km | ⛽ ${vehicle.combustivel} | 🎨 ${vehicle.cor}`;
          const imageSent = await sendVehicleImage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, vehicle.principal_image, caption);
          if (imageSent) {
            await supabase.from('wa_inbox').insert({
              user_id: waInstance.user_id,
              instance_id: waInstance.id,
              phone: phoneNumber,
              contact_name: pushName || null,
              direction: 'outgoing',
              message_type: 'image',
              content: caption,
              media_url: vehicle.principal_image,
              is_read: true,
              ai_category: 'agent',
            }).then(({ error }: any) => {
              if (error) console.error('[uazapi-webhook] wa_inbox image insert error:', error.message);
            });
          }
        } catch (imgErr) {
          console.error(`[BNDV-IMG] Erro ao enviar imagem de ${vehicle.label}:`, imgErr);
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 })
}
