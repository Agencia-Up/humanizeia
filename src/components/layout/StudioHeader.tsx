import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronUp, ChevronDown, LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface StudioTab {
  value: string;
  label: string;
  icon: LucideIcon;
}

interface StudioHeaderProps {
  icon: LucideIcon;
  title: string;
  tabs: StudioTab[];
  activeTab: string;
  onTabChange: (value: string) => void;
  actions?: React.ReactNode;
}

export function StudioHeader({ icon: Icon, title, tabs, activeTab, onTabChange, actions }: StudioHeaderProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 backdrop-blur-md px-3 py-2">
      <Icon className="h-4 w-4 text-primary flex-shrink-0" />
      <span className="text-sm font-semibold text-foreground mr-2 hidden sm:inline">{title}</span>

      {/* Pill tabs - collapsible */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
              {tabs.map(tab => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => onTabChange(tab.value)}
                    className={`
                      relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap
                      ${isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                      }
                    `}
                  >
                    <tab.icon className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Current tab badge when collapsed */}
      {collapsed && (
        <Badge variant="secondary" className="text-[11px] gap-1 px-2 py-0.5">
          {(() => {
            const t = tabs.find(t => t.value === activeTab);
            return t ? <><t.icon className="h-3 w-3" />{t.label}</> : null;
          })()}
        </Badge>
      )}

      {/* Toggle collapse */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Mostrar abas' : 'Esconder abas'}
      >
        {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </Button>

      {/* Right-side actions */}
      {actions && (
        <div className="ml-auto flex items-center gap-1.5">
          {actions}
        </div>
      )}
    </div>
  );
}
