// ============================================================================
// google-calendar — integração com o Google Agenda via CONTA DE SERVIÇO (SA).
// ----------------------------------------------------------------------------
// Modelo "pega o ID e cola": o dono da agenda (ex.: logosiabrasil@gmail.com)
//   1) compartilha a agenda dele com o e-mail da conta de serviço, dando
//      permissão "Fazer alterações nos eventos";
//   2) cola o ID da agenda na aba Integrações.
// A partir daí esta lib autentica como a conta de serviço (JWT RS256 ->
// access_token) e consulta disponibilidade (freeBusy) + cria reuniões.
//
// Por que conta de serviço e não OAuth do usuário: não expira/!precisa refresh
// por usuário, não tem tela de consentimento, e o "passo a passo" é só colar o
// ID. Limitação conhecida: SA sem Domain-Wide Delegation NÃO consegue convidar
// participantes externos por e-mail — por isso NÃO adicionamos o lead como
// attendee; o link da reunião é enviado ao lead pelo WhatsApp (a Sofia faz isso)
// e o evento entra na agenda do dono (que recebe os lembretes).
//
// Segredo necessário (Supabase secret): GOOGLE_CALENDAR_SA_KEY = JSON da chave
// da conta de serviço (campos client_email + private_key). Ver doc do plano.
// ============================================================================

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface MeetingInput {
  summary: string;
  description?: string;
  startISO: string;          // ISO 8601 com offset, ex.: 2026-06-12T15:00:00-03:00
  endISO: string;
  timeZone?: string;         // default America/Sao_Paulo
  location?: string;         // ex.: link fixo da sala (Meet/Zoom)
}

export interface BusyBlock { start: string; end: string }

// --------------------------- chave / e-mail da SA --------------------------
function getServiceAccountKey(): ServiceAccountKey | null {
  const raw = (globalThis as any)?.Deno?.env?.get?.("GOOGLE_CALENDAR_SA_KEY");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.client_email && parsed?.private_key) return parsed as ServiceAccountKey;
    return null;
  } catch {
    return null;
  }
}

/** E-mail da conta de serviço (o que o dono da agenda precisa compartilhar). */
export function getServiceAccountEmail(): string | null {
  return getServiceAccountKey()?.client_email ?? null;
}

/** Se a integração de calendário está configurada na plataforma. */
export function isCalendarConfigured(): boolean {
  return getServiceAccountKey() !== null;
}

// ------------------------------ base64url ----------------------------------
function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strToB64Url(s: string): string {
  return bytesToB64Url(new TextEncoder().encode(s));
}
function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ---------------------- access token via JWT (RS256) -----------------------
let _cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const sa = getServiceAccountKey();
  if (!sa) throw new Error("Integração de Google Agenda não configurada (GOOGLE_CALENDAR_SA_KEY ausente).");

  const now = Math.floor(Date.now() / 1000);
  // Reusa token enquanto válido (margem de 60s).
  if (_cachedToken && _cachedToken.exp - 60 > now) return _cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: CALENDAR_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${bytesToB64Url(new Uint8Array(sigBuf))}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Falha ao autenticar a conta de serviço do Google.");
  }
  _cachedToken = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return data.access_token;
}

// --------------------------------- API -------------------------------------

/**
 * Verifica se a conta de serviço consegue ACESSAR a agenda informada (prova de
 * que o dono compartilhou). Faz um freeBusy de 1h como sonda — barato e seguro.
 */
export async function checkCalendarAccess(calendarId: string): Promise<{ ok: boolean; message: string }> {
  const sa = getServiceAccountKey();
  if (!sa) {
    return { ok: false, message: "A integração com o Google Agenda ainda não foi configurada pelo administrador da plataforma." };
  }
  const id = String(calendarId || "").trim();
  if (!id) return { ok: false, message: "Informe o ID da agenda (ex.: seuemail@gmail.com)." };

  try {
    const token = await getAccessToken();
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    const res = await fetch(`${CALENDAR_API}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: now.toISOString(), timeMax: end.toISOString(), items: [{ id }] }),
    });
    const data = await res.json().catch(() => ({}));
    const cal = data?.calendars?.[id];
    if (cal?.errors?.length) {
      const reason = cal.errors[0]?.reason || "sem acesso";
      return {
        ok: false,
        message: `Sem acesso à agenda (${reason}). Compartilhe a agenda "${id}" com ${sa.client_email} (permissão "Fazer alterações nos eventos") e tente de novo.`,
      };
    }
    if (res.ok && cal) {
      return { ok: true, message: `Agenda "${id}" acessível! A Sofia já pode consultar horários e marcar reuniões.` };
    }
    return { ok: false, message: data?.error?.message || `Não foi possível acessar a agenda (status ${res.status}).` };
  } catch (e: any) {
    return { ok: false, message: e?.message || "Erro ao validar a agenda." };
  }
}

/** Retorna os blocos OCUPADOS da agenda na janela informada. */
export async function getBusyBlocks(calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<BusyBlock[]> {
  const token = await getAccessToken();
  const res = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: calendarId }] }),
  });
  const data = await res.json().catch(() => ({}));
  const busy = data?.calendars?.[calendarId]?.busy;
  return Array.isArray(busy) ? busy : [];
}

/**
 * Cria a reunião na agenda. NÃO adiciona o lead como participante (limitação de
 * SA sem DWD) — o link vai pro lead via WhatsApp. O evento entra na agenda do
 * dono, que recebe os lembretes (24h e 2h antes).
 */
export async function createMeeting(calendarId: string, input: MeetingInput): Promise<{ id: string; htmlLink: string }> {
  const token = await getAccessToken();
  const tz = input.timeZone || "America/Sao_Paulo";
  const body: Record<string, any> = {
    summary: input.summary,
    description: input.description || "",
    start: { dateTime: input.startISO, timeZone: tz },
    end: { dateTime: input.endISO, timeZone: tz },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 24 * 60 },
        { method: "popup", minutes: 120 },
      ],
    },
  };
  if (input.location) body.location = input.location;

  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    throw new Error(data?.error?.message || `Falha ao criar a reunião (status ${res.status}).`);
  }
  return { id: data.id, htmlLink: data.htmlLink || "" };
}
