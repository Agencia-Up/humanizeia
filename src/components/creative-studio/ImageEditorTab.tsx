import { useState, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { SUPABASE_PUBLIC_KEY, supabase } from '@/integrations/supabase/client';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Download, Save, RefreshCw, ImagePlus, Crop, RotateCw, RotateCcw,
  FlipHorizontal, FlipVertical, Sparkles, SunMedium, Contrast, Droplets,
  Undo2, Redo2, X, Layers, Type, ZoomIn, ZoomOut, RotateCcw as ResetIcon, Palette
} from 'lucide-react';
import { ImageUploadArea } from './ImageUploadArea';
import { motion, AnimatePresence } from 'framer-motion';
import { Cropper, CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import { CombineToolPanel } from './CombineToolPanel';
import { OverlayLayer } from './OverlayLayer';
import { TextOverlayLayer, type TextLayer } from './TextOverlayLayer';
import { Input } from '@/components/ui/input';
import { LayersSidebar } from './LayersSidebar';

const EDIT_IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/edit-image`;
const APPLY_THEME_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-theme`;

interface SavedCreative {
  id: string;
  file_url: string;
  name: string;
}

type EditorTool = 'none' | 'crop' | 'filters' | 'ai' | 'text' | 'combine' | 'theme';

export interface OverlayItem {
  id: string;
  image: string;
  position: { x: number; y: number };
  scale: number;
  zIndex: number;
}

interface Filters {
  brightness: number;
  contrast: number;
  saturate: number;
}

const defaultFilters: Filters = { brightness: 100, contrast: 100, saturate: 100 };

interface EditorSnapshot {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  filters: Filters;
  aiResult: string | null;
  editedImage: string | null;
  textLayers: TextLayer[];
  selectedTextId: string | null;
}

const FONT_OPTIONS = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Courier New', monospace", label: 'Courier' },
  { value: 'Impact, sans-serif', label: 'Impact' },
  { value: "'Comic Sans MS', cursive", label: 'Comic Sans' },
];

const makeSnapshot = (s: Omit<EditorSnapshot, never>): EditorSnapshot => ({ ...s });


