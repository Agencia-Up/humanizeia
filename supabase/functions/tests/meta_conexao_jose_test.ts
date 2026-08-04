/**
 * meta_conexao_jose_test.ts
 *
 * Cobre os 14 cenarios exigidos para a integracao Meta do Jose.
 * Os que dependem do banco (5,6,7,10) sao provados na bateria transacional SQL;
 * aqui ficam os que vivem no codigo das edges.
 *
 * Nenhuma assercao depende de estado de producao: o que se testa e a DECISAO.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const raiz = new URL("../", import.meta.url);
const ler = (p: string) => Deno.readTextFile(new URL(p, raiz));

/**
 * Remove comentarios antes de asserir AUSENCIA de padrao.
 * Sem isto, um comentario explicando "antes isto era order(created_at).limit(1)"
 * derruba o proprio teste que documenta a correcao.
 */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s+\/\/.*$/gm, " ");

// ── Copias fieis das funcoes de decisao (T0 prova que nao divergiram) ───────

function sanitizar(msg: unknown): string | null {
  if (!msg) return null;
  return String(msg)
    .replace(/EAA[A-Za-z0-9]{20,}/g, "<TOKEN>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <TOKEN>")
    .slice(0, 300);
}

/** Classificacao do health-check, identica a do edge. */
function classificar(status: number, corpo: any): string {
  if (status === 200 && corpo?.id) return "connected";
  const code = corpo?.error?.code ?? null;
  return Number(code) === 190 ? "expired" : "reconnect_required";
}

const TOKEN_FALSO = "EAABwzLixnjYBO7ZCxxxxxxxxxxxxxxxxxxxxxxxxxxZD";

// ── 1) TOKEN VALIDO -> CONECTADO ───────────────────────────────────────────

Deno.test("1 - Graph 200 na conta selecionada => connected", () => {
  const corpo = { id: "act_648790974474217", name: "CA 04 - Icom Motors",
                  account_status: 1, currency: "BRL", timezone_name: "America/Sao_Paulo" };
  assertEquals(classificar(200, corpo), "connected");
});

// ── 2) OAUTH 190/460 -> EXPIRADO ───────────────────────────────────────────

Deno.test("2 - OAuthException 190 subcode 460 => expired (nunca connected)", () => {
  const corpo = { error: { message: "Error validating access token: The session has been invalidated...",
                           type: "OAuthException", code: 190, error_subcode: 460 } };
  assertEquals(classificar(401, corpo), "expired");
  assert(classificar(401, corpo) !== "connected");
});

Deno.test("2b - outro erro de auth => reconnect_required, nao expired", () => {
  assertEquals(classificar(403, { error: { code: 200, message: "permissao insuficiente" } }),
               "reconnect_required");
});

// ── 3) LINHA NO BANCO NAO E PROVA DE CONEXAO ───────────────────────────────

