import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PartyPopper, Rocket } from 'lucide-react';

interface SuccessAnimationProps {
  show: boolean;
}

function ConfettiPiece({ delay, x }: { delay: number; x: number }) {
  const colors = [
    'hsl(var(--primary))',
    'hsl(38 92% 50%)',        // warning/orange accent
    'hsl(var(--success))',
    'hsl(200 70% 50%)',
  ];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const size = 6 + Math.random() * 6;

  return (
    <motion.div
      initial={{ y: 0, x, opacity: 1, rotate: 0, scale: 1 }}
      animate={{
        y: [0, -120 - Math.random() * 80, 300],
        x: [x, x + (Math.random() - 0.5) * 200],
        opacity: [1, 1, 0],
        rotate: [0, Math.random() * 720],
        scale: [1, 1.2, 0.5],
      }}
      transition={{ duration: 2 + Math.random(), delay, ease: 'easeOut' }}
      className="absolute bottom-1/2 left-1/2"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      }}
    />
  );
}

export function SuccessAnimation({ show }: SuccessAnimationProps) {
  const [confettiPieces, setConfettiPieces] = useState<{ id: number; delay: number; x: number }[]>([]);

  useEffect(() => {
    if (show) {
      const pieces = Array.from({ length: 40 }, (_, i) => ({
        id: i,
        delay: Math.random() * 0.5,
        x: (Math.random() - 0.5) * 100,
      }));
      setConfettiPieces(pieces);
    }
  }, [show]);

  return (
    <AnimatePresence>
      {show && (
        <div className="relative flex flex-col items-center gap-6">
          {/* Confetti */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {confettiPieces.map((piece) => (
              <ConfettiPiece key={piece.id} delay={piece.delay} x={piece.x} />
            ))}
          </div>

          {/* Icon */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
            className="flex h-24 w-24 items-center justify-center rounded-2xl gradient-primary"
          >
            <PartyPopper className="h-12 w-12 text-primary-foreground" />
          </motion.div>

          {/* Text */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="space-y-2 text-center"
          >
            <h2 className="text-3xl font-bold text-foreground">
              🎉 Tudo pronto!
            </h2>
            <p className="text-muted-foreground">
              Sua conta está configurada e pronta para decolar!
            </p>
          </motion.div>

          {/* Rocket animation */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary"
          >
            <Rocket className="h-4 w-4" />
            <span>Vamos começar a otimizar seus anúncios!</span>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