export function ImageEditorTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropperRef = useRef<CropperRef>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [originalImage, setOriginalImage] = usePersistedState<string | null>('cs-edit-original', null, 500);
  const [editedImage, setEditedImage] = usePersistedState<string | null>('cs-edit-edited', null, 500);
  const [fileName, setFileName] = usePersistedState('cs-edit-filename', '');
  const [savedImages, setSavedImages] = useState<SavedCreative[]>([]);
  const [activeTool, setActiveTool] = usePersistedState<EditorTool>('cs-edit-tool', 'none');

  // Transform state
  const [rotation, setRotation] = usePersistedState('cs-edit-rotation', 0);
  const [flipH, setFlipH] = usePersistedState('cs-edit-flipH', false);
  const [flipV, setFlipV] = usePersistedState('cs-edit-flipV', false);
  const [filters, setFilters] = usePersistedState<Filters>('cs-edit-filters', defaultFilters);

  // AI state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [aiResult, setAiResult] = usePersistedState<string | null>('cs-edit-aiResult', null, 500);

  // Theme state
  const [themeImage, setThemeImage] = useState<string | null>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingTheme, setIsProcessingTheme] = useState(false);

  // Text overlay state - multi-layer
  const [textLayers, setTextLayers] = usePersistedState<TextLayer[]>('cs-edit-textLayers', []);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [textAIPrompt, setTextAIPrompt] = useState('');
  const [isProcessingText, setIsProcessingText] = useState(false);

  // History (undo/redo)
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const preDragSnap = useRef<EditorSnapshot | null>(null);

  const currentSnapshot = useCallback((): EditorSnapshot => ({
    rotation, flipH, flipV, filters: { ...filters }, aiResult, editedImage,
    textLayers: textLayers.map(l => ({ ...l, position: { ...l.position } })),
    selectedTextId,
  }), [rotation, flipH, flipV, filters, aiResult, editedImage, textLayers, selectedTextId]);

  const pushHistory = useCallback(() => {
    setUndoStack(prev => [...prev, currentSnapshot()]);
    setRedoStack([]);
  }, [currentSnapshot]);

  const pushSnapshotToHistory = useCallback((snap: EditorSnapshot) => {
    setUndoStack(prev => [...prev, snap]);
    setRedoStack([]);
  }, []);

  const applySnapshot = useCallback((s: EditorSnapshot) => {
    setRotation(s.rotation);
    setFlipH(s.flipH);
    setFlipV(s.flipV);
    setFilters({ ...s.filters });
    setAiResult(s.aiResult);
    setEditedImage(s.editedImage);
    setTextLayers(s.textLayers.map(l => ({ ...l, position: { ...l.position } })));
    setSelectedTextId(s.selectedTextId);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, currentSnapshot()]);
    setUndoStack(u => u.slice(0, -1));
    applySnapshot(prev);
  }, [undoStack, currentSnapshot, applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, currentSnapshot()]);
    setRedoStack(r => r.slice(0, -1));
    applySnapshot(next);
  }, [redoStack, currentSnapshot, applySnapshot]);

  const [isSaving, setIsSaving] = useState(false);

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const zoomScrollRef = useRef<HTMLDivElement>(null);
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 5;
  const ZOOM_STEP = 0.15;

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);

  // Mouse wheel zoom on preview area
  const handleWheelZoom = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));
    }
  }, []);

  // Combine state — multi-overlay
  const [overlayLayers, setOverlayLayers] = usePersistedState<OverlayItem[]>('cs-edit-overlayLayers', [], 500);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [combinePrompt, setCombinePrompt] = usePersistedState('cs-edit-combinePrompt', '');
  const [isProcessingCombine, setIsProcessingCombine] = useState(false);
  const [combineModalOpen, setCombineModalOpen] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [combinePromptPos, setCombinePromptPos] = usePersistedState('cs-edit-combinePromptPos', { x: 16, y: 16 });
  const [isDraggingPrompt, setIsDraggingPrompt] = useState(false);
  const [isOverlayInteracting, setIsOverlayInteracting] = useState(false);
  const promptDragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Text floating prompt position
  const [textPromptPos, setTextPromptPos] = useState({ x: 16, y: 16 });
  const [isDraggingTextPrompt, setIsDraggingTextPrompt] = useState(false);
  const textPromptDragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Drag effect for floating prompt — clamped to area bounds
  useEffect(() => {
    if (!isDraggingPrompt) return;
    const handleMove = (e: MouseEvent) => {
      const d = promptDragStart.current;
      let nx = d.px + e.clientX - d.mx;
      let ny = d.py + e.clientY - d.my;
      const container = previewAreaRef.current;
      const promptEl = container?.querySelector('[data-combine-prompt]') as HTMLElement | null;
      if (container && promptEl) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const pw = promptEl.offsetWidth;
        const ph = promptEl.offsetHeight;
        nx = Math.max(0, Math.min(cw - pw, nx));
        ny = Math.max(0, Math.min(ch - ph, ny));
      }
      setCombinePromptPos({ x: nx, y: ny });
    };
    const handleUp = () => setIsDraggingPrompt(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDraggingPrompt]);

  // Drag effect for floating text prompt — clamped to area bounds
  useEffect(() => {
    if (!isDraggingTextPrompt) return;
    const handleMove = (e: MouseEvent) => {
      const d = textPromptDragStart.current;
      let nx = d.px + e.clientX - d.mx;
      let ny = d.py + e.clientY - d.my;
      const container = previewAreaRef.current;
      const promptEl = container?.querySelector('[data-text-prompt]') as HTMLElement | null;
      if (container && promptEl) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const pw = promptEl.offsetWidth;
        const ph = promptEl.offsetHeight;
        nx = Math.max(0, Math.min(cw - pw, nx));
        ny = Math.max(0, Math.min(ch - ph, ny));
      }
      setTextPromptPos({ x: nx, y: ny });
    };
    const handleUp = () => setIsDraggingTextPrompt(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [isDraggingTextPrompt]);

  // Reset text prompt position only when text tool first activates with no layers
  useEffect(() => {
    if (activeTool === 'text' && textLayers.length === 0) {
      const container = previewAreaRef.current;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const pw = 320;
        setTextPromptPos({ x: Math.max(0, (cw - pw) / 2), y: ch - 48 });
      }
    }
  }, [activeTool, textLayers.length]);


  // Reset prompt position to bottom-center when overlays change
  useEffect(() => {
    if (overlayLayers.length > 0 && activeTool === 'combine') {
      const container = previewAreaRef.current;
      if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const pw = 320;
        setCombinePromptPos({ x: Math.max(0, (cw - pw) / 2), y: ch - 48 });
      } else {
        setCombinePromptPos({ x: 16, y: 400 });
      }
    }
  }, [overlayLayers.length, activeTool]);

  // Overlay helpers
  const addOverlayImage = useCallback((image: string) => {
    if (overlayLayers.length >= 10) {
      toast({ title: 'Limite atingido', description: 'Máximo de 10 camadas permitido.', variant: 'destructive' });
      return;
    }
    const maxZ = overlayLayers.reduce((max, l) => Math.max(max, l.zIndex), 0);
    const newItem: OverlayItem = {
      id: crypto.randomUUID(),
      image,
      position: { x: 10 + overlayLayers.length * 5, y: 10 + overlayLayers.length * 5 },
      scale: 35,
      zIndex: maxZ + 1,
    };
    setOverlayLayers(prev => [...prev, newItem]);
    setSelectedOverlayId(newItem.id);
  }, [overlayLayers.length]);

  const removeOverlayLayer = useCallback((id: string) => {
    setOverlayLayers(prev => prev.filter(l => l.id !== id));
    setSelectedOverlayId(null);
  }, []);

  const updateOverlayLayer = useCallback((id: string, updates: Partial<OverlayItem>) => {
    setOverlayLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const moveOverlayUp = useCallback((id: string) => {
    setOverlayLayers(prev => {
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex(l => l.id === id);
      if (idx < sorted.length - 1) {
        const thisZ = sorted[idx].zIndex;
        const nextZ = sorted[idx + 1].zIndex;
        return prev.map(l => {
          if (l.id === sorted[idx].id) return { ...l, zIndex: nextZ };
          if (l.id === sorted[idx + 1].id) return { ...l, zIndex: thisZ };
          return l;
        });
      }
      return prev;
    });
  }, []);

  const moveOverlayDown = useCallback((id: string) => {
    setOverlayLayers(prev => {
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex(l => l.id === id);
      if (idx > 0) {
        const thisZ = sorted[idx].zIndex;
        const prevZ = sorted[idx - 1].zIndex;
        return prev.map(l => {
          if (l.id === sorted[idx].id) return { ...l, zIndex: prevZ };
          if (l.id === sorted[idx - 1].id) return { ...l, zIndex: thisZ };
          return l;
        });
      }
      return prev;
    });
  }, []);

  const reorderOverlayLayers = useCallback((fromId: string, toId: string) => {
    setOverlayLayers(prev => {
      const sorted = [...prev].sort((a, b) => b.zIndex - a.zIndex);
      const fromIdx = sorted.findIndex(l => l.id === fromId);
      const toIdx = sorted.findIndex(l => l.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      // Swap z-index values
      const fromZ = sorted[fromIdx].zIndex;
      const toZ = sorted[toIdx].zIndex;
      return prev.map(l => {
        if (l.id === fromId) return { ...l, zIndex: toZ };
        if (l.id === toId) return { ...l, zIndex: fromZ };
        return l;
      });
    });
  }, []);

  // Reorder by moving a layer to a specific visual index (visual = highest z first)
  const reorderOverlayToIndex = useCallback((fromId: string, toVisualIndex: number) => {
    setOverlayLayers(prev => {
      const sorted = [...prev].sort((a, b) => b.zIndex - a.zIndex);
      const fromIdx = sorted.findIndex(l => l.id === fromId);
      if (fromIdx === -1) return prev;

      // Remove the item and insert at new visual position
      const item = sorted[fromIdx];
      const without = sorted.filter(l => l.id !== fromId);
      const insertAt = Math.min(toVisualIndex > fromIdx ? toVisualIndex - 1 : toVisualIndex, without.length);
      without.splice(insertAt, 0, item);

      // Reassign z-index values: highest visual index 0 gets max z
      const maxZ = without.length;
      return prev.map(l => {
        const newVisualIdx = without.findIndex(w => w.id === l.id);
        return { ...l, zIndex: maxZ - newVisualIdx };
      });
    });
  }, []);

  // The current working image (after crop/transforms but before AI)
  const workingImage = editedImage || originalImage;

  useEffect(() => {
    if (user) fetchSavedImages();
  }, [user]);

  const fetchSavedImages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('creatives')
      .select('id, file_url, name')
      .eq('user_id', user.id)
      .eq('type', 'image')
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setSavedImages(data);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Arquivo inválido', description: 'Selecione um arquivo de imagem.', variant: 'destructive' });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'O limite é 12MB.', variant: 'destructive' });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      resetEditor();
      setOriginalImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSelectSavedImage = async (img: SavedCreative) => {
    resetEditor();
    setFileName(img.name);
    // Convert URL to base64 for editing
    try {
      const resp = await fetch(img.file_url);
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onload = (ev) => setOriginalImage(ev.target?.result as string);
      reader.readAsDataURL(blob);
    } catch {
      setOriginalImage(img.file_url);
    }
  };

  const resetEditor = () => {
    setOriginalImage(null);
    setEditedImage(null);
    setAiResult(null);
    setUndoStack([]);
    setRedoStack([]);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setFilters(defaultFilters);
    setActiveTool('none');
    setAiPrompt('');
    setThemeImage(null);
    setOverlayLayers([]);
    setSelectedOverlayId(null);
    setCombinePrompt('');
    setTextLayers([]);
    setSelectedTextId(null);
    setTextAIPrompt('');
    setZoom(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Apply crop
  const handleApplyCrop = () => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const canvas = cropper.getCanvas();
    if (!canvas) return;
    pushHistory();
    setEditedImage(canvas.toDataURL('image/png'));
    setActiveTool('none');
    toast({ title: 'Recorte aplicado!' });
  };

  // Render canvas with transforms + filters
  const renderToCanvas = useCallback((): string | null => {
    const img = new Image();
    const src = aiResult || workingImage;
    if (!src) return null;

    // We need synchronous rendering, so use offscreen canvas
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    // Create a temporary image load (synchronous via already-loaded base64)
    img.src = src;
    if (!img.complete) return null;

    const radsAbs = Math.abs(rotation % 360);
    const isRotated90 = radsAbs === 90 || radsAbs === 270;
    const w = isRotated90 ? img.naturalHeight : img.naturalWidth;
    const h = isRotated90 ? img.naturalWidth : img.naturalHeight;

    offscreen.width = w;
    offscreen.height = h;

    ctx.filter = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%)`;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    return offscreen.toDataURL('image/png');
  }, [workingImage, aiResult, rotation, flipH, flipV, filters]);

  // Get the final composed image for display
  const getFilterStyle = () => `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%)`;
  const getTransformStyle = () => `rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;

  // Apply all text layers locally on canvas
  const handleApplyTextLocal = useCallback(() => {
    if (textLayers.length === 0) return;
    const src = aiResult || workingImage;
    if (!src) return;

    const baseImage = renderToCanvas() || src;
    const img = new Image();
    img.src = baseImage;
    if (!img.complete) return;

    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    // Draw each text layer
    for (const layer of textLayers) {
      const x = (layer.position.x / 100) * offscreen.width;
      const y = (layer.position.y / 100) * offscreen.height;
      const boxWidth = (layer.scale / 100) * offscreen.width;
      const scaledSize = Math.max(8, boxWidth * 0.25);
      ctx.font = `${scaledSize}px ${layer.font}`;
      ctx.fillStyle = layer.color;
      ctx.textBaseline = 'top';
      ctx.fillText(layer.content, x, y);
    }

    pushHistory();
    setAiResult(offscreen.toDataURL('image/png'));
    setRotation(0); setFlipH(false); setFlipV(false); setFilters(defaultFilters);
    setTextLayers([]);
    setSelectedTextId(null);
    setActiveTool('none');
    toast({ title: '✅ Textos aplicados!' });
  }, [textLayers, aiResult, workingImage, renderToCanvas, pushHistory, toast]);

  // Apply text layers with AI blending
  const handleApplyTextAI = useCallback(async () => {
    if (textLayers.length === 0) return;
    const src = aiResult || workingImage;
    if (!src) return;

    const baseImage = renderToCanvas() || src;
    const img = new Image();
    img.src = baseImage;
    if (!img.complete) return;

    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    // Draw all layers
    for (const layer of textLayers) {
      const x = (layer.position.x / 100) * offscreen.width;
      const y = (layer.position.y / 100) * offscreen.height;
      const boxWidth = (layer.scale / 100) * offscreen.width;
      const scaledSize = Math.max(8, boxWidth * 0.25);
      ctx.font = `${scaledSize}px ${layer.font}`;
      ctx.fillStyle = layer.color;
      ctx.textBaseline = 'top';
      ctx.fillText(layer.content, x, y);
    }
    const composedImage = offscreen.toDataURL('image/png');

    const layerDescs = textLayers.map(l => `"${l.content}" em x:${Math.round(l.position.x)}%, y:${Math.round(l.position.y)}%, fonte ${l.font}, cor ${l.color}`).join('; ');
    const instructions = textAIPrompt.trim() || 'Incorpore os textos naturalmente na imagem, mantendo harmonia visual.';
    const finalPrompt = `${instructions}\n\nTEXTOS: ${layerDescs}\n\nA imagem já contém os textos renderizados nas posições indicadas. Integre-os naturalmente na cena conforme as instruções. Mantenha as dimensões originais.`;

    setIsProcessingText(true);
    try {
      const response = await fetch(EDIT_IMAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: JSON.stringify({
          image: composedImage,
          prompt: finalPrompt,
          model: 'google/gemini-3-pro-image-preview',
        }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde e tente novamente.', variant: 'destructive' });
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao colar texto com IA');

      pushHistory();
      setAiResult(data.image);
      setRotation(0); setFlipH(false); setFlipV(false); setFilters(defaultFilters);
      setTextLayers([]);
      setSelectedTextId(null);
      setActiveTool('none');
      toast({ title: '✨ Textos colados com IA!' });
    } catch (err) {
      console.error('Text AI error:', err);
      toast({ title: 'Erro ao colar texto', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsProcessingText(false);
    }
  }, [textLayers, textAIPrompt, aiResult, workingImage, renderToCanvas, pushHistory, toast]);

  // Text layer helpers
  const handleAddTextLayer = useCallback((clickX: number, clickY: number) => {
    if (!previewContainerRef.current) return;
    const rect = previewContainerRef.current.getBoundingClientRect();
    const x = ((clickX - rect.left) / rect.width) * 100;
    const y = ((clickY - rect.top) / rect.height) * 100;
    const newLayer: TextLayer = {
      id: crypto.randomUUID(),
      content: 'Texto',
      font: 'Inter, sans-serif',
      color: '#ffffff',
      size: 48,
      position: { x, y },
      scale: 25,
    };
    pushHistory();
    setTextLayers(prev => [...prev, newLayer]);
    setSelectedTextId(newLayer.id);

    // Position floating prompt below the clicked point, relative to area container
    if (previewAreaRef.current) {
      const areaRect = previewAreaRef.current.getBoundingClientRect();
      const pw = 320; // prompt width
      let px = clickX - areaRect.left - pw / 2;
      let py = clickY - areaRect.top + 40; // 40px below click
      // Clamp within area
      px = Math.max(0, Math.min(areaRect.width - pw, px));
      py = Math.max(0, Math.min(areaRect.height - 44, py));
      setTextPromptPos({ x: px, y: py });
    }
  }, [pushHistory]);

  const handleUpdateTextLayer = useCallback((id: string, updates: Partial<TextLayer>) => {
    setTextLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const handleDeleteTextLayer = useCallback((id: string) => {
    pushHistory();
    setTextLayers(prev => prev.filter(l => l.id !== id));
    setSelectedTextId(null);
  }, [pushHistory]);

  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'text') {
      // If clicking on background (not on a layer), create new layer
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG' || target.dataset.textBackground === 'true') {
        handleAddTextLayer(e.clientX, e.clientY);
      } else {
        // Deselect
        setSelectedTextId(null);
      }
    }
  }, [activeTool, handleAddTextLayer]);

  // AI Edit
  const handleAIEdit = async () => {
    if (!aiPrompt.trim()) {
      toast({ title: 'Digite uma instrução', variant: 'destructive' });
      return;
    }

    const src = aiResult || workingImage;
    if (!src) return;

    // Get flattened image with all transforms applied
    const flatImage = renderToCanvas() || src;

    setIsProcessingAI(true);
    try {
      const response = await fetch(EDIT_IMAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: JSON.stringify({ image: flatImage, prompt: aiPrompt }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde e tente novamente.', variant: 'destructive' });
        return;
      }
      if (response.status === 402) {
        toast({ title: 'Créditos insuficientes', description: 'Adicione créditos para continuar.', variant: 'destructive' });
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao editar imagem');

      // Resize AI result to match original image dimensions
      const resizedImage = await new Promise<string>((resolve) => {
        const origImg = new Image();
        origImg.src = flatImage;
        origImg.onload = () => {
          const aiImg = new Image();
          aiImg.src = data.image;
          aiImg.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = origImg.naturalWidth;
            canvas.height = origImg.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(aiImg, 0, 0, origImg.naturalWidth, origImg.naturalHeight);
            resolve(canvas.toDataURL('image/png'));
          };
          aiImg.onerror = () => resolve(data.image);
        };
        origImg.onerror = () => resolve(data.image);
      });

      pushHistory();
      setAiResult(resizedImage);
      // Reset transforms since AI result is a new image
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setFilters(defaultFilters);
      toast({ title: '✨ Imagem editada com IA!' });
    } catch (err) {
      console.error('AI edit error:', err);
      toast({
        title: 'Erro na edição IA',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Apply Theme handler
  const handleApplyTheme = async () => {
    if (!themeImage) return;
    const src = aiResult || workingImage;
    if (!src) return;

    const flatImage = renderToCanvas() || src;

    setIsProcessingTheme(true);
    try {
      const response = await fetch(APPLY_THEME_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: JSON.stringify({ image: flatImage, theme_image: themeImage }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde e tente novamente.', variant: 'destructive' });
        return;
      }
      if (response.status === 402) {
        toast({ title: 'Créditos insuficientes', description: 'Adicione créditos para continuar.', variant: 'destructive' });
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao aplicar tema');

      // Resize result to match original dimensions
      const resizedImage = await new Promise<string>((resolve) => {
        const origImg = new Image();
        origImg.src = flatImage;
        origImg.onload = () => {
          const aiImg = new Image();
          aiImg.src = data.image;
          aiImg.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = origImg.naturalWidth;
            canvas.height = origImg.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(aiImg, 0, 0, origImg.naturalWidth, origImg.naturalHeight);
            resolve(canvas.toDataURL('image/png'));
          };
          aiImg.onerror = () => resolve(data.image);
        };
        origImg.onerror = () => resolve(data.image);
      });

      pushHistory();
      setAiResult(resizedImage);
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setFilters(defaultFilters);
      toast({ title: '🎨 Tema aplicado com sucesso!' });
    } catch (err) {
      console.error('Apply theme error:', err);
      toast({
        title: 'Erro ao aplicar tema',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsProcessingTheme(false);
    }
  };

  // Combine images handler
  const handleCombine = async () => {
    if (overlayLayers.length === 0) return;
    const src = aiResult || workingImage;
    if (!src) return;

    const mainFlat = renderToCanvas() || src;

    // Describe positions for all overlays, sorted by z-index (back to front)
    const sortedLayers = [...overlayLayers].sort((a, b) => a.zIndex - b.zIndex);
    const posDescs = sortedLayers.map((ol, i) =>
      `Imagem ${i + 2} (camada z-index: ${ol.zIndex}, ${ol.zIndex === Math.min(...overlayLayers.map(l => l.zIndex)) ? 'mais atrás' : ol.zIndex === Math.max(...overlayLayers.map(l => l.zIndex)) ? 'mais à frente' : 'intermediária'}) está posicionada a ${Math.round(ol.position.x)}% da esquerda e ${Math.round(ol.position.y)}% do topo, ocupando ${ol.scale}% da largura da imagem principal.`
    ).join('\n');

    setIsProcessingCombine(true);
    try {
      const response = await fetch(EDIT_IMAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: JSON.stringify({
          image: mainFlat,
          overlay_images: sortedLayers.map(ol => ol.image),
          prompt: `${combinePrompt.trim() || 'Combine naturalmente todas as imagens, posicionando cada uma sobre a principal de forma harmoniosa.'}\n\nINSTRUÇÕES DE POSIÇÃO E PROFUNDIDADE:\n${posDescs}\nIMPORTANTE: Respeite a ordem de profundidade (z-index) — camadas com z-index maior devem aparecer NA FRENTE de camadas com z-index menor. A imagem resultante DEVE manter EXATAMENTE o mesmo aspect ratio e dimensões da imagem principal/base (a primeira imagem). NÃO altere o tamanho ou proporção da imagem final.`,
          model: 'google/gemini-3-pro-image-preview',
        }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde e tente novamente.', variant: 'destructive' });
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao combinar imagens');

      pushHistory();
      setAiResult(data.image);
      setRotation(0); setFlipH(false); setFlipV(false); setFilters(defaultFilters);
      setOverlayLayers([]);
      setSelectedOverlayId(null);
      setActiveTool('none');
      toast({ title: '✨ Imagens combinadas com IA!' });
    } catch (err) {
      console.error('Combine error:', err);
      toast({ title: 'Erro ao combinar', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsProcessingCombine(false);
    }
  };


  const handleDownload = () => {
    const finalImage = renderToCanvas() || aiResult || workingImage;
    if (!finalImage) return;
    const link = document.createElement('a');
    link.href = finalImage;
    link.download = `editado-${fileName.replace(/\.[^/.]+$/, '')}.png`;
    link.click();
  };

  const handleSave = async () => {
    if (!user) {
      toast({ title: 'Faça login para salvar', variant: 'destructive' });
      return;
    }
    const finalImage = renderToCanvas() || aiResult || workingImage;
    if (!finalImage) return;

    setIsSaving(true);
    try {
      const base64Data = finalImage.split(',')[1];
      if (!base64Data) throw new Error('Imagem inválida');

      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/png' });

      const storageFileName = `${user.id}/${Date.now()}-edited.png`;
      const { error: uploadError } = await supabase.storage
        .from('creatives')
        .upload(storageFileName, blob, { contentType: 'image/png' });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('creatives').getPublicUrl(storageFileName);

      const { error: dbError } = await supabase.from('creatives').insert({
        user_id: user.id,
        name: `Editado - ${fileName || new Date().toLocaleDateString('pt-BR')}`,
        file_url: publicUrl,
        type: 'image' as const,
        style: 'edited',
        tags: ['edited', ...(aiResult ? ['ai-edited'] : [])],
      });
      if (dbError) throw dbError;

      toast({ title: '✅ Imagem salva!', description: 'Disponível na aba Imagens.' });
    } catch (err) {
      console.error('Save error:', err);
      toast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const displayImage = aiResult || workingImage;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-col flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {!originalImage ? (
            <div className="py-4">
              <ImageUploadArea
                title="Envie sua imagem para editar"
                onFileSelect={(file) => {
                  setFileName(file.name);
                  resetEditor();
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    setOriginalImage(ev.target?.result as string);
                  };
                  reader.readAsDataURL(file);
                }}
                onSavedImageSelect={handleSelectSavedImage}
                savedImages={savedImages}
              />
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileSelect} />
            </div>
          ) : (
            <motion.div key="editor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-0 flex-1 flex flex-col min-h-0">
              {/* ── Primary Toolbar ── */}
              <div className="flex items-center justify-between rounded-t-lg border border-border/50 bg-muted/40 px-3 py-2">
                {/* Left: editing tools */}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant={activeTool === 'crop' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setActiveTool(activeTool === 'crop' ? 'none' : 'crop')}
                    disabled={!!aiResult}
                  >
                    <Crop className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Recortar</span>
                  </Button>

                  <div className="mx-0.5 h-5 w-px bg-border/60" />

                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { pushHistory(); setRotation(r => r - 90); }} title="Girar esquerda">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { pushHistory(); setRotation(r => r + 90); }} title="Girar direita">
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant={flipH ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => { pushHistory(); setFlipH(f => !f); }} title="Espelhar H">
                    <FlipHorizontal className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant={flipV ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => { pushHistory(); setFlipV(f => !f); }} title="Espelhar V">
                    <FlipVertical className="h-3.5 w-3.5" />
                  </Button>

                  <div className="mx-0.5 h-5 w-px bg-border/60" />

                  <Button
                    variant={activeTool === 'filters' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setActiveTool(activeTool === 'filters' ? 'none' : 'filters')}
                  >
                    <SunMedium className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Filtros</span>
                  </Button>

                  <Button
                    variant={activeTool === 'ai' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setActiveTool(activeTool === 'ai' ? 'none' : 'ai')}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">IA</span>
                  </Button>

                  <Button
                    variant={activeTool === 'theme' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setActiveTool(activeTool === 'theme' ? 'none' : 'theme')}
                  >
                    <Palette className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Tema</span>
                  </Button>

                  <Button
                    variant={activeTool === 'text' ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setActiveTool(activeTool === 'text' ? 'none' : 'text')}
                  >
                    <Type className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Texto</span>
                  </Button>

                  <Button
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => {
                      if (activeTool === 'combine') {
                        setActiveTool('none');
                      } else {
                        setActiveTool('combine');
                        if (overlayLayers.length === 0) setCombineModalOpen(true);
                      }
                    }}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Combinar</span>
                  </Button>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground" onClick={handleUndo} title="Desfazer" disabled={undoStack.length === 0}>
                    <Undo2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Desfazer</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground" onClick={handleRedo} title="Refazer" disabled={redoStack.length === 0}>
                    <Redo2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Refazer</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground" onClick={resetEditor}>
                    <X className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Nova</span>
                  </Button>

                  <div className="mx-0.5 h-5 w-px bg-border/60" />

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => { if (activeTool === 'combine') { setActiveTool('none'); setOverlayLayers([]); } handleDownload(); }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Baixar</span>
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => { if (activeTool === 'combine') { setActiveTool('none'); setOverlayLayers([]); } handleSave(); }}
                    disabled={isSaving}
                  >
                    {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Salvar</span>
                  </Button>
                </div>
              </div>

              {/* ── Expandable tool panels ── */}
              <AnimatePresence>
                {activeTool === 'filters' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-x border-border/50 bg-muted/20">
                    <div className="grid gap-4 p-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <SunMedium className="h-3.5 w-3.5" /> Brilho: {filters.brightness}%
                        </Label>
                        <div onPointerDown={() => { preDragSnap.current = currentSnapshot(); }}>
                          <Slider value={[filters.brightness]} onValueChange={([v]) => setFilters(f => ({ ...f, brightness: v }))} onValueCommit={() => { if (preDragSnap.current) { pushSnapshotToHistory(preDragSnap.current); preDragSnap.current = null; } }} min={0} max={200} step={1} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Contrast className="h-3.5 w-3.5" /> Contraste: {filters.contrast}%
                        </Label>
                        <div onPointerDown={() => { preDragSnap.current = currentSnapshot(); }}>
                          <Slider value={[filters.contrast]} onValueChange={([v]) => setFilters(f => ({ ...f, contrast: v }))} onValueCommit={() => { if (preDragSnap.current) { pushSnapshotToHistory(preDragSnap.current); preDragSnap.current = null; } }} min={0} max={200} step={1} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Droplets className="h-3.5 w-3.5" /> Saturação: {filters.saturate}%
                        </Label>
                        <div onPointerDown={() => { preDragSnap.current = currentSnapshot(); }}>
                          <Slider value={[filters.saturate]} onValueChange={([v]) => setFilters(f => ({ ...f, saturate: v }))} onValueCommit={() => { if (preDragSnap.current) { pushSnapshotToHistory(preDragSnap.current); preDragSnap.current = null; } }} min={0} max={200} step={1} />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="text-xs sm:col-span-3" onClick={() => { pushHistory(); setFilters(defaultFilters); }}>
                        Resetar Filtros
                      </Button>
                    </div>
                  </motion.div>
                )}

                {activeTool === 'ai' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-x border-border/50 bg-muted/20">
                    <div className="flex items-center gap-2 p-3">
                      <Sparkles className="h-4 w-4 flex-shrink-0 text-primary" />
                      <input
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && aiPrompt.trim()) handleAIEdit(); }}
                        placeholder='Ex: "Mude o fundo para uma praia", "Adicione texto PROMOÇÃO no topo"'
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                      />
                      <Button onClick={handleAIEdit} disabled={isProcessingAI || !aiPrompt.trim()} size="sm" className="h-8 gap-1.5 px-3 text-xs">
                        {isProcessingAI ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>Aplicar</>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                )}

                {activeTool === 'theme' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-x border-border/50 bg-muted/20">
                    <div className="space-y-0">
                      <div className="flex items-center gap-3 p-3">
                        <Palette className="h-4 w-4 flex-shrink-0 text-primary" />
                        <p className="flex-1 text-xs text-muted-foreground">
                          Envie uma imagem de referência para extrair e aplicar o tema de cores
                        </p>
                      </div>
                      <div className="flex items-center gap-3 px-3 pb-3">
                        {themeImage ? (
                          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-border">
                            <img src={themeImage} alt="Tema" className="h-full w-full object-cover" />
                            <button
                              onClick={() => setThemeImage(null)}
                              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-16 w-16 flex-shrink-0 flex-col gap-1"
                            onClick={() => themeInputRef.current?.click()}
                          >
                            <ImagePlus className="h-5 w-5 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">Enviar</span>
                          </Button>
                        )}
                        <input
                          ref={themeInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 12 * 1024 * 1024) {
                              toast({ title: 'Arquivo muito grande', description: 'Limite de 12MB.', variant: 'destructive' });
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (ev) => setThemeImage(ev.target?.result as string);
                            reader.readAsDataURL(file);
                            if (themeInputRef.current) themeInputRef.current.value = '';
                          }}
                        />
                        <Button
                          onClick={handleApplyTheme}
                          disabled={isProcessingTheme || !themeImage}
                          size="sm"
                          className="h-8 gap-1.5 px-3 text-xs"
                        >
                          {isProcessingTheme ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>Aplicar Tema</>
                          )}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTool === 'text' && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-x border-border/50 bg-muted/20">
                    <div className="flex items-center gap-3 p-3">
                      <Type className="h-4 w-4 flex-shrink-0 text-primary" />
                      <p className="flex-1 text-xs text-muted-foreground">
                        Clique na imagem para adicionar texto · {textLayers.length} texto{textLayers.length !== 1 ? 's' : ''}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleApplyTextLocal} disabled={textLayers.length === 0} size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                          <Type className="h-3.5 w-3.5" /> Aplicar
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>

              {/* Combine image picker modal */}
              <CombineToolPanel
                open={combineModalOpen}
                onOpenChange={setCombineModalOpen}
                onOverlaySelected={addOverlayImage}
                onCombine={handleCombine}
                isProcessing={isProcessingCombine}
                savedImages={savedImages}
              />

              {/* ── Canvas / Preview area + Layers sidebar ── */}
              <div className="relative flex border border-t-0 border-border/50 bg-[hsl(var(--muted)/0.3)] flex-1 min-h-0 rounded-b-lg">
                <div className="relative flex-1 min-w-0 min-h-0">
                {activeTool === 'crop' && workingImage ? (
                  <div className="relative" style={{ maxHeight: '520px' }}>
                    <Cropper
                      ref={cropperRef}
                      src={workingImage}
                      className="h-[520px]"
                    />
                    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
                      <Button onClick={handleApplyCrop} size="sm">
                        Aplicar Recorte
                      </Button>
                      <Button onClick={() => setActiveTool('none')} size="sm" variant="outline">
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : displayImage ? (
                  <div ref={previewAreaRef} className="relative h-full" style={{ minHeight: 0 }}>
                    {/* Scrollable zoom container */}
                    <div
                      ref={zoomScrollRef}
                      className={`w-full overflow-auto h-full`}
                      onWheel={handleWheelZoom}
                    >
                      <div
                        className="flex items-center justify-center p-4"
                        style={{
                          minWidth: zoom > 1 ? `${zoom * 100}%` : '100%',
                          minHeight: zoom > 1 ? `${zoom * 100}%` : '100%',
                        }}
                      >
                        <div
                          ref={previewContainerRef}
                          className="relative"
                          style={{
                            transform: `scale(${zoom})`,
                            transformOrigin: 'center center',
                            maxWidth: '100%',
                          }}
                          onClick={handlePreviewClick}
                          data-text-background="true"
                        >
                          <img
                            src={displayImage}
                            alt="Imagem em edição"
                            className="block h-auto w-auto max-w-full max-h-[540px]"
                            style={{
                              filter: getFilterStyle(),
                              transform: getTransformStyle(),
                              transition: 'filter 0.2s, transform 0.3s',
                            }}
                          />
                          {activeTool === 'combine' && [...overlayLayers].sort((a, b) => a.zIndex - b.zIndex).map(ol => (
                            <OverlayLayer
                              key={ol.id}
                              overlayImage={ol.image}
                              scale={ol.scale}
                              position={ol.position}
                              onPositionChange={(pos) => updateOverlayLayer(ol.id, { position: pos })}
                              onScaleChange={(s) => updateOverlayLayer(ol.id, { scale: s })}
                              containerRef={previewContainerRef}
                              onInteractionChange={setIsOverlayInteracting}
                              style={{ zIndex: 10 + ol.zIndex }}
                            />
                          ))}
                          {activeTool === 'text' && textLayers.map(layer => (
                            <TextOverlayLayer
                              key={layer.id}
                              layer={layer}
                              selected={selectedTextId === layer.id}
                              onSelect={setSelectedTextId}
                              onUpdate={handleUpdateTextLayer}
                              onDelete={handleDeleteTextLayer}
                              containerRef={previewContainerRef}
                              fontOptions={FONT_OPTIONS}
                              onInteractionChange={setIsOverlayInteracting}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Zoom controls — floating bottom-left */}
                    <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-full border border-border/60 bg-background/85 px-1.5 py-1 shadow-lg backdrop-blur-md">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomOut} disabled={zoom <= ZOOM_MIN} title="Diminuir zoom">
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                      <button
                        onClick={handleZoomReset}
                        className="min-w-[3rem] px-1 text-center text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                        title="Resetar zoom"
                      >
                        {Math.round(zoom * 100)}%
                      </button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleZoomIn} disabled={zoom >= ZOOM_MAX} title="Aumentar zoom">
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Floating draggable text AI prompt */}
                    {activeTool === 'text' && textLayers.length > 0 && !isOverlayInteracting && (
                      <div
                        data-text-prompt
                        className="absolute z-20 flex w-80 items-center gap-2 rounded-full border border-border/60 bg-background/85 px-4 py-2 shadow-lg backdrop-blur-md"
                        style={{
                          left: `${textPromptPos.x}px`,
                          top: `${textPromptPos.y}px`,
                          cursor: isDraggingTextPrompt ? 'grabbing' : 'grab',
                        }}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).tagName === 'INPUT') return;
                          e.preventDefault();
                          setIsDraggingTextPrompt(true);
                          textPromptDragStart.current = { mx: e.clientX, my: e.clientY, px: textPromptPos.x, py: textPromptPos.y };
                        }}
                      >
                        <input
                          type="text"
                          value={textAIPrompt}
                          onChange={(e) => setTextAIPrompt(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleApplyTextAI(); }}
                          placeholder="Instrução p/ IA..."
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                        />
                        <Button
                          size="icon"
                          onClick={handleApplyTextAI}
                          disabled={isProcessingText || textLayers.length === 0}
                          className="h-7 w-7 flex-shrink-0 rounded-full"
                        >
                          {isProcessingText ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                    {/* Floating draggable combine prompt */}
                    {overlayLayers.length > 0 && activeTool === 'combine' && !isOverlayInteracting && (
                      <div
                        data-combine-prompt
                        className="absolute z-20 flex w-80 items-center gap-2 rounded-full border border-border/60 bg-background/85 px-4 py-2 shadow-lg backdrop-blur-md"
                        style={{
                          left: `${combinePromptPos.x}px`,
                          top: `${combinePromptPos.y}px`,
                          cursor: isDraggingPrompt ? 'grabbing' : 'grab',
                        }}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).tagName === 'INPUT') return;
                          e.preventDefault();
                          setIsDraggingPrompt(true);
                          promptDragStart.current = { mx: e.clientX, my: e.clientY, px: combinePromptPos.x, py: combinePromptPos.y };
                        }}
                      >
                        <input
                          type="text"
                          value={combinePrompt}
                          onChange={(e) => setCombinePrompt(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleCombine(); }}
                          placeholder="Instrução opcional..."
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                        />
                        <Button
                          size="icon"
                          onClick={handleCombine}
                          disabled={isProcessingCombine}
                          className="h-7 w-7 flex-shrink-0 rounded-full"
                        >
                          {isProcessingCombine ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}

                {(isProcessingAI || isProcessingCombine || isProcessingText) && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                    <div className="text-center">
                      <RefreshCw className="mx-auto h-8 w-8 animate-spin text-primary" />
                      <p className="mt-3 text-sm text-muted-foreground">
                        {isProcessingText ? 'Colando texto com IA...' : isProcessingCombine ? 'Combinando imagens com IA...' : 'Editando com IA...'}
                      </p>
                    </div>
                  </div>
                )}
                </div>

                {/* Layers sidebar */}
                {activeTool === 'combine' && (
                  <LayersSidebar
                    layers={overlayLayers}
                    selectedId={selectedOverlayId}
                    onSelect={setSelectedOverlayId}
                    onRemove={removeOverlayLayer}
                    onMoveUp={moveOverlayUp}
                    onMoveDown={moveOverlayDown}
                    onAddMore={() => setCombineModalOpen(true)}
                    onReorder={reorderOverlayLayers}
                    onReorderToIndex={reorderOverlayToIndex}
                  />
                )}
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
