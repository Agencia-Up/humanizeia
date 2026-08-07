// ============================================================================
// ANALISTA — teste offline da RESOLUÇÃO DE CONFIG (tenant × global).
//
// DEFEITO CORRIGIDO (medido em produção, 06/08/2026): a fila de análise é gateada por
// `feedback_config.feature_flags->>'analise'`. Habilitar um tenant pela tela de admin chama
// `feedback_config_admin_set`, que cria a linha do tenant SEM `prompt_especialista` e SEM `framework`.
// A leitura antiga pegava UMA linha só, com `.order('tenant_id', {ascending:false, nullsFirst:false})`
// — ou seja, a linha DO TENANT vencia a global. Consequência para todo tenant recém-ligado:
//   - `promptEsp = ''`   -> perde a camada especialista (2725 chars) do system prompt
//   - `framework = {}`   -> `instrucaoContrato` não diz à LLM QUAIS competências avaliar (:130)
//                           e `calcScore` devolve 0 por construção (:189, `total > 0 ? ... : 0`)
// Resultado: nota 0 em 100% das conversas do cliente novo. Ligar 4 clientes de uma vez quebraria os 4.
//
// CONTRATO: a config do tenant faz MERGE SOBRE a global, campo a campo. O tenant só vence onde
// realmente preencheu; onde não preencheu, herda. Assim a linha criada pelo admin nasce funcional e a
// ativação deixa de ser perigosa — o conserto é estrutural, não um dado a preencher na mão.
//
// `framework` é ATÔMICO de propósito: ou é o do tenant, ou é o da global, nunca a mistura. `competencias`
// é um conjunto de PESOS que precisa ser coerente entre si — mesclar pesos de dois frameworks produziria
// uma escala inválida e um contrato incoerente com o que a LLM foi mandada avaliar.
//
//   npx tsx ../../../supabase/functions/_shared/feedback/analista.offline-test.ts   (a partir de services/pedro-v3/Agent)
// ============================================================================
import { resolveFeedbackConfig } from './analista.ts';

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `esperado ${JSON.stringify(want)}, veio ${JSON.stringify(got)}`);

const T = 'f49fd48a-4386-4009-95f3-26a5100b84f7';
const FW_GLOBAL = { competencias: { conexao: 20, descoberta: 30, fechamento: 50 } };
const FW_TENANT = { competencias: { rapport: 40, objecao: 60 } };
const PROMPT_GLOBAL = 'Você é o especialista Logos. Regra: se o vendedor não respondeu, registre falha.';
const PROMPT_TENANT = 'Camada especialista própria desta loja.';

const linhaGlobal = { tenant_id: null, nicho: 'automotivo', framework: FW_GLOBAL, prompt_especialista: PROMPT_GLOBAL };

// --- [A] Comportamento de HOJE preservado: tenant completo vence em tudo -----------------------------
// Este é o gate de não-regressão. O tenant que funciona hoje (f49fd48a) tem os três campos preenchidos;
// a mudança NÃO pode alterar nada para ele.
{
  const r = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: T, nicho: 'motos', framework: FW_TENANT, prompt_especialista: PROMPT_TENANT }],
    T,
  );
  eq('[A1] nicho do tenant vence', r.nicho, 'motos');
  eq('[A2] framework do tenant vence', r.framework, FW_TENANT);
  eq('[A3] prompt do tenant vence', r.promptEsp, PROMPT_TENANT);
  eq('[A4] nada herdado da global', r.herdadoDoGlobal, []);
}

// --- [B] O BUG REAL: linha criada pelo admin (só feature_flags) --------------------------------------
// É exatamente o que `feedback_config_admin_set` produz. Antes: prompt '' e framework {} -> nota 0 sempre.
{
  const r = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: T, nicho: null, framework: null, prompt_especialista: null }],
    T,
  );
  eq('[B1] prompt especialista herda da global (não vira string vazia)', r.promptEsp, PROMPT_GLOBAL);
  eq('[B2] framework herda da global (competências existem)', r.framework, FW_GLOBAL);
  eq('[B3] nicho herda da global', r.nicho, 'automotivo');
  eq('[B4] herança é observável', r.herdadoDoGlobal, ['nicho', 'framework', 'prompt_especialista']);
  check('[B5] o score deixa de ser 0 por construção (há pesos)',
    Object.keys(r.framework?.competencias ?? {}).length > 0);
}

// --- [C] Merge é CAMPO A CAMPO, não tudo-ou-nada ----------------------------------------------------
{
  const r = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: T, nicho: 'motos', framework: null, prompt_especialista: PROMPT_TENANT }],
    T,
  );
  eq('[C1] nicho próprio preservado', r.nicho, 'motos');
  eq('[C2] prompt próprio preservado', r.promptEsp, PROMPT_TENANT);
  eq('[C3] só o framework herdou', r.framework, FW_GLOBAL);
  eq('[C4] observabilidade aponta só o campo herdado', r.herdadoDoGlobal, ['framework']);
}

