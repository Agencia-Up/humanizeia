import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { supabaseRpc } from '@/lib/supabaseRpc';

const DEVICE_ID_KEY = 'logosia:audit-device-id';
let lastRegisteredSession = '';

function stableDeviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const created = typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return `ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function browserName(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Google Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Navegador desconhecido';
}

function operatingSystem(ua: string, platform: string): string {
  if (/Windows NT 10/i.test(ua)) return 'Windows 10/11';
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS/iPadOS';
  if (/Mac OS X/i.test(ua) || /Mac/i.test(platform)) return 'macOS';
  if (/Linux/i.test(ua) || /Linux/i.test(platform)) return 'Linux';
  return platform || 'Sistema desconhecido';
}

async function register(session: Session | null) {
  if (!session?.user) {
    lastRegisteredSession = '';
    return;
  }

  const marker = `${session.user.id}:${session.user.last_sign_in_at || session.expires_at || 'active'}`;
  if (lastRegisteredSession === marker) return;
  lastRegisteredSession = marker;

  const ua = navigator.userAgent || '';
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { platform?: string; brands?: Array<{ brand: string; version: string }> };
  }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || '';
  const browser = browserName(ua);
  const os = operatingSystem(ua, platform);

  const { error } = await supabaseRpc<string>('register_agent_audit_device_session', {
    p_device_id: stableDeviceId(),
    p_device_label: `${os} · ${browser}`,
    p_browser_name: browser,
    p_operating_system: os,
    p_user_agent: ua,
    p_platform: platform,
    p_language: navigator.language || null,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    p_screen_info: {
      width: window.screen?.width ?? null,
      height: window.screen?.height ?? null,
      pixelRatio: window.devicePixelRatio || 1,
    },
  });

  // A auditoria nao pode impedir login/navegacao durante uma implantacao em que
  // o frontend chegou antes da migration. Uma proxima sessao tenta novamente.
  if (error) {
    lastRegisteredSession = '';
    console.debug('[agent-audit] dispositivo ainda nao registrado:', error.message);
  }
}

/**
 * Registra metadados tecnicos da sessao autenticada para atribuir alteracoes.
 * Navegadores nao fornecem hostname nem usuario do Windows; por isso usamos ator
 * autenticado + IP + identificador persistente + SO/navegador.
 */
export default function AuditDeviceRegistrar() {
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) void register(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) void register(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
