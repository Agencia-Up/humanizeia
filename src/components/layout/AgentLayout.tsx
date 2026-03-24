import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import type { AgentConfig } from '@/data/agentsData';

interface AgentLayoutProps {
  agent: AgentConfig;
  children: (activeSection: string) => React.ReactNode;
}

export function AgentLayout({ agent, children }: AgentLayoutProps) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState(agent.sidebarSections[0]?.id || 'overview');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Agent Sidebar */}
      <aside className="w-[220px] shrink-0 border-r border-border/50 flex flex-col bg-card/50">
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">{agent.emoji}</span>
            <span className="font-heading font-bold text-sm" style={{ color: agent.color }}>
              {agent.name}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground italic">{agent.role}</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {agent.sidebarSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                activeSection === section.id
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeSection === section.id ? '' : 'opacity-0'}`} style={{ backgroundColor: agent.color }} />
              {section.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* TopBar */}
        <header className="h-14 shrink-0 border-b border-border/50 flex items-center justify-between px-5 bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <div className="flex items-center gap-2">
              <span className="text-base">{agent.emoji}</span>
              <span className="font-heading font-semibold text-sm" style={{ color: agent.color }}>{agent.name}</span>
              <span className="text-xs text-muted-foreground">— {agent.role}</span>
            </div>
          </div>
          <LogosIALogo size="sm" showText />
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children(activeSection)}
        </main>
      </div>
    </div>
  );
}