// --- [D] "Preenchido" é definido pelo CONSUMIDOR, não por não-vazio superficial ----------------------
// framework só serve se tiver `competencias` com ao menos uma chave: é o que instrucaoContrato(:130)
// lista para a LLM e o que calcScore(:182) usa como peso. Um objeto sem isso é inútil, não "preenchido".
{
  const r1 = resolveFeedbackConfig([linhaGlobal, { tenant_id: T, framework: {} }], T);
  eq('[D1] framework {} é inútil -> herda', r1.framework, FW_GLOBAL);

  const r2 = resolveFeedbackConfig([linhaGlobal, { tenant_id: T, framework: { competencias: {} } }], T);
  eq('[D2] competencias {} é inútil -> herda', r2.framework, FW_GLOBAL);

  const r3 = resolveFeedbackConfig([linhaGlobal, { tenant_id: T, framework: { nicho_extra: 'x' } }], T);
  eq('[D3] framework sem competencias -> herda', r3.framework, FW_GLOBAL);

  const r4 = resolveFeedbackConfig([linhaGlobal, { tenant_id: T, prompt_especialista: '   ' }], T);
  eq('[D4] prompt só com espaços -> herda', r4.promptEsp, PROMPT_GLOBAL);

  const r5 = resolveFeedbackConfig([linhaGlobal, { tenant_id: T, nicho: '' }], T);
  eq('[D5] nicho vazio -> herda', r5.nicho, 'automotivo');
}

// --- [E] framework é ATÔMICO: nunca mistura pesos das duas fontes ------------------------------------
{
  const r = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: T, framework: FW_TENANT }],
    T,
  );
  eq('[E1] usa o framework do tenant inteiro', r.framework, FW_TENANT);
  check('[E2] NENHUM peso da global vazou para a escala do tenant',
    !('conexao' in (r.framework?.competencias ?? {})) &&
    !('descoberta' in (r.framework?.competencias ?? {})) &&
    !('fechamento' in (r.framework?.competencias ?? {})),
    JSON.stringify(r.framework));
}

// --- [F] Fail-safe: ausências e dados corrompidos não derrubam a análise ------------------------------
{
  const soGlobal = resolveFeedbackConfig([linhaGlobal], T);
  eq('[F1] tenant sem linha nenhuma -> global inteira',
     [soGlobal.nicho, soGlobal.framework, soGlobal.promptEsp], ['automotivo', FW_GLOBAL, PROMPT_GLOBAL]);

  const vazio = resolveFeedbackConfig([], T);
  eq('[F2] sem nenhuma linha -> defaults seguros (igual ao comportamento antigo)',
     [vazio.nicho, vazio.framework, vazio.promptEsp], ['automotivo', {}, '']);

  const nulo = resolveFeedbackConfig(null, T);
  eq('[F3] rows null (falha de leitura) -> defaults seguros, sem crash',
     [nulo.nicho, nulo.framework, nulo.promptEsp], ['automotivo', {}, '']);

  const corrompido = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: T, framework: [1, 2, 3] as unknown as Record<string, unknown> }], T);
  eq('[F4] framework array (dado corrompido) -> herda, não quebra', corrompido.framework, FW_GLOBAL);

  const outroTenant = resolveFeedbackConfig(
    [linhaGlobal, { tenant_id: 'outro-tenant-qualquer', framework: FW_TENANT, prompt_especialista: 'x' }], T);
  eq('[F5] linha de OUTRO tenant nunca vaza', outroTenant.framework, FW_GLOBAL);
  eq('[F5b] prompt de outro tenant nunca vaza', outroTenant.promptEsp, PROMPT_GLOBAL);
}

// --- [G] Global também pode estar incompleta ---------------------------------------------------------
{
  const r = resolveFeedbackConfig(
    [{ tenant_id: null, nicho: null, framework: null, prompt_especialista: null }, { tenant_id: T }], T);
  eq('[G1] ninguém preencheu -> defaults, sem inventar',
     [r.nicho, r.framework, r.promptEsp], ['automotivo', {}, '']);
  eq('[G2] não marca como herdado o que não existia', r.herdadoDoGlobal, []);
}

// --- [H] Pureza: não muta a entrada ------------------------------------------------------------------
{
  const rows = [linhaGlobal, { tenant_id: T, framework: null, prompt_especialista: null }];
  const antes = JSON.stringify(rows);
  resolveFeedbackConfig(rows, T);
  eq('[H1] a função não muta as linhas recebidas', JSON.stringify(rows), antes);
}

console.log(`\nANALISTA config merge — ${ok} OK, ${fail} RED`);
if (fail > 0) { for (const f of fails) console.error(` - ${f}`); process.exit(1); }
