import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  BackgroundVariant, NodeProps, Handle, Position,
  useNodesState, useEdgesState, addEdge, Connection,
  ReactFlowInstance, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Save, ArrowLeft, Trash2, Loader2, Search, X,
  MessageSquare, Mail, Clock, GitBranch, Tag, Webhook,
  Target, Play, Pause, Image, Mic, Video, FileText,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type AutoNodeType = 'trigger' | 'message' | 'email' | 'delay' | 'condition' | 'tag' | 'webhook';

interface AutoNodeData {
  nodeType: AutoNodeType;
  label: string;
  emoji: string;
  borderColor: string;
  bgGradient: string;
  config: Record<string, any>;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
  source: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODE STYLES & PALETTE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_STYLES: Record<AutoNodeType, {
  emoji: string; label: string; description: string;
  borderColor: string; bgGradient: string; iconColor: string;
  Icon: typeof MessageSquare;
}> = {
  trigger: {
    emoji: '🎯', label: 'Gatilho', description: 'Lista de contatos ou leads',
    borderColor: '#10b981',
    bgGradient: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.04))',
    iconColor: '#10b981', Icon: Target,
  },
  message: {
    emoji: '💬', label: 'Mensagem WhatsApp', description: 'Texto, imagem, áudio ou vídeo',
    borderColor: '#3b82f6',
    bgGradient: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(59,130,246,0.04))',
    iconColor: '#3b82f6', Icon: MessageSquare,
  },
  email: {
    emoji: '📧', label: 'E-mail Marketing', description: 'Enviar e-mail ao lead',
    borderColor: '#8b5cf6',
    bgGradient: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(139,92,246,0.04))',
    iconColor: '#8b5cf6', Icon: Mail,
  },
  delay: {
    emoji: '⏱️', label: 'Aguardar', description: 'Esperar minutos, horas ou dias',
    borderColor: '#f59e0b',
    bgGradient: 'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(245,158,11,0.04))',
    iconColor: '#f59e0b', Icon: Clock,
  },
  condition: {
    emoji: '🔀', label: 'Condição', description: 'Ramificar por resposta ou tag',
    borderColor: '#ef4444',
    bgGradient: 'linear-gradient(135deg, rgba(239,68,68,0.18), rgba(239,68,68,0.04))',
    iconColor: '#ef4444', Icon: GitBranch,
  },
  tag: {
    emoji: '🏷️', label: 'Tag', description: 'Adicionar ou remover tag',
    borderColor: '#06b6d4',
    bgGradient: 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(6,182,212,0.04))',
    iconColor: '#06b6d4', Icon: Tag,
  },
  webhook: {
    emoji: '🔗', label: 'Webhook', description: 'Chamar URL externa',
    borderColor: '#ec4899',
    bgGradient: 'linear-gradient(135deg, rgba(236,72,153,0.18), rgba(236,72,153,0.04))',
    iconColor: '#ec4899', Icon: Webhook,
  },
};

const PALETTE_ITEMS = Object.entries(NODE_STYLES).map(([type, style]) => ({
  type: type as AutoNodeType,
  ...style,
}));

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM NODE: Standard Automation Node
// ═══════════════════════════════════════════════════════════════════════════════

