import { useState } from 'react';
import { Search } from 'lucide-react';
import { PALETTE_ITEMS, PHASE_COLORS, AidaPhase } from './flowTypes';

type PaletteItem = typeof PALETTE_ITEMS[number];

interface NodePaletteProps {
  onAddNode: (item: PaletteItem, position: { x: number; y: number }) => void;
}

const GROUPS: { phase: AidaPhase; label: string }[] = [
  { phase: 'atencao',   label: '🎯 Atenção' },
  { phase: 'interesse', label: '💡 Interesse' },
  { phase: 'desejo',    label: '🔥 Desejo' },
  { phase: 'acao',      label: '💰 Ação' },
  { phase: 'posVenda',  label: '🌟 Pós-venda' },
  { phase: 'decisao',   label: '⚙️ Decisão' },
  { phase: 'recovery',  label: '🔁 Recovery' },
];

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? PALETTE_ITEMS.filter(
        item =>
          item.label.toLowerCase().includes(search.toLowerCase()) ||
          item.role.toLowerCase().includes(search.toLowerCase()) ||
          item.agent.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  const handleDragStart = (event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/reactflow-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  };

  const renderItem = (item: PaletteItem) => {
    const phaseColor = PHASE_COLORS[item.phase];
    return (
      <div
        key={`${item.label}-${item.phase}`}
        draggable
        onDragStart={e => handleDragStart(e, item)}
        onDoubleClick={() => onAddNode(item, { x: 200, y: 200 })}
        title="Arraste para o canvas ou dê duplo clique para adicionar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          borderRadius: 8,
          background: '#1e293b',
          borderLeft: `3px solid ${phaseColor.border}`,
          cursor: 'grab',
          userSelect: 'none',
          transition: 'background 0.15s, transform 0.1s',
          marginBottom: 4,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#273449';
          e.currentTarget.style.transform = 'translateX(2px)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#1e293b';
          e.currentTarget.style.transform = 'translateX(0)';
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>{item.emoji}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.label}
          </div>
          <div style={{ fontSize: 9, color: '#64748b' }}>{item.agent}</div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        background: '#0f172a',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid #1e293b',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8, letterSpacing: '0.06em' }}>
          🧩 ELEMENTOS
        </div>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: '#475569' }}
          />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: '100%',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '5px 8px 5px 24px',
              color: '#e2e8f0',
              fontSize: 11,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Item list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 8px',
        }}
      >
        {/* Tip */}
        <div style={{ fontSize: 9, color: '#334155', marginBottom: 8, lineHeight: 1.4 }}>
          Arraste ou dê duplo clique para adicionar
        </div>

        {filtered ? (
          // Filtered results flat list
          filtered.length > 0 ? (
            filtered.map(item => renderItem(item))
          ) : (
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', marginTop: 16 }}>
              Nenhum resultado
            </div>
          )
        ) : (
          // Grouped list
          GROUPS.map(group => {
            const items = PALETTE_ITEMS.filter(i => i.phase === group.phase);
            if (items.length === 0) return null;
            const phaseColor = PHASE_COLORS[group.phase];
            return (
              <div key={group.phase} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: phaseColor.text,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    marginBottom: 5,
                    paddingLeft: 2,
                  }}
                >
                  {group.label}
                </div>
                {items.map(item => renderItem(item))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
