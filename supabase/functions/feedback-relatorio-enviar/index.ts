// deno-lint-ignore-file no-explicit-any
// ============================================================================
// feedback-relatorio-enviar — Envia o relatorio de atendimento (Cerebro) no
// WhatsApp de quem tem "Atendimento" ligado em conta_responsaveis. Gera o PDF
// (feedback-relatorio-pdf), assina a URL do bucket privado e manda por /send/media
// SEMPRE pelo numero da IA (feedback_instancia_ia) — nunca de vendedor.
// verify_jwt=false, guardado por VIEW_KEY. 1 chamada por tenant (o cron itera).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Guard interno das funcoes de feedback: secret FEEDBACK_VIEW_KEY (setado no
// dashboard). Sem literal no codigo — se o secret faltar, falha fechado.
const VIEW_KEY = Deno.env.get('FEEDBACK_VIEW_KEY') || '';
const TENANT_DEFAULT = 'f49fd48a-4386-4009-95f3-26a5100b84f7';
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Normaliza pra formato UAZAPI (digitos com DDI 55).
function normNum(s?: string | null): string {
  let d = (s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11 && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Data de hoje em BRT (UTC-3), formato dd/mm/aaaa.
function dataBRT(): string {
  const d = new Date(Date.now() - 3 * 3600e3);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Mensagem padrão que vai junto do PDF todo dia.
function captionPadrao(): string {
  return [
    `Relatório de atendimento - ${dataBRT()}`,
    ``,
    `Resumo de ontem em 2 páginas: o funil de vendas, onde está o gargalo (lead, atendimento ou fechamento) e como cada vendedor foi.`,
    ``,
    `O relatório completo, conversa por conversa, fica na área de Feedbacks da plataforma.`,
    ``,
    `Logos IA`,
  ].join('\n');
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function gargaloGerencial(funil: any): string {
  const chegaram = n(funil?.chegaram);
  const qualificados = n(funil?.qualificados);
  const bemAtendidos = n(funil?.bem_atendidos);
  const vendas = n(funil?.vendas);
  if (!chegaram) return 'ainda falta volume de leads para leitura segura';
  if (qualificados < Math.max(1, Math.round(chegaram * 0.25))) return 'entrada de leads com pouca intencao de compra';
  if (bemAtendidos < Math.max(1, Math.round(qualificados * 0.55))) return 'qualidade do atendimento antes do fechamento';
  if (vendas < Math.max(1, Math.round(bemAtendidos * 0.2))) return 'fechamento e retomada comercial';
  return 'rotina saudavel, manter acompanhamento diario';
}

// Caption CURTA (padrao atual): SO o PDF em anexo + um resumo de 3 numeros.
// NUNCA manda o relatorio completo em texto — o detalhe fica dentro do PDF.
// Numeros do NEPQ do dia: atendimentos avaliados, nota media e pontos de atencao.
function captionCurta(nepq: { total: number; nota: number | null; alertas: number }, funil: any): string {
  const total = nepq.total || n(funil?.analisados) || 0;
  const notaTxt = nepq.nota != null ? `${nepq.nota}/100` : '—';
  return [
    `📊 Relatório diário de Feedback — ${dataBRT()}`,
    ``,
    `O PDF com a análise completa está em anexo.`,
    ``,
    `Resumo rápido:`,
    `• ${total} atendimento(s) avaliado(s)`,
    `• Nota média: ${notaTxt}`,
    `• ${nepq.alertas} ponto(s) de atenção`,
    ``,
    `Logos IA`,
  ].join('\n');
}

function captionGerencial(dados: any, obs?: string): string {
  if (!dados?.funil) return captionPadrao();
  const funil = dados.funil || {};
  const vendedores = Array.isArray(dados.vendedores) ? dados.vendedores : [];
  const chegaram = n(funil.chegaram);
  const analisados = n(funil.analisados);
  const pendentesAnalise = n(funil.pendentes_analise);
  const qualificados = n(funil.qualificados);
  const bemAtendidos = n(funil.bem_atendidos);
  const vendas = n(funil.vendas);
  const risco = vendedores
    .map((v: any) => ({
      nome: String(v?.nome || 'vendedor'),
      chance: n(v?.com_interesse),
      bem: n(v?.bem_atendidos),
      vendas: n(v?.vendas),
      score: n(v?.score_medio),
    }))
    .filter((v: any) => v.chance > 0 && v.bem < v.chance && v.vendas === 0)
    .sort((a: any, b: any) => (b.chance - b.bem) - (a.chance - a.bem) || a.score - b.score)[0];

  const linhas = [
    `Relatorio de atendimento - ${dataBRT()}`,
    ``,
    `Leitura rapida: ${chegaram} leads recebidos, ${analisados} analisados pelo feedback, ${qualificados} com interesse real, ${bemAtendidos} bem atendidos e ${vendas} venda(s).`,
    `Gargalo principal: ${gargaloGerencial(funil)}.`,
  ];
  if (pendentesAnalise > 0) {
    linhas.push(`Atencao: ${pendentesAnalise} lead(s) ainda nao tinham analise de feedback no fechamento deste relatorio.`);
  }
  if (risco) {
    linhas.push(`Olhar primeiro: ${risco.nome} recebeu ${risco.chance} lead(s) com interesse e teve ${risco.bem} bem atendido(s).`);
  }
  // Fase 3 (apresentacao) — 1 linha so, se houve analise PARCIAL no periodo.
  if (obs) linhas.push(``, obs);
  linhas.push(
    ``,
    `PDF em anexo: funil, vendedores e qualidade dos leads.`,
    `Detalhe por conversa: Logos > Pedro > Relatorios.`,
    ``,
    `Logos IA`,
  );
  return linhas.join('\n');
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
    const body = await req.json().catch(() => ({}));
    if (body?.k !== VIEW_KEY) return json({ ok: false, error: 'forbidden' }, 403);

    const tenant = String(body?.tenant_id || TENANT_DEFAULT);
    const admin = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Item 10: log rastreavel (nao deixa falha silenciosa no cron diario).
    const logJob = async (status: string, detalhe: any, erro?: string) => {
      try { await admin.from('feedback_job_log').insert({ funcao: 'feedback-relatorio-enviar', tenant_id: tenant, status, detalhe, erro: erro || null }); } catch (_e) { /* best-effort */ }
    };

    // 1) Destinatarios: quem tem "Atendimento" ligado nos Responsaveis.
    const { data: recs, error: rErr } = await admin
      .from('conta_responsaveis')
      .select('nome, whatsapp')
      .eq('user_id', tenant)
      .eq('recebe_atendimento', true)
      .eq('ativo', true);
    if (rErr) return json({ ok: false, error: `destinatarios: ${rErr.message}` }, 200);
    const dests = (recs || [])
      .map((r: any) => ({ nome: r.nome, num: normNum(r.whatsapp) }))
      .filter((r: any) => r.num.length >= 12);
    if (!dests.length) return json({ ok: true, enviados: 0, motivo: 'nenhum responsavel com Atendimento ligado' });

    // 2) Instancia da IA (nunca numero de vendedor).
    const { data: instRows, error: iErr } = await admin.rpc('feedback_instancia_ia', { p_tenant: tenant });
    if (iErr) return json({ ok: false, error: `instancia: ${iErr.message}` }, 200);
    const inst: any = (instRows || [])[0];
    if (!inst || !inst.api_url || !inst.token) {
      await logJob('falhou', { etapa: 'instancia' }, 'sem instancia da IA conectada');
      return json({ ok: false, error: 'sem instancia da IA conectada para disparar' }, 200);
    }
    if (inst.provider === 'meta') {
      return json({ ok: false, error: 'a instancia da IA e Meta (2a via) — envio de documento por aqui ainda nao suportado; use uma instancia UAZAPI' }, 200);
    }

    const baseIA = String(inst.api_url).replace(/\/+$/, '');
    // Fallback de falha do PDF: manda NO MAXIMO 1 linha curta (nunca o relatorio
    // completo em texto). Em dry_run nao envia nada.
    const enviarFalhaPdf = async () => {
      if (body?.dry_run) return;
      const msg = 'Nao foi possivel gerar o PDF do relatorio diario de Feedback hoje. Verifique o painel da Logos IA.';
      for (const d of dests) {
        try {
          await fetch(`${baseIA}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token: inst.token, apikey: inst.token },
            body: JSON.stringify({ number: d.num, text: msg }),
          });
        } catch (_e) { /* best-effort */ }
      }
    };

    // 3) Gera o PDF DIARIO simplificado (2 paginas: funil + gargalo + vendedores).
    //    O completo (conversa por conversa) e o feedback-relatorio-pdf, usado
    //    sob demanda na area de Feedbacks — nao no disparo diario.
    const uploadNome = `relatorio-diario-${tenant.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const genRes = await fetch(`${SUPA_URL}/functions/v1/feedback-relatorio-diario-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        k: VIEW_KEY, tenant_id: tenant, upload_nome: uploadNome,
        loja: body?.loja,
      }),
    });
    const gen = await genRes.json().catch(() => ({}));
    if (!gen?.ok) {
      await logJob('falhou', { etapa: 'gerar_pdf' }, String(gen?.error || genRes.status));
      await enviarFalhaPdf();
      return json({ ok: false, error: `falha ao gerar o PDF: ${gen?.error || genRes.status}` }, 200);
    }

    // 4) URL assinada (o bucket e privado; a UAZAPI baixa por essa URL).
    const { data: signed, error: sErr } = await admin.storage
      .from('feedback-relatorios').createSignedUrl(uploadNome, 3600);
    if (sErr || !signed?.signedUrl) {
      await logJob('falhou', { etapa: 'assinar_url' }, sErr?.message || 'sem url');
      await enviarFalhaPdf();
      return json({ ok: false, error: `falha ao assinar URL: ${sErr?.message || 'sem url'}` }, 200);
    }

    // 5) Envia o documento a cada destinatario, pelo numero da IA.
    let dadosCaption: any = null;
    try {
      const { data } = await admin.rpc('feedback_relatorio_diario_dados', { p_tenant: tenant, p_dias: 7 });
      dadosCaption = data;
    } catch (_e) {
      dadosCaption = null;
    }
    // Fase 3 (apresentacao) — conta analises PARCIAIS dos ultimos 7 dias lendo a
    // coluna confianca_analise ja pronta (NULL nao conta). Sem IA, sem reprocessar,
    // sem tocar na analise. Vira 1 linha curta na caption.
    // Resumo NEPQ do dia (ontem) pro corpo curto da caption: atendimentos avaliados,
    // nota media e pontos de atencao. Le a RPC de dados (nao envia nada, nao toca analise).
    let nepqResumo = { total: 0, nota: null as number | null, alertas: 0 };
    try {
      const ontemBRT = new Date(Date.now() - 3 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
      const { data: nd } = await admin.rpc('feedback_nepq_diario_dados', { p_tenant: tenant, p_ref: ontemBRT });
      const arr = Array.isArray(nd) ? nd : [];
      const scores = arr.map((x: any) => Number(x?.nepq_score)).filter((v: number) => Number.isFinite(v));
      nepqResumo = {
        total: arr.length,
        nota: scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null,
        alertas: arr.filter((x: any) => Number(x?.nepq_score) < 45).length,
      };
    } catch (_e) { /* usa fallback do funil */ }
    const caption = String(body?.caption || captionCurta(nepqResumo, dadosCaption?.funil));

    // dry_run (smoke test): prova o payload SEM enviar de verdade. type=document (PDF) + caption curta.
    if (body?.dry_run) {
      return json({
        ok: true, dry_run: true,
        payload: { type: 'document', file: signed.signedUrl ? 'PDF (signed url)' : null, caption },
        caption_linhas: caption.split('\n').length,
        caption_chars: caption.length,
        destinatarios: dests.length,
      });
    }
    const base = baseIA;
    const results: any[] = [];
    for (const d of dests) {
      try {
        const r = await fetch(`${base}/send/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: inst.token, apikey: inst.token },
          body: JSON.stringify({ number: d.num, file: signed.signedUrl, type: 'document', caption }),
        });
        results.push({ num: d.num, ok: r.ok, status: r.status, err: r.ok ? null : String(await r.text().catch(() => '')).slice(0, 200) });
      } catch (e: any) {
        results.push({ num: d.num, ok: false, err: String(e?.message || e).slice(0, 200) });
      }
    }
    const enviados = results.filter((x) => x.ok).length;

    // 6) Registra no HISTORICO (feedback_relatorios) — alimenta a aba de relatorios.
    // Importante: "leads recebidos" vem da base real do CRM (Pedro + Marcos).
    // "leads analisados" e "por_qualidade" vêm do cérebro de feedback. Separar
    // esses números evita o bug de parecer que chegaram só os leads já analisados.
    try {
      const inicioMes = new Date();
      inicioMes.setUTCDate(1); inicioMes.setUTCHours(0, 0, 0, 0);
      const { data: convs } = await admin.from('feedback_conversas')
        .select('qualidade_lead')
        .eq('tenant_id', tenant).eq('status', 'concluido')
        .gte('created_at', inicioMes.toISOString());
      const porQ: Record<string, number> = {};
      for (const c of (convs || [])) { const k = (c as any).qualidade_lead || 'sem'; porQ[k] = (porQ[k] || 0) + 1; }
      const funilCaption = dadosCaption?.funil || {};
      const resumo = {
        paginas: gen.paginas ?? null,
        enviados,
        destinatarios: dests.map((d) => ({ nome: d.nome, num: d.num })),
        periodo_dias: 7,
        ref_date: dadosCaption?.ref_date || null,
        leads_recebidos: n(funilCaption.chegaram),
        leads_analisados: n(funilCaption.analisados),
        pendentes_analise: n(funilCaption.pendentes_analise),
        leads_qualificados: n(funilCaption.qualificados),
        leads_bem_atendidos: n(funilCaption.bem_atendidos),
        vendas: n(funilCaption.vendas),
        por_qualidade: porQ,
      };
      await admin.from('feedback_relatorios').insert({
        tenant_id: tenant,
        data_ref: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10),
        loja: String(body?.loja || 'Sua loja'),
        storage_path: uploadNome,
        resumo,
        status: enviados > 0 ? 'enviado' : 'gerado',
        enviado_em: enviados > 0 ? new Date().toISOString() : null,
      });
    } catch (e: any) {
      console.warn('[feedback-relatorio-enviar] falha ao registrar historico:', e?.message || e);
    }

    return json({ ok: enviados > 0, enviados, total: dests.length, arquivo: uploadNome, paginas: gen.paginas, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 800) }, 200);
  }
});