Deno.test("3 - conta antiga com token invalido nao pode aparecer conectada", async () => {
  const src = await ler("meta-connection-health/index.ts");
  // O estado NUNCA sai de is_active: sai da resposta da Meta.
  assert(!/is_active[\s\S]{0,120}connected/.test(src),
    "o health nao pode derivar 'connected' de is_active");
  assertStringIncludes(src, 'Number(code) === 190 ? "expired"');

  // E o selo do front tem que vir do servidor, nao de haver linha.
  const hook = await Deno.readTextFile(new URL("../../src/hooks/useMetaConnection.ts", raiz));
  assertStringIncludes(hook, "get_jose_selected_account");
  assert(!/setConnectedAccount\((?:savedAccount\s*\?\?\s*)?\(?data\[0\]/.test(hook),
    "o fallback data[0] voltou ao hook");
});

// ── 4) RECONEXAO VALIDA ATUALIZA TOKEN E TIMESTAMP ─────────────────────────

Deno.test("4 - callback renova credencial das contas ja integradas (nao so a sessao)", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  assertStringIncludes(src, "refreshIntegratedAccounts");
  // e chamado DENTRO do callback
  const trecho = src.slice(src.indexOf("async function handleGetCallback"),
                           src.indexOf("async function handlePostCallback"));
  assertStringIncludes(trecho, "refreshIntegratedAccounts(");
  assertStringIncludes(trecho, "upsertConnection(");

  const fn = src.slice(src.indexOf("async function refreshIntegratedAccounts"),
                       src.indexOf("async function saveAdAccount"));
  assertStringIncludes(fn, "last_sync_at");
  assertStringIncludes(fn, "updated_at");
  assertStringIncludes(fn, '.eq("user_id", userId)');   // isolamento
  assertStringIncludes(fn, '.eq("is_active", true)');   // so o que ja era integrado
});

Deno.test("4b - o callback NAO integra conta nova sozinho", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const fn = src.slice(src.indexOf("async function refreshIntegratedAccounts"),
                       src.indexOf("async function saveAdAccount"));
  assert(!/\.insert\(|\.upsert\(/.test(fn),
    "renovar credencial nao pode inserir conta nova (isso e save_selected)");
});

// ── 8/9) O RUNNER USA SO A CONTA SELECIONADA ───────────────────────────────

Deno.test("8 - jose-cron-runner le selected_ad_account_id por id exato", async () => {
  const src = await ler("jose-cron-runner/index.ts");
  assertStringIncludes(src, "config.selected_ad_account_id");
  const trecho = src.slice(src.indexOf("A CONTA E A QUE O DONO SELECIONOU"),
                           src.indexOf("const faltando"));
  assertStringIncludes(trecho, '.eq("id", config.selected_ad_account_id)');
  assertStringIncludes(trecho, '.eq("user_id", config.user_id)');
  assertStringIncludes(trecho, ".single()");
});

Deno.test("9 - sem selecao o runner NAO escolhe outra conta", async () => {
  const src = await ler("jose-cron-runner/index.ts");
  const bruto = src.slice(src.indexOf("A CONTA E A QUE O DONO SELECIONOU"),
                          src.indexOf("const faltando"));
  // Assercao de AUSENCIA olha so o codigo: o comentario cita o padrao antigo
  // de proposito, para registrar o que foi removido.
  const trecho = semComentarios(bruto);
  assert(!/order\(["']created_at/.test(trecho), "voltou a ordenar por created_at");
  assert(!/\.limit\(1\)/.test(trecho), "voltou a usar limit(1)");
  assert(!/contas\s*\|\|\s*\[\]\)\[0\]/.test(trecho), "voltou a indexar [0]");
  assertStringIncludes(bruto, "conta_do_jose_nao_selecionada");
});

Deno.test("9b - credencial doente bloqueia, nao troca de conta", async () => {
  const src = await ler("jose-cron-runner/index.ts");
  const trecho = src.slice(src.indexOf("A CONTA E A QUE O DONO SELECIONOU"),
                           src.indexOf("const faltando"));
  assertStringIncludes(trecho, 'saude !== "connected"');
  assertStringIncludes(trecho, "credencial_");
});

// ── 11) CALLBACK REPETIDO / SESSAO REUSADA ─────────────────────────────────

Deno.test("11 - sessao consumida nao pode ser reutilizada", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const consume = src.slice(src.indexOf("async function handleConsumeSession"),
                            src.indexOf("async function handlePost(req"));
  assertStringIncludes(consume, "sessao_ja_consumida");
  assertStringIncludes(consume, "data.consumed_at");

  // O consumo em si vive na RPC transacional (SQL), nao mais no edge.
  const sql = await Deno.readTextFile(
    new URL("../migrations/20260804130000_meta_oauth_consumo_atomico.sql", raiz));
  assertStringIncludes(sql, "FOR UPDATE");
  assertStringIncludes(sql, "v_sess.consumed_at IS NOT NULL");
  assertStringIncludes(sql, "'sessao_ja_consumida'");
  // consumo condicional: fecha a corrida mesmo com dois vencedores aparentes
  assertStringIncludes(sql, "WHERE id = p_session_id AND consumed_at IS NULL");
  assertStringIncludes(sql, "sessao_consumida_em_paralelo");
  // e o edge traduz replay para 409
  const save = src.slice(src.indexOf("async function handleSaveSelected"),
                         src.indexOf("async function handleConsumeSession"));
  assertStringIncludes(save, '"sessao_ja_consumida" ? 409');
});

// ── 12) FALHA PARCIAL NUNCA E ok:true ──────────────────────────────────────

Deno.test("12 - falha parcial e impossivel: tudo roda numa transacao", async () => {
  const sql = await Deno.readTextFile(
    new URL("../migrations/20260804130000_meta_oauth_consumo_atomico.sql", raiz));
  // Sem bloco EXCEPTION: qualquer erro reverte credencial, contas e selecao.
  assert(!/EXCEPTION\s+WHEN/.test(sql.slice(sql.indexOf("AS $$"))),
    "a RPC nao pode capturar excecao: falha tem que reverter tudo");
  assertStringIncludes(sql, "RAISE EXCEPTION 'conta_do_jose_nao_persistida'");

  // E o edge so devolve ok:true quando a RPC devolveu ok:true.
  const src = await ler("_shared/meta-oauth.ts");
  const save = src.slice(src.indexOf("async function handleSaveSelected"),
                         src.indexOf("async function handleConsumeSession"));
  assertStringIncludes(save, "if (!res?.ok)");
  assert(save.indexOf("if (!res?.ok)") < save.lastIndexOf("ok: true"),
    "o retorno de sucesso precisa vir depois do guard");
});

Deno.test("12b - conta/pixel/pagina fora da sessao OAuth sao recusados", async () => {
  const sql = await Deno.readTextFile(
    new URL("../migrations/20260804130000_meta_oauth_consumo_atomico.sql", raiz));
  for (const erro of ["conta_fora_da_sessao_oauth", "pixel_fora_da_sessao_oauth",
                      "pagina_fora_da_sessao_oauth"]) {
    assertStringIncludes(sql, erro);
  }
  // e o tenant e sempre o autenticado, nunca o do payload
  assertStringIncludes(sql, "v_sess.user_id <> v_caller");
  assertStringIncludes(sql, "'sessao_de_outro_usuario'");
});

// ── 13) TOKEN NUNCA NO FRONTEND NEM EM LOG ─────────────────────────────────

Deno.test("13 - consume_session nao devolve access_token", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const consume = src.slice(src.indexOf("async function handleConsumeSession"),
                            src.indexOf("async function handlePost(req"));
  assert(!/token:\s*data\.access_token_encrypted/.test(consume),
    "consume_session voltou a devolver o token cru");
  assert(!/select\("\*"\)/.test(consume), "nao selecionar * (traria o token)");
});

Deno.test("13b - save_selected recusa credencial real vinda do navegador", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  // Aceita o uuid da sessao (referencia), recusa qualquer coisa que nao seja uuid
  // (isto e, uma credencial de verdade).
  assertStringIncludes(src, "if (legado && !UUID_RE.test(legado))");
  assertStringIncludes(src, "access_token_nao_aceito_do_frontend");
  // e consume_session devolve o ID da sessao, nao o token
  assertStringIncludes(src, "token: data.id");
  const consume = src.slice(src.indexOf("async function handleConsumeSession"),
                            src.indexOf("async function handlePost(req"));
  assert(!/token:\s*data\.access_token_encrypted/.test(consume), "voltou a devolver o token cru");
});

Deno.test("13c - o front nao guarda nem envia token", async () => {
  const hook = await Deno.readTextFile(new URL("../../src/hooks/useMetaConnection.ts", raiz));
  assert(!/pendingToken/.test(hook), "pendingToken (token no estado do React) voltou");
  assert(!/access_token:\s*pending/.test(hook), "o front voltou a enviar token");
  assertStringIncludes(hook, "session_id: pendingSessionId");
});

Deno.test("13d - sanitizador remove credencial de qualquer mensagem", () => {
  assertEquals(sanitizar(`falhou com ${TOKEN_FALSO} no header`), "falhou com <TOKEN> no header");
  assertEquals(sanitizar(`Authorization: Bearer ${TOKEN_FALSO}`), "Authorization: Bearer <TOKEN>");
  assertEquals(sanitizar(null), null);
});

Deno.test("13e - health-check nunca devolve o token na resposta", async () => {
  const src = await ler("meta-connection-health/index.ts");
  const respostas = [...src.matchAll(/return json\(\{[\s\S]{0,400}?\}, \d+\)/g)].map((m) => m[0]);
  assert(respostas.length >= 4, "esperadas varias respostas");
  for (const r of respostas) {
    assert(!/access_token/.test(r), `resposta expoe token: ${r.slice(0, 80)}`);
  }
});

// ── 14) ERRO DO GRAPH/APOLLO PRESERVADO E SANITIZADO ───────────────────────

Deno.test("14 - health persiste code/subcode do Graph", async () => {
  const src = await ler("meta-connection-health/index.ts");
  assertStringIncludes(src, "last_error_code: code");
  assertStringIncludes(src, "last_error_subcode: subcode");
  assertStringIncludes(src, "sanitizar(err?.message)");
});

Deno.test("14b - cron nao guarda apenas http_500", async () => {
  const src = await ler("jose-cron-runner/index.ts");
  assertStringIncludes(src, "credencial_expirada:190");
  assertStringIncludes(src, "sanitizar");
  // o motivo passou a carregar o detalhe
  assert(/http_\$\{response\.status\}:\$\{detalhe\}/.test(src),
    "o motivo precisa incluir o detalhe do corpo");
  // 190 nao fica em retry cego
  assertStringIncludes(src, "podeRepetir = tentativa < MAX_ATTEMPTS && !credencialMorta");
});

// ── T0: as copias acima nao divergiram do codigo real ──────────────────────

Deno.test("T0 - sanitizador do teste e identico ao das duas edges", async () => {
  const health = await ler("meta-connection-health/index.ts");
  const cron = await ler("jose-cron-runner/index.ts");
  for (const src of [health, cron]) {
    assertStringIncludes(src, 'replace(/EAA[A-Za-z0-9]{20,}/g, "<TOKEN>")');
    assertStringIncludes(src, 'replace(/Bearer\\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <TOKEN>")');
  }
});

// ── 15) CONSUMO ATOMICO E BLOQUEIO DAS ENTRADAS INSEGURAS ──────────────────

Deno.test("15 - save_selected delega para a RPC transacional", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const save = src.slice(src.indexOf("async function handleSaveSelected"),
                         src.indexOf("async function handleConsumeSession"));
  assertStringIncludes(save, 'rpc("consume_meta_oauth_session"');
  // com o JWT do chamador (auth.uid resolve o tenant), nunca com service role
  assertStringIncludes(save, "userClient(req)");
  assert(!/adminClient\(\)[\s\S]{0,200}consume_meta_oauth_session/.test(save),
    "a RPC nao pode ser chamada com service_role (perderia o tenant)");
  // replay vira 409
  assertStringIncludes(save, '"sessao_ja_consumida" ? 409');
});

