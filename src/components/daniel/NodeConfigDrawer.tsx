import { useState, useEffect } from 'react';
import { Node } from 'reactflow';
import { X, Save, Trash2 } from 'lucide-react';
import {
  AGENTS,
  PHASE_COLORS,
  AGENT_COLORS,
  AidaPhase,
  AgentName,
  FunnelNodeData,
} from './flowTypes';

interface NodeConfigDrawerProps {
  node: Node<FunnelNodeData> | null;
  onClose: () => void;
  onSave: (nodeId: string, data: Partial<FunnelNodeData>) => void;
  onDelete: (nodeId: string) => void;
}

const PHASE_OPTIONS: { value: AidaPhase; label: string }[] = [
  { value: 'hub',       label: '⭐ Hub / Orquestrador' },
  { value: 'atencao',   label: '🔴 Atenção' },
  { value: 'interesse', label: '🟡 Interesse' },
  { value: 'desejo',    label: '🟢 Desejo' },
  { value: 'acao',      label: '🔵 Ação' },
  { value: 'posVenda',  label: '🟣 Pós-venda' },
  { value: 'decisao',   label: '🔶 Decisão' },
  { value: 'recovery',  label: '🔁 Recovery' },
];

export function NodeConfigDrawer({ node, onClose, onSave, onDelete }: NodeConfigDrawerProps) {
  const [label,  setLabel]  = useState('');
  const [emoji,  setEmoji]  = useState('');
  const [role,   setRole]   = useState('');
  const [phase,  setPhase]  = useState<AidaPhase>('atencao');
  const [agent,  setAgent]  = useState<AgentName>('Nenhum');
  const [metric, setMetric] = useState('');
  const [url,    setUrl]    = useState('');
  const [notes,  setNotes]  = useState('');

  useEffect(() => {
    if (node) {
      setLabel(node.data.label  ?? '');
      setEmoji(node.data.emoji  ?? '');
      setRole(node.data.role    ?? '');
      setPhase(node.data.phase  ?? 'atencao');
      setAgent(node.data.agent  ?? 'Nenhum');
      setMetric(node.data.metric ?? '');
      setUrl(node.data.url      ?? '');
      setNotes(node.data.notes  ?? '');
    }
  }, [node]);

  const handleSave = () => {
    if (!node) return;
    onSave(node.id, { label, emoji, role, phase, agent, metric, url, notes });
  };

  const handleDelete = () => {
    if (!node) return;
    if (window.confirm('Excluir este nó?')) {
      onDelete(node.id);
    }
  };

  const phaseColor = PHASE_COLORS[phase];
  const agentColor = AGENT_COLORS[agent];

  return (
    <>
      {/* Overlay backdrop on mobile */}
      {node && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          height: '100%',
          width: 320,
          background: '#0f172a',
          borderLeft: '1px solid #1e293b',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: node ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          boxShadow: node ? '-8px 0 32px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 16px 12px',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{emoji}</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>
              Configurar Nó
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Phase color preview badge */}
        <div style={{ padding: '10px 16px 0' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 20,
              border: `1px solid ${phaseColor.border}`,
              background: `${phaseColor.border}22`,
              color: phaseColor.text,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: phaseColor.border,
                display: 'inline-block',
              }}
            />
            {PHASE_OPTIONS.find(p => p.value === phase)?.label ?? phase}
          </span>
        </div>

        {/* Form fields */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Emoji */}
          <div>
            <label style={labelStyle}>Emoji / Ícone</label>
            <input
              value={emoji}
              onChange={e => setEmoji(e.target.value.slice(0, 2))}
              maxLength={2}
              style={{ ...inputStyle, width: 60, textAlign: 'center', fontSize: 20 }}
              placeholder="🎯"
            />
          </div>

          {/* Label */}
          <div>
            <label style={labelStyle}>Título do nó</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              style={inputStyle}
              placeholder="Nome do nó"
            />
          </div>

          {/* Role */}
          <div>
            <label style={labelStyle}>Descrição / Papel</label>
            <input
              value={role}
              onChange={e => setRole(e.target.value)}
              style={inputStyle}
              placeholder="Ex: Tráfego Pago"
            />
          </div>

          {/* Phase */}
          <div>
            <label style={labelStyle}>Fase AIDA</label>
            <select
              value={phase}
              onChange={e => setPhase(e.target.value as AidaPhase)}
              style={selectStyle}
            >
              {PHASE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Agent */}
          <div>
            <label style={labelStyle}>Responsável (Agente)</label>
            <select
              value={agent}
              onChange={e => setAgent(e.target.value as AgentName)}
              style={selectStyle}
            >
              {AGENTS.map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {/* Agent color preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: agentColor,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: 11, color: agentColor, fontWeight: 600 }}>{agent}</span>
            </div>
          </div>

          {/* Metric */}
          <div>
            <label style={labelStyle}>Métrica</label>
            <input
              value={metric}
              onChange={e => setMetric(e.target.value)}
              style={inputStyle}
              placeholder="Ex: CTR: 2% • ROAS: 3x"
            />
          </div>

          {/* URL */}
          <div>
            <label style={labelStyle}>URL / Link</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              style={inputStyle}
              placeholder="https://..."
              type="url"
            />
          </div>

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: 72,
              }}
              placeholder="Observações, instruções, contexto..."
            />
          </div>
        </div>

        {/* Footer buttons */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <button
            onClick={handleSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 0',
              borderRadius: 8,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#2563eb')}
            onMouseLeave={e => (e.currentTarget.style.background = '#3b82f6')}
          >
            <Save size={14} />
            Salvar Alterações
          </button>

          <button
            onClick={handleDelete}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '8px 0',
              borderRadius: 8,
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid #ef444466',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ef444422')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Trash2 size={14} />
            Excluir Nó
          </button>
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#64748b',
  fontWeight: 600,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '7px 10px',
  color: '#f8fafc',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '7px 10px',
  color: '#f8fafc',
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
};
