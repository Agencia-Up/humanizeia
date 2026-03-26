import { useState, useEffect, useCallback } from 'react';
import Joyride, {
  CallBackProps,
  STATUS,
  Step,
  ACTIONS,
  EVENTS,
  TooltipRenderProps,
} from 'react-joyride';
import { useAppStore } from '@/store/appStore';

const TOUR_STORAGE_KEY = 'logosia-tour-completed';

// ─────────────────────────────────────────────────────────────
// Tour Steps
// ─────────────────────────────────────────────────────────────

const tourSteps: Step[] = [
  // 1 — Welcome
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🚀',
      title: 'Bem-vindo ao LogosIA!',
      body: 'A plataforma de marketing autônomo movida por Inteligência Artificial. Aqui, uma equipe de agentes IA trabalha 24h para otimizar suas campanhas, criar designs, gerenciar leads e muito mais.',
      tip: 'Este tour leva menos de 2 minutos. Vamos conhecer tudo!',
    },
  },
  // 2 — Sidebar overview
  {
    target: '[data-tour="sidebar-agents"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '📋',
      title: 'Navegação — Equipe Salomão',
      body: 'No menu lateral você encontra todos os agentes IA da sua equipe e as ferramentas da plataforma. Cada agente é especialista em uma área do marketing digital.',
      tip: 'Clique nos grupos para expandir ou recolher as seções.',
    },
  },
  // 3 — SALOMÃO
  {
    target: '[data-tour="sidebar-agents"] a[href="/salomao"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '👑',
      title: 'SALOMÃO — Orquestrador',
      body: 'Salomão é o líder da equipe. Ele coordena todos os outros agentes, distribui tarefas e garante que sua estratégia de marketing funcione como um todo integrado.',
      tip: 'Comece por aqui para ter uma visão geral de toda a operação.',
    },
  },
  // 4 — JOSÉ
  {
    target: '[data-tour="sidebar-agents"] a[href="/apollo"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🎯',
      title: 'JOSÉ — Tráfego Pago',
      body: 'José é seu gestor de tráfego autônomo. Ele analisa campanhas Meta Ads em tempo real, identifica oportunidades de otimização e sugere ajustes de orçamento, público e criativos.',
      tip: 'Conecte sua conta Meta Ads para desbloquear todo o potencial do José.',
    },
  },
  // 5 — MARIA
  {
    target: '[data-tour="sidebar-agents"] a[href="/creative-studio"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🎨',
      title: 'MARIA — Design Criativo',
      body: 'Maria é sua designer IA. Ela cria banners, posts para redes sociais, carrosséis e anúncios visuais usando inteligência artificial generativa — tudo na identidade visual da sua marca.',
      tip: 'Experimente gerar um criativo agora! Basta descrever o que precisa.',
    },
  },
  // 6 — MARCOS
  {
    target: '[data-tour="sidebar-agents"] a[href="/leads"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '👥',
      title: 'MARCOS — Gestão de Leads',
      body: 'Marcos cuida do seu CRM inteligente. Ele organiza leads, acompanha o funil de vendas, qualifica contatos automaticamente e ajuda a converter mais oportunidades em clientes.',
      tip: 'Importe seus contatos ou conecte formulários para começar.',
    },
  },
  // 7 — Dashboard KPIs
  {
    target: '[data-tour="kpi-cards"]',
    placement: 'bottom',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '📊',
      title: 'Painel de Métricas',
      body: 'Acompanhe suas métricas mais importantes em tempo real: investimento, conversões, custo por lead, ROAS e muito mais. Todos os dados são atualizados automaticamente.',
      tip: 'Passe o mouse sobre cada card para ver explicações detalhadas.',
    },
  },
  // 8 — WhatsApp
  {
    target: 'a[href="/whatsapp/instances"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '💬',
      title: 'WhatsApp Business',
      body: 'Gerencie múltiplas instâncias de WhatsApp, envie disparos em massa, configure automações e chatbots com IA. Tudo integrado ao seu CRM e campanhas.',
      tip: 'Conecte seu WhatsApp escaneando o QR Code na seção Instâncias.',
    },
  },
  // 9 — Integrations
  {
    target: 'a[href="/integrations"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🔗',
      title: 'Integrações & Conexões',
      body: 'Conecte suas contas do Meta Ads, Google Ads, WhatsApp Business e outras ferramentas. As integrações alimentam os agentes IA com dados reais para otimizações mais inteligentes.',
      tip: 'Quanto mais integrações ativas, mais inteligente a plataforma fica!',
    },
  },
  // 10 — Dark mode
  {
    target: '[data-tour="dark-mode"]',
    placement: 'top',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🌙',
      title: 'Modo Escuro / Claro',
      body: 'Alterne entre o tema claro e escuro conforme sua preferência. O modo escuro é ideal para trabalhar à noite sem cansar a vista.',
      tip: 'Sua preferência de tema é salva automaticamente.',
    },
  },
  // 11 — Settings
  {
    target: 'a[href="/settings"]',
    placement: 'right',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '⚙️',
      title: 'Configurações',
      body: 'Gerencie suas credenciais, tokens de API, preferências de notificação e personalize a plataforma de acordo com suas necessidades.',
      tip: 'Configure seus tokens de API aqui para ativar as integrações.',
    },
  },
  // 12 — Congratulations
  {
    target: 'body',
    placement: 'center',
    disableBeacon: true,
    content: '',
    data: {
      emoji: '🎉',
      title: 'Tudo pronto!',
      body: 'Você agora conhece os principais recursos do LogosIA. Sua equipe de agentes IA está pronta para transformar seu marketing digital. Explore cada seção e veja a mágica acontecer!',
      tip: 'Dica: você pode refazer este tour a qualquer momento nas configurações.',
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Custom Tooltip Component
// ─────────────────────────────────────────────────────────────

function CustomTooltip({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
  size,
  isLastStep,
}: TooltipRenderProps) {
  const data = (step as Step & { data?: Record<string, string> }).data;
  const emoji = data?.emoji || '✨';
  const title = data?.title || '';
  const body = data?.body || (typeof step.content === 'string' ? step.content : '');
  const tip = data?.tip || '';
  const stepNumber = index + 1;
  const totalSteps = size;
  const isFirst = index === 0;
  const isLast = isLastStep;
  const isCentered = step.placement === 'center';

  return (
    <div
      {...tooltipProps}
      style={{
        width: isCentered ? 480 : 420,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(26, 35, 126, 0.35), 0 0 0 1px rgba(26, 35, 126, 0.1)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        animation: 'tourFadeIn 0.3s ease-out',
      }}
    >
      {/* Gradient Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1A237E 0%, #283593 50%, #1A237E 100%)',
          padding: isCentered ? '28px 24px' : '18px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, #FFD700, #FFA000, #FFD700)',
          }}
        />
        <span style={{ fontSize: isCentered ? 36 : 28, lineHeight: 1 }}>{emoji}</span>
        <div style={{ flex: 1 }}>
          <h3
            style={{
              margin: 0,
              color: '#FFFFFF',
              fontSize: isCentered ? 20 : 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              lineHeight: 1.3,
            }}
          >
            {title}
          </h3>
          {!isCentered && (
            <span
              style={{
                color: 'rgba(255, 215, 0, 0.85)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Passo {stepNumber} de {totalSteps}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          padding: '20px 24px 8px',
          backgroundColor: '#FFFFFF',
        }}
      >
        <p
          style={{
            margin: 0,
            color: '#1a1a2e',
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          {body}
        </p>

        {/* Tip box */}
        {tip && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 14px',
              borderRadius: 10,
              backgroundColor: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>💡</span>
            <p
              style={{
                margin: 0,
                color: '#6B5900',
                fontSize: 12.5,
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              {tip}
            </p>
          </div>
        )}

        {/* Center step counter for welcome/final */}
        {isCentered && (
          <div
            style={{
              marginTop: 16,
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Passo {stepNumber} de {totalSteps}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          backgroundColor: '#E8EAF6',
          margin: '0 24px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${(stepNumber / totalSteps) * 100}%`,
            background: 'linear-gradient(90deg, #1A237E, #3949AB)',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Footer / Buttons */}
      <div
        style={{
          padding: '14px 24px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#FFFFFF',
        }}
      >
        {/* Skip */}
        <button
          {...skipProps}
          style={{
            background: 'none',
            border: 'none',
            color: '#9ca3af',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 6,
            transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#6b7280')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
        >
          Pular tour
        </button>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Back */}
          {index > 0 && (
            <button
              {...backProps}
              style={{
                background: 'none',
                border: '1px solid #E8EAF6',
                color: '#1A237E',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '8px 16px',
                borderRadius: 10,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#E8EAF6';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              ← Anterior
            </button>
          )}

          {/* Next / Start / Finish */}
          {continuous && (
            <button
              {...primaryProps}
              style={{
                background: isLast
                  ? 'linear-gradient(135deg, #FFD700 0%, #FFA000 100%)'
                  : isFirst
                    ? 'linear-gradient(135deg, #1A237E 0%, #3949AB 100%)'
                    : 'linear-gradient(135deg, #1A237E 0%, #3949AB 100%)',
                border: 'none',
                color: isLast ? '#1A237E' : '#FFFFFF',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '8px 22px',
                borderRadius: 10,
                boxShadow: isLast
                  ? '0 4px 14px rgba(255, 215, 0, 0.4)'
                  : '0 4px 14px rgba(26, 35, 126, 0.3)',
                transition: 'all 0.2s',
                transform: 'translateY(0)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = isLast
                  ? '0 6px 20px rgba(255, 215, 0, 0.5)'
                  : '0 6px 20px rgba(26, 35, 126, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = isLast
                  ? '0 4px 14px rgba(255, 215, 0, 0.4)'
                  : '0 4px 14px rgba(26, 35, 126, 0.3)';
              }}
            >
              {isFirst ? 'Começar Tour →' : isLast ? 'Finalizar 🎉' : 'Próximo →'}
            </button>
          )}

          {/* Close button for non-continuous (shouldn't happen, but fallback) */}
          {!continuous && (
            <button
              {...closeProps}
              style={{
                background: 'linear-gradient(135deg, #1A237E 0%, #3949AB 100%)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '8px 22px',
                borderRadius: 10,
              }}
            >
              Fechar
            </button>
          )}
        </div>
      </div>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes tourFadeIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Joyride styles (minimal — most styling is in CustomTooltip)
// ─────────────────────────────────────────────────────────────

const joyrideStyles = {
  options: {
    primaryColor: '#1A237E',
    zIndex: 99999,
    overlayColor: 'rgba(10, 10, 30, 0.65)',
  },
  spotlight: {
    borderRadius: 12,
    boxShadow: '0 0 0 4px rgba(255, 215, 0, 0.3)',
  },
  beacon: {
    display: 'none' as const,
  },
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export function ProductTour() {
  const { showProductTour, setShowProductTour } = useAppStore();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Auto-start tour on first visit — DISABLED
  // useEffect(() => {
  //   const completed = localStorage.getItem(TOUR_STORAGE_KEY);
  //   if (!completed) {
  //     const timer = setTimeout(() => {
  //       setRun(true);
  //       setStepIndex(0);
  //     }, 1200);
  //     return () => clearTimeout(timer);
  //   }
  // }, []);

  // Listen for manual restart from store
  useEffect(() => {
    if (showProductTour) {
      setStepIndex(0);
      setRun(true);
    }
  }, [showProductTour]);

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, index, type } = data;
      const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

      if (finishedStatuses.includes(status)) {
        setRun(false);
        setStepIndex(0);
        localStorage.setItem(TOUR_STORAGE_KEY, 'true');
        setShowProductTour(false);
      } else if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        setStepIndex(nextIndex);
      }
    },
    [setShowProductTour]
  );

  return (
    <Joyride
      steps={tourSteps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showSkipButton
      showProgress
      scrollToFirstStep
      disableOverlayClose
      disableScrolling={false}
      spotlightClicks
      callback={handleCallback}
      styles={joyrideStyles}
      tooltipComponent={CustomTooltip}
      floaterProps={{
        disableAnimation: false,
        styles: {
          floater: {
            filter: 'drop-shadow(0 4px 20px rgba(26, 35, 126, 0.15))',
          },
        },
      }}
    />
  );
}
