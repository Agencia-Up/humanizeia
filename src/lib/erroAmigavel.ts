/**
 * Tradutor central de erros → português simples.
 *
 * Problema: pela plataforma toda os `catch` mostram `error.message` cru — texto
 * técnico, quase sempre em inglês (ex.: `duplicate key value violates unique
 * constraint`, `Edge Function returned a non-2xx status code`, `JWT expired`,
 * `Failed to fetch`). O usuário não entende o motivo.
 *
 * Aqui a gente:
 *  1) extrai a mensagem REAL (inclusive de erros de edge function, onde o texto
 *     do servidor fica escondido em `error.context` — Response cru);
 *  2) classifica por código Postgres / status / padrão de texto;
 *  3) devolve um { titulo, descricao } claro em PT.
 *
 * Quando a origem já mandou uma mensagem boa em português (várias edge functions
 * fazem isso), a gente PRESERVA essa mensagem em vez de trocar por um genérico.
 *
 * Duas formas de uso:
 *   // síncrona (mais comum — só troca o texto do toast existente):
 *   } catch (err) { toast({ title: 'Erro', description: descricaoErro(err, 'adicionar lead'), variant: 'destructive' }); }
 *
 *   // assíncrona (pega a mensagem real do servidor em erro de edge function):
 *   } catch (err) { await toastErro(toast, err, 'buscar formularios'); }
 */

export interface ErroAmigavel {
  titulo: string;
  descricao: string;
}

