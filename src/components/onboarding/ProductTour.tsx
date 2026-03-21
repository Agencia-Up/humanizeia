import { useState, useEffect, useCallback } from 'react';
import Joyride, { CallBackProps, STATUS, Step, ACTIONS, EVENTS } from 'react-joyride';
import { useAppStore } from '@/store/appStore';

const TOUR_STORAGE_KEY = 'logosia-tour-completed';

const tourSteps: Step[] = [
  {
    target: 'body',
    content: 'Bem-vindo ao LogosIA! Vamos fazer um tour rápido pela plataforma.',
    placement: 'center',
    disableBeacon: true,
    title: 'Bem-vindo! 🎉',
  },
  {
    target: '[data-tour="kpi-cards"]',
    content: 'Aqui você vê suas métricas principais em tempo real. Passe o mouse para ver explicações.',
    title: 'Métricas Principais',
    disableBeacon: true,
  },
  {
    target: '[data-tour="sidebar-agents"]',
    content: 'Sua Equipe Salomão — agentes de IA especializados para cada área do marketing.',
    title: 'Equipe Salomão',
    disableBeacon: true,
  },
  {
    target: '[data-tour="sidebar-agents"] a[href="/apollo"]',
    content: 'JOSÉ é seu gestor de tráfego autônomo. Ele analisa e otimiza suas campanhas automaticamente.',
    title: 'JOSÉ — Tráfego Pago',
    disableBeacon: true,
  },
  {
    target: '[data-tour="dark-mode"]',
    content: 'Alterne entre modo claro e escuro aqui.',
    title: 'Tema',
    disableBeacon: true,
  },
];

const joyrideStyles = {
  options: {
    primaryColor: '#2563eb',
    zIndex: 10000,
    arrowColor: 'var(--card, #ffffff)',
    backgroundColor: 'var(--card, #ffffff)',
    textColor: 'var(--card-foreground, #1a1a2e)',
    overlayColor: 'rgba(0, 0, 0, 0.6)',
  },
  tooltip: {
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(37, 99, 235, 0.2)',
  },
  tooltipTitle: {
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '8px',
  },
  tooltipContent: {
    fontSize: '14px',
    lineHeight: '1.6',
  },
  buttonNext: {
    backgroundColor: '#2563eb',
    borderRadius: '8px',
    padding: '8px 20px',
    fontSize: '13px',
    fontWeight: 600,
  },
  buttonBack: {
    color: '#6b7280',
    fontSize: '13px',
    fontWeight: 500,
    marginRight: '8px',
  },
  buttonSkip: {
    color: '#9ca3af',
    fontSize: '12px',
  },
  beacon: {
    display: 'none' as const,
  },
  spotlight: {
    borderRadius: '12px',
  },
};

const joyrideLocale = {
  back: 'Voltar',
  close: 'Fechar',
  last: 'Concluir',
  next: 'Próximo',
  open: 'Abrir',
  skip: 'Pular tour',
};

export function ProductTour() {
  const { showProductTour, setShowProductTour } = useAppStore();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Auto-start tour on first visit
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      // Small delay to let the DOM render
      const timer = setTimeout(() => {
        setRun(true);
        setStepIndex(0);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Listen for manual restart from store
  useEffect(() => {
    if (showProductTour) {
      setStepIndex(0);
      setRun(true);
    }
  }, [showProductTour]);

  const handleCallback = useCallback((data: CallBackProps) => {
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
  }, [setShowProductTour]);

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
      callback={handleCallback}
      styles={joyrideStyles}
      locale={joyrideLocale}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}