Deno.test("15b - nao restaram upserts soltos em save_selected", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const save = semComentarios(src.slice(src.indexOf("async function handleSaveSelected"),
                                        src.indexOf("async function handleConsumeSession")));
  assert(!/from\("ad_accounts"\)[\s\S]{0,80}\.upsert\(/.test(save), "upsert solto de ad_accounts");
  assert(!/from\("meta_pixels"\)/.test(save), "upsert solto de meta_pixels");
  assert(!/from\("meta_pages"\)/.test(save), "upsert solto de meta_pages");
});

Deno.test("16 - connect_with_token e save_account exigem service_role", async () => {
  const src = await ler("_shared/meta-oauth.ts");
  const rota = src.slice(src.indexOf("switch (action)"), src.indexOf("default:"));
  const casos = rota.split("case ").filter((c) =>
    c.startsWith('"connect_with_token"') || c.startsWith('"save_account"'));
  assertEquals(casos.length, 2);
  for (const c of casos) {
    assertStringIncludes(c, "isServiceRole(req)");
    assertStringIncludes(c, "acao_restrita_ao_service_role");
  }
  // credencial de verdade vinda do navegador continua recusada em save_selected
  assertStringIncludes(src, "legado && !UUID_RE.test(legado)");
  assertStringIncludes(src, "access_token_nao_aceito_do_frontend");
  // comparacao em tempo constante
  assertStringIncludes(src, "diff |= chave.charCodeAt(i) ^ bearer.charCodeAt(i)");
});

Deno.test("17 - allowlist de implantacao gradual existe e nao chuta conta", async () => {
  const src = await ler("jose-cron-runner/index.ts");
  assertStringIncludes(src, "JOSE_EXACT_ACCOUNT_ENFORCEMENT_TENANT_IDS");
  assertStringIncludes(src, "ENFORCE_EXACT_ACCOUNT.has(config.user_id)");
  const bloco = semComentarios(src.slice(src.indexOf("const rigoroso"),
                                         src.indexOf("const faltando")));
  // fora da allowlist so segue com UMA conta ativa — nunca escolhendo entre varias
  assertStringIncludes(bloco, "length === 1");
  assertStringIncludes(bloco, "selecao_obrigatoria");
  assert(!/order\(["']created_at/.test(bloco), "voltou a ordenar por created_at");
  assert(!/\.limit\(1\)/.test(bloco), "voltou a usar limit(1)");
});
