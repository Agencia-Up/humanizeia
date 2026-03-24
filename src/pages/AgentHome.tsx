import { useNavigate } from 'react-router-dom';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { agents } from '@/data/agentsData';

export default function AgentHome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient orbs */}
      <div className="absolute top-[-200px] left-[-100px] w-[500px] h-[500px] rounded-full opacity-[0.07]" style={{ background: 'radial-gradient(circle, #7c5cfc, transparent 70%)' }} />
      <div className="absolute top-[200px] right-[-150px] w-[400px] h-[400px] rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(circle, #f59e0b, transparent 70%)' }} />
      <div className="absolute bottom-[-200px] left-[30%] w-[500px] h-[500px] rounded-full opacity-[0.05]" style={{ background: 'radial-gradient(circle, #3b82f6, transparent 70%)' }} />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-14 animate-fade-up">
          <div className="flex justify-center mb-4">
            <LogosIALogo size="lg" showText />
          </div>
          <p className="text-xs tracking-[0.3em] uppercase text-muted-foreground font-medium mt-3">
            Plataforma de Marketing Inteligente
          </p>
        </div>

        {/* Agent Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent, i) => (
            <button
              key={agent.id}
              onClick={() => navigate(agent.route)}
              className="group text-left rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-5 transition-all duration-300 hover:-translate-y-[3px] hover:border-border"
              style={{
                animationDelay: `${i * 50}ms`,
              }}
            >
              {/* Top */}
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: agent.color + '18' }}>
                  {agent.emoji}
                </div>
                <div className="relative">
                  <span className="block w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-pulse-ring" />
                </div>
              </div>

              {/* Info */}
              <h3 className="font-heading font-bold text-sm mb-0.5" style={{ color: agent.color }}>
                {agent.name}
              </h3>
              <p className="text-[11px] text-muted-foreground italic mb-2">{agent.role}</p>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-4">
                {agent.description}
              </p>

              {/* Metrics */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/30">
                {agent.metrics.map((m) => (
                  <div key={m.label} className="text-center">
                    <p className="text-xs font-bold text-foreground">{m.value}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <p className="text-[11px] mt-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: agent.color }}>
                Abrir dashboard →
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