const AutomationNode = memo(({ data, selected }: NodeProps<AutoNodeData>) => {
  const style = NODE_STYLES[data.nodeType] || NODE_STYLES.message;
  const configSummary = getConfigSummary(data);

  return (
    <div style={{
      width: 220,
      background: data.bgGradient || style.bgGradient,
      border: `2px solid ${selected ? style.borderColor : style.borderColor + '88'}`,
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: selected
        ? `0 0 24px 4px ${style.borderColor}44, 0 0 0 2px ${style.borderColor}`
        : `0 2px 12px 0 ${style.borderColor}22`,
      position: 'relative',
      transform: selected ? 'scale(1.03)' : 'scale(1)',
      transition: 'box-shadow 0.2s, transform 0.15s',
      cursor: 'pointer',
    }}>
      {/* Handles — trigger has no input, condition has extra output */}
      {data.nodeType !== 'trigger' && (
        <Handle type="target" position={Position.Top} style={{
          background: style.borderColor, width: 10, height: 10, border: '2px solid #1e293b',
        }} />
      )}
      <Handle type="source" position={Position.Bottom} style={{
        background: style.borderColor, width: 10, height: 10, border: '2px solid #1e293b',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${style.borderColor}22`,
          border: `1px solid ${style.borderColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, flexShrink: 0,
        }}>
          {data.emoji}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#f1f5f9',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {data.label}
          </div>
          <div style={{ fontSize: 9, color: style.borderColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {style.label}
          </div>
        </div>
      </div>

      {/* Config summary */}
      {configSummary && (
        <div style={{
          fontSize: 10, color: '#94a3b8', lineHeight: 1.5,
          borderTop: `1px solid ${style.borderColor}33`,
          paddingTop: 8, marginTop: 4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {configSummary}
        </div>
      )}
    </div>
  );
});
AutomationNode.displayName = 'AutomationNode';

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM NODE: Condition Node (with SIM/NÃO outputs)
// ═══════════════════════════════════════════════════════════════════════════════

const ConditionNode = memo(({ data, selected }: NodeProps<AutoNodeData>) => {
  const style = NODE_STYLES.condition;
  return (
    <div style={{
      width: 200,
      background: style.bgGradient,
      border: `2px solid ${selected ? style.borderColor : style.borderColor + '88'}`,
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: selected
        ? `0 0 24px 4px ${style.borderColor}44, 0 0 0 2px ${style.borderColor}`
        : `0 2px 12px 0 ${style.borderColor}22`,
      position: 'relative',
      textAlign: 'center',
      transform: selected ? 'scale(1.03)' : 'scale(1)',
      transition: 'box-shadow 0.2s, transform 0.15s',
      cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{
        background: style.borderColor, width: 10, height: 10, border: '2px solid #1e293b',
      }} />
      <Handle type="source" id="yes" position={Position.Bottom} style={{
        left: '30%', background: '#22c55e', width: 10, height: 10, border: '2px solid #1e293b',
      }} />
      <Handle type="source" id="no" position={Position.Right} style={{
        background: '#ef4444', width: 10, height: 10, border: '2px solid #1e293b',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${style.borderColor}22`, border: `1px solid ${style.borderColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>
          {data.emoji}
        </div>
      </div>
      <div style={{ fontSize: 11, color: '#fca5a5', fontWeight: 600, lineHeight: 1.4 }}>
        {data.config?.conditionLabel || data.label}
      </div>

      {/* SIM / NÃO labels */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 10 }}>
        <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 700, marginLeft: '16%' }}>SIM ↓</span>
      </div>
      <div style={{
        position: 'absolute', right: -28, top: '50%', transform: 'translateY(-50%)',
        fontSize: 9, color: '#ef4444', fontWeight: 700,
      }}>
        NÃO →
      </div>
    </div>
  );
});
ConditionNode.displayName = 'ConditionNode';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: get a one-line summary for node config
// ═══════════════════════════════════════════════════════════════════════════════

function getConfigSummary(data: AutoNodeData): string {
  const c = data.config || {};
  switch (data.nodeType) {
    case 'trigger':
      return c.listName ? `📋 ${c.listName} (${c.contactCount ?? '?'})` : '⚠️ Clique para selecionar lista';
    case 'message':
      if (c.messageType === 'text') return c.messageContent ? `💬 ${c.messageContent.slice(0, 40)}...` : '⚠️ Sem conteúdo';
      if (c.messageType === 'image') return '🖼️ Imagem';
      if (c.messageType === 'audio') return '🎙️ Áudio';
      if (c.messageType === 'video') return '🎬 Vídeo';
      if (c.messageType === 'document') return '📄 Documento';
      return '⚠️ Clique para configurar';
    case 'email':
      return c.subject ? `📧 ${c.subject.slice(0, 40)}` : '⚠️ Clique para configurar';
    case 'delay':
      return c.amount ? `⏱️ ${c.amount} ${c.unit === 'minutes' ? 'min' : c.unit === 'hours' ? 'h' : 'dias'}` : '⚠️ Clique para definir';
    case 'condition':
      return c.conditionLabel || '⚠️ Clique para definir';
    case 'tag':
      return c.tagName ? `🏷️ ${c.tagAction === 'remove' ? 'Remover' : 'Adicionar'}: ${c.tagName}` : '⚠️ Clique para definir';
    case 'webhook':
      return c.webhookUrl ? `🔗 ${c.webhookUrl.slice(0, 35)}...` : '⚠️ Clique para definir';
    default:
      return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODE TYPES — must be outside component
// ═══════════════════════════════════════════════════════════════════════════════

const nodeTypes = {
  automation: AutomationNode,
  condition: ConditionNode,
};

// ═══════════════════════════════════════════════════════════════════════════════
// PALETTE SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

function AutomationPalette({ onAddNode }: {
  onAddNode: (item: typeof PALETTE_ITEMS[0], position: { x: number; y: number }) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = search.trim()
    ? PALETTE_ITEMS.filter(i =>
        i.label.toLowerCase().includes(search.toLowerCase()) ||
        i.description.toLowerCase().includes(search.toLowerCase())
      )
    : PALETTE_ITEMS;

  const handleDragStart = (event: React.DragEvent, item: typeof PALETTE_ITEMS[0]) => {
    event.dataTransfer.setData('application/reactflow-node', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div style={{
      width: 200, flexShrink: 0,
      background: '#0f172a', borderRight: '1px solid #1e293b',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8, letterSpacing: '0.06em' }}>
          🧩 ELEMENTOS
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155',
              borderRadius: 6, padding: '5px 8px 5px 24px',
              color: '#e2e8f0', fontSize: 11, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        <div style={{ fontSize: 9, color: '#334155', marginBottom: 8, lineHeight: 1.4 }}>
          Arraste ou dê duplo clique para adicionar
        </div>
        {filtered.map(item => (
          <div
            key={item.type}
            draggable
            onDragStart={e => handleDragStart(e, item)}
            onDoubleClick={() => onAddNode(item, { x: 300, y: 200 })}
            title={item.description}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8,
              background: '#1e293b', borderLeft: `3px solid ${item.borderColor}`,
              cursor: 'grab', userSelect: 'none',
              transition: 'background 0.15s, transform 0.1s',
              marginBottom: 5,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#273449'; e.currentTarget.style.transform = 'translateX(2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.transform = 'translateX(0)'; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${item.borderColor}22`, border: `1px solid ${item.borderColor}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
            }}>
              {item.emoji}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.label}
              </div>
              <div style={{ fontSize: 9, color: '#64748b' }}>{item.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODE CONFIG DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function NodeConfigDialog({
  node, open, onClose, onSave, onDelete, lists,
}: {
  node: Node<AutoNodeData> | null;
  open: boolean;
  onClose: () => void;
  onSave: (nodeId: string, config: Record<string, any>, label: string) => void;
  onDelete: (nodeId: string) => void;
  lists: ContactList[];
}) {
  const data = node?.data;
  const [config, setConfig] = useState<Record<string, any>>({});
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (data) {
      setConfig({ ...data.config });
      setLabel(data.label);
    }
  }, [data, open]);

  if (!node || !data) return null;

  const style = NODE_STYLES[data.nodeType];
  const updateConfig = (key: string, value: any) => setConfig(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    onSave(node.id, config, label);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-2xl">{data.emoji}</span>
            <span>Configurar {style.label}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label */}
          <div className="space-y-2">
            <Label>Nome do passo</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={style.label} />
          </div>

          {/* ─── TRIGGER CONFIG ─── */}
          {data.nodeType === 'trigger' && (
            <div className="space-y-2">
              <Label>Lista de contatos</Label>
              <Select
                value={config.listId || ''}
                onValueChange={v => {
                  const list = lists.find(l => l.id === v);
                  updateConfig('listId', v);
                  updateConfig('listName', list?.name || '');
                  updateConfig('contactCount', list?.contact_count ?? 0);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione uma lista" /></SelectTrigger>
                <SelectContent>
                  {lists.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name} ({l.contact_count} contatos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Os contatos desta lista entrarão no fluxo automaticamente
              </p>
            </div>
          )}

          {/* ─── MESSAGE CONFIG ─── */}
          {data.nodeType === 'message' && (
            <>
              <div className="space-y-2">
                <Label>Tipo de mensagem</Label>
                <Select value={config.messageType || 'text'} onValueChange={v => updateConfig('messageType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text"><span className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5" /> Texto</span></SelectItem>
                    <SelectItem value="image"><span className="flex items-center gap-2"><Image className="h-3.5 w-3.5" /> Imagem</span></SelectItem>
                    <SelectItem value="audio"><span className="flex items-center gap-2"><Mic className="h-3.5 w-3.5" /> Áudio</span></SelectItem>
                    <SelectItem value="video"><span className="flex items-center gap-2"><Video className="h-3.5 w-3.5" /> Vídeo</span></SelectItem>
                    <SelectItem value="document"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> Documento</span></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(config.messageType || 'text') === 'text' ? (
                <div className="space-y-2">
                  <Label>Conteúdo da mensagem</Label>
                  <Textarea
                    value={config.messageContent || ''}
                    onChange={e => updateConfig('messageContent', e.target.value)}
                    placeholder="Olá {{nome}}, tudo bem? ..."
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {'{{nome}}'} para personalizar com o nome do contato
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>URL da mídia</Label>
                    <Input
                      value={config.mediaUrl || ''}
                      onChange={e => updateConfig('mediaUrl', e.target.value)}
                      placeholder="https://exemplo.com/arquivo.jpg"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Legenda (opcional)</Label>
                    <Input
                      value={config.caption || ''}
                      onChange={e => updateConfig('caption', e.target.value)}
                      placeholder="Confira nosso catálogo!"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* ─── EMAIL CONFIG ─── */}
          {data.nodeType === 'email' && (
            <>
              <div className="space-y-2">
                <Label>Assunto do e-mail</Label>
                <Input
                  value={config.subject || ''}
                  onChange={e => updateConfig('subject', e.target.value)}
                  placeholder="Oferta especial para você!"
                />
              </div>
              <div className="space-y-2">
                <Label>Corpo do e-mail (HTML ou texto)</Label>
                <Textarea
                  value={config.body || ''}
                  onChange={e => updateConfig('body', e.target.value)}
                  placeholder="<h1>Olá {{nome}}</h1><p>Temos uma novidade...</p>"
                  rows={6}
                />
              </div>
              <div className="space-y-2">
                <Label>Remetente (nome)</Label>
                <Input
                  value={config.senderName || ''}
                  onChange={e => updateConfig('senderName', e.target.value)}
                  placeholder="Sua Empresa"
                />
              </div>
            </>
          )}

          {/* ─── DELAY CONFIG ─── */}
          {data.nodeType === 'delay' && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>Tempo</Label>
                <Input
                  type="number" min={1}
                  value={config.amount || ''}
                  onChange={e => updateConfig('amount', parseInt(e.target.value) || 0)}
                  placeholder="30"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Unidade</Label>
                <Select value={config.unit || 'minutes'} onValueChange={v => updateConfig('unit', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutos</SelectItem>
                    <SelectItem value="hours">Horas</SelectItem>
                    <SelectItem value="days">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* ─── CONDITION CONFIG ─── */}
          {data.nodeType === 'condition' && (
            <>
              <div className="space-y-2">
                <Label>Tipo de condição</Label>
                <Select value={config.conditionType || 'response'} onValueChange={v => updateConfig('conditionType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="response">Resposta do lead</SelectItem>
                    <SelectItem value="tag">Possui tag</SelectItem>
                    <SelectItem value="opened">Abriu mensagem</SelectItem>
                    <SelectItem value="clicked">Clicou no link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Descrição da condição</Label>
                <Input
                  value={config.conditionLabel || ''}
                  onChange={e => updateConfig('conditionLabel', e.target.value)}
                  placeholder="Ex: Lead respondeu SIM?"
                />
              </div>
              {config.conditionType === 'response' && (
                <div className="space-y-2">
                  <Label>Palavra-chave esperada</Label>
                  <Input
                    value={config.keyword || ''}
                    onChange={e => updateConfig('keyword', e.target.value)}
                    placeholder="sim, quero, comprar..."
                  />
                </div>
              )}
              {config.conditionType === 'tag' && (
                <div className="space-y-2">
                  <Label>Nome da tag</Label>
                  <Input
                    value={config.tagCheck || ''}
                    onChange={e => updateConfig('tagCheck', e.target.value)}
                    placeholder="interessado"
                  />
                </div>
              )}
            </>
          )}

          {/* ─── TAG CONFIG ─── */}
          {data.nodeType === 'tag' && (
            <>
              <div className="space-y-2">
                <Label>Ação</Label>
                <Select value={config.tagAction || 'add'} onValueChange={v => updateConfig('tagAction', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Adicionar tag</SelectItem>
                    <SelectItem value="remove">Remover tag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome da tag</Label>
                <Input
                  value={config.tagName || ''}
                  onChange={e => updateConfig('tagName', e.target.value)}
                  placeholder="Ex: qualificado, interessado, vip"
                />
              </div>
            </>
          )}

          {/* ─── WEBHOOK CONFIG ─── */}
          {data.nodeType === 'webhook' && (
            <>
              <div className="space-y-2">
                <Label>URL do Webhook</Label>
                <Input
                  value={config.webhookUrl || ''}
                  onChange={e => updateConfig('webhookUrl', e.target.value)}
                  placeholder="https://api.exemplo.com/webhook"
                />
              </div>
              <div className="space-y-2">
                <Label>Método HTTP</Label>
                <Select value={config.httpMethod || 'POST'} onValueChange={v => updateConfig('httpMethod', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="destructive" size="sm" onClick={() => { onDelete(node.id); onClose(); }}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: AutomationFlowBuilder
// ═══════════════════════════════════════════════════════════════════════════════

interface FlowBuilderProps {
  flowId: string | null; // null = new flow
  initialName?: string;
  initialNodes?: Node<AutoNodeData>[];
  initialEdges?: Edge[];
  isActive?: boolean;
  onBack: () => void;
}

export function AutomationFlowBuilder({
  flowId, initialName, initialNodes, initialEdges, isActive: initActive, onBack,
}: FlowBuilderProps) {
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const { toast } = useToast();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  // Flow state
  const defaultNodes: Node<AutoNodeData>[] = initialNodes?.length ? initialNodes : [{
    id: 'trigger_1',
    type: 'automation',
    position: { x: 250, y: 50 },
    data: {
      nodeType: 'trigger',
      label: 'Gatilho',
      emoji: '🎯',
      borderColor: NODE_STYLES.trigger.borderColor,
      bgGradient: NODE_STYLES.trigger.bgGradient,
      config: {},
    },
  }];

  const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges || []);
  const [flowName, setFlowName] = useState(initialName || 'Nova Automação');
  const [isActive, setIsActive] = useState(initActive || false);
  const [saving, setSaving] = useState(false);
  const [currentFlowId, setCurrentFlowId] = useState(flowId);

  // Node config dialog
  const [configNode, setConfigNode] = useState<Node<AutoNodeData> | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // Contact lists
  const [lists, setLists] = useState<ContactList[]>([]);

  // Load contact lists
  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { data } = await supabase
        .from('wa_contact_lists')
        .select('id, name, contact_count, source')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (data) setLists(data as ContactList[]);
    })();
  }, [effectiveUserId]);

  // ─── Connection handler ─────────────────────────────────────
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(prev =>
        addEdge(
          {
            ...params,
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
            style: { stroke: '#6b7280', strokeWidth: 2 },
          },
          prev,
        ),
      );
    },
    [setEdges],
  );

  // ─── Drag & Drop ────────────────────────────────────────────
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/reactflow-node');
      if (!raw || !reactFlowInstance || !reactFlowWrapper.current) return;
      const item = JSON.parse(raw);
      const rect = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      addNodeToCanvas(item, position);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reactFlowInstance],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const addNodeToCanvas = (item: typeof PALETTE_ITEMS[0], position: { x: number; y: number }) => {
    const isCondition = item.type === 'condition';
    const newNode: Node<AutoNodeData> = {
      id: `${item.type}_${Date.now()}`,
      type: isCondition ? 'condition' : 'automation',
      position,
      data: {
        nodeType: item.type,
        label: item.label,
        emoji: item.emoji,
        borderColor: item.borderColor,
        bgGradient: item.bgGradient,
        config: item.type === 'message' ? { messageType: 'text' } : {},
      },
    };
    setNodes(nds => [...nds, newNode]);
  };

  // ─── Node click → config dialog ────────────────────────────
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node<AutoNodeData>) => {
    setConfigNode(node);
    setConfigOpen(true);
  }, []);

  const handleConfigSave = (nodeId: string, config: Record<string, any>, label: string) => {
    setNodes(nds =>
      nds.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config, label } }
          : n,
      ),
    );
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
  };

  // ─── Save flow ──────────────────────────────────────────────
  const handleSave = async () => {
    if (!effectiveUserId) return;
    setSaving(true);
    try {
      const payload = {
        user_id: effectiveUserId,
        name: flowName,
        is_active: isActive,
        nodes: nodes,
        edges: edges,
        updated_at: new Date().toISOString(),
      };

      if (currentFlowId) {
        // Update existing
        const { error } = await (supabase as any)
          .from('wa_automation_flows')
          .update(payload)
          .eq('id', currentFlowId);
        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await (supabase as any)
          .from('wa_automation_flows')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        setCurrentFlowId(data.id);
      }
      toast({ title: 'Automação salva com sucesso!' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0e1a' }}>
      {/* ─── Top Bar ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid #1e293b', background: '#0f172a',
        flexShrink: 0, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: '1px solid #334155', borderRadius: 8,
              padding: '6px 8px', cursor: 'pointer', color: '#94a3b8',
              display: 'flex', alignItems: 'center',
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <input
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
              padding: '6px 12px', color: '#f1f5f9', fontSize: 14, fontWeight: 600,
              outline: 'none', width: 250,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isActive
              ? <Play size={14} style={{ color: '#22c55e' }} />
              : <Pause size={14} style={{ color: '#64748b' }} />
            }
            <span style={{ fontSize: 12, color: isActive ? '#22c55e' : '#64748b', fontWeight: 600 }}>
              {isActive ? 'Ativo' : 'Inativo'}
            </span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: '#7c3aed', border: 'none', borderRadius: 8,
              padding: '8px 16px', cursor: saving ? 'not-allowed' : 'pointer',
              color: '#fff', fontSize: 13, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Salvar
          </button>
        </div>
      </div>

      {/* ─── Canvas + Palette ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Palette */}
        <AutomationPalette onAddNode={addNodeToCanvas} />

        {/* React Flow Canvas */}
        <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            defaultEdgeOptions={{
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
              style: { stroke: '#6b7280', strokeWidth: 2 },
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
            <Controls
              showFitView showZoom showInteractive={false}
              style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, bottom: 16, left: 16 }}
            />
            <MiniMap
              nodeColor={n => {
                const d = n.data as AutoNodeData;
                return NODE_STYLES[d?.nodeType]?.borderColor || '#6b7280';
              }}
              maskColor="rgba(0,0,0,0.7)"
              style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
            />
          </ReactFlow>

          {/* Tip overlay */}
          {nodes.length <= 1 && (
            <div style={{
              position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
              background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
              padding: '12px 20px', fontSize: 12, color: '#94a3b8', textAlign: 'center',
              pointerEvents: 'none', maxWidth: 400,
            }}>
              <span style={{ fontSize: 18, display: 'block', marginBottom: 6 }}>💡</span>
              Arraste elementos da paleta à esquerda para montar seu fluxo.
              <strong style={{ color: '#e2e8f0' }}> Duplo clique</strong> em um nó para configurá-lo.
              <strong style={{ color: '#e2e8f0' }}> Conecte</strong> os nós arrastando de um ponto ao outro.
            </div>
          )}
        </div>
      </div>

      {/* Node Config Dialog */}
      <NodeConfigDialog
        node={configNode}
        open={configOpen}
        onClose={() => { setConfigOpen(false); setConfigNode(null); }}
        onSave={handleConfigSave}
        onDelete={handleDeleteNode}
        lists={lists}
      />
    </div>
  );
}
