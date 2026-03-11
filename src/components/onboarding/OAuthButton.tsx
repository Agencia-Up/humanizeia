import { Loader2, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OAuthButtonProps {
  platform: 'meta' | 'google';
  status: 'disconnected' | 'connecting' | 'connected';
  onClick: () => void;
  disabled?: boolean;
}

const platformConfig = {
  meta: {
    label: 'Conectar com Facebook',
    connectedLabel: 'Facebook conectado',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    bgClass: 'bg-[#1877F2] hover:bg-[#166FE5]',
  },
  google: {
    label: 'Conectar com Google',
    connectedLabel: 'Google conectado',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    ),
    bgClass: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300',
  },
};

export function OAuthButton({ platform, status, onClick, disabled }: OAuthButtonProps) {
  const config = platformConfig[platform];

  return (
    <Button
      onClick={onClick}
      disabled={disabled || status === 'connecting' || status === 'connected'}
      className={cn(
        'relative h-12 w-full gap-3 text-base font-medium transition-all duration-300',
        status === 'connected'
          ? 'bg-success/20 text-success border border-success/30 hover:bg-success/20'
          : platform === 'google'
            ? config.bgClass
            : `${config.bgClass} text-white`,
      )}
    >
      {status === 'connecting' ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : status === 'connected' ? (
        <Check className="h-5 w-5" />
      ) : (
        config.icon
      )}
      <span>
        {status === 'connecting'
          ? 'Conectando...'
          : status === 'connected'
            ? `✅ ${config.connectedLabel}`
            : config.label}
      </span>
      {status === 'disconnected' && (
        <ExternalLink className="absolute right-4 h-4 w-4 opacity-50" />
      )}
    </Button>
  );
}