type ToastFn = (opts: {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => unknown;

/** Lê o corpo de erro de uma edge function. O cliente Supabase encapsula o erro
 *  como Response cru em `error.context` (2.x) ou `error.context.response` (1.x);
 *  devolve a mensagem real do servidor ({ error } / { message }) ou '' se não der. */
async function lerErroEdgeFunction(error: any): Promise<string> {
  try {
    const ctx = error?.context;
    const resp = ctx && typeof ctx.text === 'function' ? ctx : ctx?.response;
    if (resp && typeof resp.text === 'function') {
      const body = await resp.text();
      try {
        const parsed = JSON.parse(body);
        return String(parsed.error || parsed.message || body || '');
      } catch {
        return String(body || '');
      }
    }
  } catch {
    /* ignora — cai no fallback */
  }
  return '';
}

/** Junta os campos do erro num único texto minúsculo pra casar padrões. */
function textoDoErro(error: any, mensagemReal: string): string {
  return [error?.code, error?.message, error?.details, error?.hint, mensagemReal]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Status HTTP, quando o erro vem de uma edge function (FunctionsHttpError). */
function statusDoErro(error: any): number | null {
  const s = error?.context?.status ?? error?.status ?? error?.context?.response?.status;
  return typeof s === 'number' ? s : null;
}

/** Heurística: a mensagem já parece feita pra humano (e em PT)? Se sim, a gente
 *  mostra ela em vez de um genérico — não enterra mensagens boas que a edge manda. */
function pareceMensagemHumana(msg: string): boolean {
  const m = (msg || '').trim();
  if (m.length < 6 || m.length > 240) return false;
  const tecnico =
    /duplicate key|constraint|syntax|non-2xx|null value|does not exist|failed to fetch|networkerror|undefined|\bnull\b|stack|cannot read|is not a function|jwt|\{".*"\}|<\/?[a-z]+>/i;
  if (tecnico.test(m)) return false;
  return /\s/.test(m); // tem cara de frase
}

/**
 * Núcleo da classificação. Recebe o texto já montado (minúsculo), o status HTTP
 * (se houver) e uma mensagem-candidata para "passthrough" quando nada casar.
 */
function classificar(
  texto: string,
  status: number | null,
  contexto: string | undefined,
  msgHumanaCandidata: string,
): ErroAmigavel {
  const acao = contexto ? ` ao ${contexto}` : '';
  const tem = (...termos: string[]) => termos.some((t) => texto.includes(t));

  // 1) Sem conexão / rede
  if (tem('failed to fetch', 'networkerror', 'load failed', 'fetch failed', 'err_internet', 'err_network', 'network request failed')) {
    return { titulo: 'Sem conexão', descricao: 'Não conseguimos falar com o servidor. Verifique sua internet e tente de novo.' };
  }

  // 2) Login (credenciais)
  if (tem('invalid login credentials')) {
    return { titulo: 'Não foi possível entrar', descricao: 'E-mail ou senha incorretos. Confira e tente de novo.' };
  }
  if (tem('email not confirmed')) {
    return { titulo: 'E-mail não confirmado', descricao: 'Confirme seu e-mail (verifique a caixa de entrada) antes de entrar.' };
  }
  if (tem('user already registered', 'already been registered')) {
    return { titulo: 'E-mail já cadastrado', descricao: 'Esse e-mail já tem conta. Tente entrar ou recuperar a senha.' };
  }

  // 3) Sessão expirada / token velho (inclui 401)
  if (status === 401 || tem('jwt', 'token invalido', 'token inválido', 'unauthorized', 'expired', 'not authenticated', 'invalid claim', 'no api key', 'invalid token')) {
    return { titulo: 'Sessão expirada', descricao: 'Sua sessão expirou. Saia e entre de novo para continuar.' };
  }

  // 4) Sem permissão (RLS / 403)
  if (status === 403 || tem('42501', 'row-level security', 'row level security', 'permission denied', 'violates row-level', 'not allowed', 'forbidden')) {
    return { titulo: 'Sem permissão', descricao: `Você não tem permissão para fazer isso${acao}. Se achar que deveria ter, fale com o administrador da conta.` };
  }

  // 5) Registro duplicado
  if (tem('23505', 'duplicate key', 'unique constraint', 'already exists', 'ja existe', 'já existe')) {
    const ehLead = /lead/i.test(contexto || '') || texto.includes('ai_crm_leads') || texto.includes('crm_leads');
    return {
      titulo: 'Já existe',
      descricao: ehLead
        ? 'Esse lead já está no CRM (mesmo telefone). Procure por ele na lista em vez de cadastrar de novo.'
        : 'Esse registro já existe. Procure por ele na lista em vez de cadastrar de novo.',
    };
  }

  // 6) Chave estrangeira (item relacionado)
  if (tem('23503', 'foreign key', 'violates foreign key')) {
    return { titulo: 'Item relacionado', descricao: 'Existe um item ligado a este que impede a ação. Remova ou ajuste o vínculo antes de continuar.' };
  }

  // 7) Campo obrigatório faltando
  if (tem('23502', 'null value', 'violates not-null', 'not-null constraint')) {
    return { titulo: 'Falta preencher', descricao: 'Falta preencher um campo obrigatório. Revise o formulário e tente de novo.' };
  }

  // 8) Valor não permitido (check) / formato inválido
  if (tem('23514', 'check constraint', 'violates check')) {
    return { titulo: 'Valor não permitido', descricao: 'Um dos campos está com um valor que não é aceito. Revise os dados e tente de novo.' };
  }
  if (tem('22p02', 'invalid input syntax', 'invalid input value', 'invalid text representation')) {
    return { titulo: 'Formato inválido', descricao: 'Algum valor está num formato inválido (ex.: número, data ou e-mail). Revise e tente de novo.' };
  }

  // 9) Não encontrado
  if (tem('pgrst116', 'no rows', '0 rows', 'results contain 0 rows', 'not found', 'schema cache')) {
    return { titulo: 'Não encontrado', descricao: 'Não encontramos esse registro. Ele pode ter sido removido ou ainda não estar disponível.' };
  }

  // 10) Limite do plano / créditos
  if (tem('quota', 'rate limit', 'too many requests', 'insufficient', 'limite', 'créditos', 'creditos', 'plan limit', 'exceeded')) {
    return { titulo: 'Limite atingido', descricao: 'Você atingiu um limite do seu plano. Aguarde um pouco ou faça upgrade para continuar.' };
  }

  // Fallback: se a origem já mandou uma mensagem boa (em PT), mostra ela.
  if (pareceMensagemHumana(msgHumanaCandidata)) {
    return { titulo: `Não foi possível concluir${acao}`, descricao: msgHumanaCandidata.trim() };
  }

  // Genérico (a mensagem técnica vai pro console, não some).
  return {
    titulo: 'Algo deu errado',
    descricao: `Não foi possível concluir${acao} agora. Tente de novo em instantes; se continuar, fale com o suporte.`,
  };
}

/**
 * Versão SÍNCRONA — classifica pelos campos já disponíveis (code/message/status).
 * Use para trocar o texto de um toast existente sem mexer na estrutura.
 * (Não lê o corpo de erro de edge function; para isso, use `erroAmigavel`/`toastErro`.)
 */
export function erroAmigavelSync(error: any, contexto?: string): ErroAmigavel {
  return classificar(textoDoErro(error, ''), statusDoErro(error), contexto, String(error?.message || ''));
}

/** Atalho síncrono que devolve só a descrição (pro `description:` do toast). */
export function descricaoErro(error: any, contexto?: string): string {
  return erroAmigavelSync(error, contexto).descricao;
}

/**
 * Versão ASSÍNCRONA — pega também a mensagem real do servidor quando o erro vem
 * de uma edge function (`supabase.functions.invoke`).
 */
export async function erroAmigavel(error: any, contexto?: string): Promise<ErroAmigavel> {
  const mensagemReal = await lerErroEdgeFunction(error);
  const candidata = mensagemReal || String(error?.message || '');
  return classificar(textoDoErro(error, mensagemReal), statusDoErro(error), contexto, candidata);
}

/**
 * Mostra o erro como toast em português. Sempre loga o erro original no console
 * (pra suporte/debug) — a mensagem técnica não some, só deixa de aparecer pro usuário.
 */
export async function toastErro(toast: ToastFn, error: any, contexto?: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.error('[erro]', contexto ? `(${contexto})` : '', error);
  const { titulo, descricao } = await erroAmigavel(error, contexto);
  toast({ title: titulo, description: descricao, variant: 'destructive' });
}

/** Detecta erro de registro duplicado (Postgres 23505). Reaproveitável em fluxos
 *  que tratam duplicado de forma especial (ex.: "regularizar" lead existente). */
export function ehErroDuplicado(error: any): boolean {
  const texto = textoDoErro(error, '');
  return (
    texto.includes('23505') ||
    texto.includes('duplicate key') ||
    texto.includes('unique constraint') ||
    texto.includes('already exists')
  );
}
