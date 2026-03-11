import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Settings, Copy, Globe, Pen, Trash2 } from "lucide-react";
import lovableLogo from "@/assets/lovable-logo.png";

// Animation timeline (in seconds)
const PHASE_DURATIONS = { idle: 1.5, phase1: 3, phase2: 3, phase3: 5, reset: 1.5 };

type Phase = "idle" | "phase1" | "phase2" | "phase3" | "reset";
type Phase3Target = "toggle" | "remix";

const CursorSVG = () => (
  <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M1 1L1 19L6 14L12 22L16 20L10 12L17 11L1 1Z"
      fill="white"
      stroke="black"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const ConnectorLine: React.FC = () => {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const container = document.querySelector('#demo-wrapper .bg-zinc-950');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setStart({ x: rect.left, y: rect.top + 24 });
    };
    update();
    window.addEventListener('resize', update);
    const timer = setTimeout(update, 100);
    return () => { window.removeEventListener('resize', update); clearTimeout(timer); };
  }, []);

  if (!start) return null;

  const leftX = 80;
  const topY = 0;
  const arrowTipY = topY + 10;

  return (
    <svg
      className="fixed inset-0 z-[9998] pointer-events-none"
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh' }}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <motion.path
        d={`M ${start.x} ${start.y} L ${leftX} ${start.y} Q ${leftX} ${start.y - 40}, ${leftX} ${start.y - 40} L ${leftX} ${arrowTipY}`}
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        fill="none"
        strokeDasharray="8 5"
        strokeOpacity="0.7"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.2, ease: "easeInOut" }}
        filter="url(#glow)"
      />
      <motion.path
        d={`M ${leftX - 6} ${arrowTipY + 9} L ${leftX} ${arrowTipY} L ${leftX + 6} ${arrowTipY + 9}`}
        stroke="hsl(var(--primary))"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 1.1 }}
        filter="url(#glow)"
      />
      <motion.circle
        cx={start.x}
        cy={start.y}
        r="4"
        fill="hsl(var(--primary))"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ repeat: Infinity, duration: 2, delay: 1.2 }}
        filter="url(#glow)"
      />
    </svg>
  );
};

