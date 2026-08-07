// ============================================================================
// INGESTOR — teste offline da LEITURA DA CONVERSA REAL (era v3).
//
// DEFEITO (medido em producao, 07/08/2026): o analista so enxergava o vendedor pelo caminho v2
// (`wa_inbox`). Nao havia NENHUMA fonte v3 para ele. Consequencia direta, contada no banco:
//   `mensagens_vendedor_lidas = thread.filter(m => m.from === 'vendedor').length`  (ingestor)
//   -> lead que vive no v3 dava 0 -> o prompt manda "registre falha por falta de resposta com notas
//      baixas" -> nota 0 e veredito `falha_atendimento` para conversa que ninguem leu.
// Foram 8 casos assim so na janela medida, e 2 deles no unico cliente novo ligado.
//
// ELO QUE FALTAVA (ja existia, nao precisou criar): `wa_synced_messages.actor_source` classifica cada
// mensagem em `cliente | ia_v3 | humano_manual | desconhecido` — 7.860 do vendedor, 5 tenants, ate hoje.
//
// CONTRATO desta suite:
//  1. `humano_manual` -> vendedor | `cliente` -> cliente | `ia_v3` -> contexto da IA.
//  2. `desconhecido` NUNCA vira papel. Trata-lo como vendedor FABRICA mensagem que ele nao mandou;
//     como IA, ESCONDE o vendedor. Fica de fora e e contado a parte, para a cobertura ser honesta.
//  3. A mesma mensagem vinda de duas fontes (wa_inbox e wa_synced_messages) entra UMA vez.
//     Reusa a regra que o time ja escolheu: mesmo papel + <120s + texto normalizado igual.
//  4. Repeticao legitima (a pessoa escreve "ok" de novo depois) NAO e deduplicada.
//
//   npx tsx supabase/functions/_shared/feedback/ingestor.offline-test.ts
// ============================================================================
import {
  papelDeActorSource, pushThreadDedup, normalizeFeedbackText,
  type ThreadMessage,
} from './ingestor.ts';

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ''}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ''}`); }
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `esperado ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`);

const msg = (from: ThreadMessage['from'], texto: string, iso: string): ThreadMessage =>
  ({ from, texto, timestamp: iso, canal: 'pedro' });

// --- [A] O mapa de papel: o coracao da correcao -----------------------------------------------------
eq('[A1] humano_manual -> vendedor',  papelDeActorSource('humano_manual'), 'vendedor');
eq('[A2] cliente -> cliente',         papelDeActorSource('cliente'),       'cliente');
eq('[A3] ia_v3 -> ia',                papelDeActorSource('ia_v3'),         'ia');

// --- [B] `desconhecido` NUNCA vira papel (a armadilha) ----------------------------------------------
// Se virasse vendedor, o vendedor levaria nota por texto que nao escreveu. Se virasse IA, o vendedor
// sumiria da conversa e cairiamos no mesmo zero de antes. Fica fora, e a cobertura registra.
eq('[B1] desconhecido -> null (nao entra em papel nenhum)', papelDeActorSource('desconhecido'), null);
eq('[B2] valor novo/inesperado -> null (fail-closed)',      papelDeActorSource('algo_novo_amanha'), null);
eq('[B3] null -> null',                                     papelDeActorSource(null), null);
eq('[B4] string vazia -> null',                             papelDeActorSource(''), null);
eq('[B5] undefined -> null',                                papelDeActorSource(undefined), null);
check('[B6] o mapa nao tem fallback para vendedor',
  (['desconhecido', '', 'x', 'HUMANO_MANUAL '] as unknown[]).every((v) => papelDeActorSource(v as string) !== 'vendedor'),
  'algum valor inesperado virou vendedor');

// --- [C] Dedupe entre fontes: a mesma mensagem entra UMA vez ----------------------------------------
{
  const t: ThreadMessage[] = [];
  pushThreadDedup(t, msg('vendedor', 'Bom dia! Tenho sim esse carro.', '2026-08-07T13:00:00Z'));
  // mesma mensagem pelo wa_synced_messages, com 30s de diferenca de carimbo
  pushThreadDedup(t, msg('vendedor', 'Bom dia! Tenho sim esse carro.', '2026-08-07T13:00:30Z'));
  eq('[C1] mesma mensagem de duas fontes entra 1 vez', t.length, 1);

  const t2: ThreadMessage[] = [];
  pushThreadDedup(t2, msg('vendedor', 'ok', '2026-08-07T13:00:00Z'));
  pushThreadDedup(t2, msg('vendedor', 'ok', '2026-08-07T13:05:00Z')); // 5 min depois = repeticao real
  eq('[C2] repeticao legitima (>2min) NAO e deduplicada', t2.length, 2);

  const t3: ThreadMessage[] = [];
  pushThreadDedup(t3, msg('cliente', 'tudo bem?', '2026-08-07T13:00:00Z'));
  pushThreadDedup(t3, msg('vendedor', 'tudo bem?', '2026-08-07T13:00:10Z')); // papeis diferentes
  eq('[C3] mesmo texto de papeis DIFERENTES nao e deduplicado', t3.length, 2);
}

// --- [D] Normalizacao usada no dedupe ---------------------------------------------------------------
check('[D1] a normalizacao ignora caixa e espaco redundante',
  normalizeFeedbackText('  Bom   DIA!  ') === normalizeFeedbackText('bom dia!'),
  `${JSON.stringify(normalizeFeedbackText('  Bom   DIA!  '))} vs ${JSON.stringify(normalizeFeedbackText('bom dia!'))}`);
check('[D2] textos realmente diferentes continuam diferentes',
  normalizeFeedbackText('tem esse carro?') !== normalizeFeedbackText('tem outro carro?'));

// --- [E] O caso do incidente, ponta a ponta ---------------------------------------------------------
// Conversa que vive no v3: o vendedor respondeu, mas o analista lia 0 e dava nota 0.
{
  const thread: ThreadMessage[] = [];
  const contexto: ThreadMessage[] = [];
  const linhas = [
    { actor_source: 'cliente',       content: 'Oi, o HB20 ainda esta disponivel?', ts: '2026-08-07T12:00:00Z' },
    { actor_source: 'ia_v3',         content: 'Oi! Esta sim, quer ver as fotos?',  ts: '2026-08-07T12:00:20Z' },
    { actor_source: 'humano_manual', content: 'Aqui e o Luiz, posso te ajudar',    ts: '2026-08-07T12:10:00Z' },
    { actor_source: 'humano_manual', content: 'Consegue passar amanha as 10h?',    ts: '2026-08-07T12:11:00Z' },
    { actor_source: 'desconhecido',  content: 'mensagem sem autoria resolvida',    ts: '2026-08-07T12:12:00Z' },
  ];
  let ignoradas = 0;
  for (const l of linhas) {
    const papel = papelDeActorSource(l.actor_source);
    if (papel === null) { ignoradas++; continue; }
    const m = msg(papel, l.content, l.ts);
    if (papel === 'ia') pushThreadDedup(contexto, m); else pushThreadDedup(thread, m);
  }
  const vendedor = thread.filter((m) => m.from === 'vendedor').length;
  const cliente  = thread.filter((m) => m.from === 'cliente').length;

  eq('[E1] o vendedor passa a ser LIDO (era 0, causa da nota 0 injusta)', vendedor, 2);
  eq('[E2] o cliente entra na thread avaliada', cliente, 1);
  eq('[E3] a IA fica no contexto, nao na avaliacao do vendedor', contexto.length, 1);
  eq('[E4] a mensagem sem autoria fica de fora e e contada', ignoradas, 1);
  check('[E5] nenhuma mensagem sem autoria vazou para a thread',
    !thread.some((m) => m.texto.includes('sem autoria')));
  check('[E6] conversa_vendedor_suficiente passaria a ser verdadeira (v >= 2)', vendedor >= 2);
}

console.log(`\nINGESTOR conversa real v3 — ${ok} OK, ${fail} RED`);
if (fail > 0) { for (const f of fails) console.error(` - ${f}`); process.exit(1); }