const RemixOverlay: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [isVisible, setIsVisible] = useState(true);
  const [clicking, setClicking] = useState(false);
  const [menuHover, setMenuHover] = useState(-1);
  const [toggleKnowledge, setToggleKnowledge] = useState(false);
  const [showClickWarning, setShowClickWarning] = useState(false);
  const [isHoveringDemo, setIsHoveringDemo] = useState(false);
  const [phase3Target, setPhase3Target] = useState<Phase3Target>("toggle");

  const runAnimation = useCallback(() => {
    setMenuHover(-1);
    setToggleKnowledge(false);
    setPhase3Target("toggle");
    setClicking(false);

    setPhase("idle");
    const t1 = setTimeout(() => setPhase("phase1"), PHASE_DURATIONS.idle * 1000);

    const t1click = setTimeout(
      () => {
        setClicking(true);
        setTimeout(() => setClicking(false), 300);
      },
      (PHASE_DURATIONS.idle + 0.05) * 1000,
    );

    const t2 = setTimeout(
      () => setPhase("phase2"),
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1) * 1000,
    );

    const t2hover = setTimeout(
      () => setMenuHover(2),
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + 0.8) * 1000,
    );

    const t2click = setTimeout(
      () => {
        setClicking(true);
        setTimeout(() => setClicking(false), 300);
      },
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + 1.8) * 1000,
    );

    const t3 = setTimeout(
      () => {
        setPhase("phase3");
        setMenuHover(-1);
        setPhase3Target("toggle");
      },
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + PHASE_DURATIONS.phase2) * 1000,
    );

    const t3toggle = setTimeout(
      () => {
        setToggleKnowledge(true);
        setClicking(true);
        setTimeout(() => setClicking(false), 300);
      },
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + PHASE_DURATIONS.phase2 + 2) * 1000,
    );

    const t3click = setTimeout(
      () => {
        setPhase3Target("remix");
        setClicking(true);
        setTimeout(() => setClicking(false), 300);
      },
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + PHASE_DURATIONS.phase2 + 3.8) * 1000,
    );

    const tReset = setTimeout(
      () => setPhase("reset"),
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + PHASE_DURATIONS.phase2 + PHASE_DURATIONS.phase3) * 1000,
    );

    const tLoop = setTimeout(
      () => runAnimation(),
      (PHASE_DURATIONS.idle + PHASE_DURATIONS.phase1 + PHASE_DURATIONS.phase2 + PHASE_DURATIONS.phase3 + PHASE_DURATIONS.reset) * 1000,
    );

    return [t1, t1click, t2, t2hover, t2click, t3, t3toggle, t3click, tReset, tLoop];
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const timers = runAnimation();
    return () => timers.forEach(clearTimeout);
  }, [isVisible, runAnimation]);

  if (!isVisible) return null;

  const cursorPos = {
    idle: { x: 95, y: 24 },
    phase1: { x: 95, y: 24 },
    phase2: { x: 100, y: 106 },
    phase3: phase3Target === "remix" ? { x: 380, y: 350 } : { x: 399, y: 296 },
    reset: { x: 95, y: 24 },
  };

  const currentStep =
    phase === "idle" ? 0 : phase === "phase1" ? 1 : phase === "phase2" ? 2 : phase === "phase3" ? 3 : 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center"
      >
        {/* Header banner */}
        <motion.div
          animate={{
            borderColor: ["hsl(var(--primary) / 0.3)", "hsl(var(--primary) / 0.8)", "hsl(var(--primary) / 0.3)"],
          }}
          transition={{ repeat: Infinity, duration: 2.5 }}
          className="mb-6 px-6 py-3 rounded-full border-2 bg-zinc-900/80"
        >
          <span className="text-base font-semibold text-white">Siga estas instruções para criar sua cópia</span>
        </motion.div>

        {/* Step indicators */}
        <div className="flex gap-3 mb-6">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-500 ${
                  currentStep >= step
                    ? "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.6)]"
                    : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {step}
              </div>
              <span
                className={`text-sm font-medium transition-colors duration-500 ${
                  currentStep === step ? "text-white" : "text-zinc-600"
                }`}
              >
                {step === 1 ? "Abra o menu" : step === 2 ? "Clique em Remix" : "Ative e confirme"}
              </span>
              {step < 3 && <div className="w-8 h-px bg-zinc-700 mx-1" />}
            </div>
          ))}
        </div>

        {/* Demo container wrapper */}
        <div className="relative" id="demo-wrapper">
          <ConnectorLine />

          <div
            className="relative w-[500px] h-[430px] bg-zinc-950 rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl"
            onMouseEnter={() => setIsHoveringDemo(true)}
            onMouseLeave={() => setIsHoveringDemo(false)}
            onClick={(e) => {
              e.stopPropagation();
              setShowClickWarning(true);
              setTimeout(() => setShowClickWarning(false), 3500);
            }}
          >
            {/* Hover overlay - below cursor z-index */}
            <AnimatePresence>
              {isHoveringDemo && !showClickWarning && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-20 bg-black/50 flex items-center justify-center cursor-not-allowed rounded-2xl"
                >
                  <div className="px-4 py-2 bg-zinc-800/90 border border-zinc-600 rounded-lg text-sm text-zinc-300 pointer-events-none">
                    🚫 Apenas demonstração — não é clicável
                  </div>
                </motion.div>
              )}
            </AnimatePresence>


            {/* TUTORIAL badge */}
            <div className="absolute top-3 right-3 z-20 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest bg-blue-950/80 text-white flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              TUTORIAL
            </div>

            {/* Fake top bar */}
            <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4">
              <div className="flex items-center gap-2 cursor-default">
                <img src={lovableLogo} alt="Lovable" className="w-4 h-4" />
                <span className="text-sm text-zinc-300 font-medium">Meu Projeto</span>
                <svg className="w-3 h-3 text-zinc-500" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 8L2 4h8L6 8z" />
                </svg>
              </div>
            </div>

            {/* Content area */}
            <div className="relative h-[calc(100%-48px)]">
              <div className="p-6 space-y-3">
                <div className="h-3 w-3/4 bg-zinc-800/50 rounded" />
                <div className="h-3 w-1/2 bg-zinc-800/50 rounded" />
                <div className="h-3 w-2/3 bg-zinc-800/50 rounded" />
                <div className="h-20 w-full bg-zinc-800/30 rounded-lg mt-4" />
                <div className="h-3 w-1/3 bg-zinc-800/50 rounded" />
                <div className="h-3 w-1/2 bg-zinc-800/50 rounded" />
              </div>

              {/* Dropdown menu - Phase 1 & 2 */}
              <AnimatePresence>
                {(phase === "phase1" || phase === "phase2") && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="absolute top-1 left-4 w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden z-10"
                  >
                    {[
                      { icon: <Settings className="w-3.5 h-3.5" />, label: "Settings" },
                      { icon: null, label: "—", separator: true },
                      { icon: <Copy className="w-3.5 h-3.5" />, label: "Remix this project", highlight: true },
                      { icon: <Globe className="w-3.5 h-3.5" />, label: "Publish to profile" },
                      { icon: <Pen className="w-3.5 h-3.5" />, label: "Rename project" },
                      { icon: null, label: "—", separator: true },
                      { icon: <Trash2 className="w-3.5 h-3.5 text-red-400" />, label: "Delete project", danger: true },
                    ].map((item, i) => {
                      if (item.separator) {
                        return <div key={i} className="h-px bg-zinc-800 my-1" />;
                      }
                      const isHovered = menuHover === i;
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-200 ${
                            isHovered ? "bg-primary/20 text-white" : item.danger ? "text-red-400" : "text-zinc-300"
                          }`}
                        >
                          {item.icon}
                          <span className={isHovered ? "font-medium" : ""}>{item.label}</span>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Modal - Phase 3 */}
              <AnimatePresence>
                {phase === "phase3" && (
                  <>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/60"
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      className="absolute inset-0 flex items-center justify-center z-10"
                    >
                      <div className="w-[360px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
                        <div className="p-5 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <img src={lovableLogo} alt="Lovable" className="w-5 h-5" />
                            <h3 className="text-base font-semibold text-white">Remix project</h3>
                          </div>
                          <p className="text-xs text-zinc-500">Create your own copy of this project</p>
                        </div>

                        <div className="px-5 pb-3">
                          <label className="text-xs text-zinc-400 mb-1.5 block">Project name</label>
                          <div className="h-9 bg-zinc-800 border border-zinc-700 rounded-md px-3 flex items-center">
                            <span className="text-sm text-zinc-300">Meu Projeto (copy)</span>
                          </div>
                        </div>

                        <div className="px-5 space-y-3 pb-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-300">Include project history</span>
                            <div className="w-9 h-5 bg-zinc-700 rounded-full flex items-center px-0.5">
                              <div className="w-4 h-4 bg-zinc-500 rounded-full" />
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-300">Include custom knowledge</span>
                            <motion.div
                              animate={{
                                backgroundColor: toggleKnowledge ? "hsl(var(--primary))" : "rgb(63 63 70)",
                                justifyContent: toggleKnowledge ? "flex-end" : "flex-start",
                              }}
                              transition={{ duration: 0.2 }}
                              className="w-9 h-5 rounded-full flex items-center px-0.5"
                            >
                              <motion.div layout className="w-4 h-4 bg-white rounded-full shadow-sm" />
                            </motion.div>
                          </div>
                        </div>

                        <div className="px-5 pb-5 flex gap-2 justify-end">
                          <div className="px-4 py-2 text-sm text-zinc-400 bg-zinc-800 rounded-md border border-zinc-700">
                            Cancel
                          </div>
                          <div className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md shadow-[0_0_12px_hsl(var(--primary)/0.4)]">
                            Remix
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Animated cursor */}
            <motion.div
              animate={{
                x: cursorPos[phase].x,
                y: cursorPos[phase].y,
              }}
              transition={{ type: "spring", stiffness: 120, damping: 20, mass: 0.8 }}
              className="absolute top-0 left-0 z-50 pointer-events-none"
              style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
            >
              <CursorSVG />
              <AnimatePresence>
                {clicking && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0.8 }}
                    animate={{ scale: 2.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute top-0 left-0 w-4 h-4 rounded-full bg-primary/60"
                  />
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>

        {/* Step description */}
        <motion.p
          key={phase}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 text-sm text-zinc-400 text-center"
        >
          {phase === "idle" && "Preparando demonstração..."}
          {phase === "phase1" && "Passo 1: Clique no nome do projeto para abrir o menu"}
          {phase === "phase2" && 'Passo 2: Selecione "Remix this project"'}
          {phase === "phase3" && 'Passo 3: Ative "Include custom knowledge" e clique em Remix'}
          {phase === "reset" && "✅ Pronto! Agora é sua vez."}
        </motion.p>

        {/* Full-screen click warning */}
        <AnimatePresence>
          {showClickWarning && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center cursor-default"
              onClick={() => setShowClickWarning(false)}
            >
              {/* Arrow from notification box to top-left corner */}
              <svg
                className="fixed inset-0 pointer-events-none z-[10001]"
                style={{ width: '100vw', height: '100vh' }}
              >
                <defs>
                  <filter id="warning-glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <motion.path
                  d={`M ${window.innerWidth / 2} ${window.innerHeight / 2 - 120} L ${window.innerWidth / 2} 40 Q ${window.innerWidth / 2} 20, ${window.innerWidth / 2 - 20} 20 L 90 20 L 90 10`}
                  stroke="hsl(var(--primary))"
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="8 5"
                  strokeOpacity="0.8"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1, ease: "easeInOut", delay: 0.3 }}
                  filter="url(#warning-glow)"
                />
                <motion.path
                  d="M 84 16 L 90 2 L 96 16"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: 1.2 }}
                  filter="url(#warning-glow)"
                />
                <motion.circle
                  cx={window.innerWidth / 2}
                  cy={window.innerHeight / 2 - 120}
                  r="5"
                  fill="hsl(var(--primary))"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 2, delay: 1.3 }}
                  filter="url(#warning-glow)"
                />
              </svg>

              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="bg-zinc-900 border-2 border-primary/60 rounded-xl p-6 max-w-[400px] shadow-[0_0_40px_hsl(var(--primary)/0.4)] text-center z-[10002]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-3xl mb-3">☝️</div>
                <p className="text-base font-semibold text-white mb-2">Isso é apenas um tutorial!</p>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  Para começar, clique no <span className="text-primary font-semibold">nome do projeto</span> no canto superior esquerdo da tela do Lovable, onde a seta está indicando.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};

export default RemixOverlay;
