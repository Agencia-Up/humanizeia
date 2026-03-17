import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface CreativeUpload {
  id: string;
  user_id: string;
  name: string;
  file_url: string;
  thumbnail_url: string | null;
  file_type: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  dimensions: string | null;
  duration_seconds: number | null;
  tags: string[];
  category: string;
  style: string | null;
  description: string | null;
  ai_analysis: Record<string, unknown>;
  ai_score: number | null;
  ai_recommendations: string[] | null;
  is_favorite: boolean;
  used_in_campaigns: number;
  created_at: string;
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

export function useCreativeUploads() {
  const { user } = useAuth();
  const [uploads, setUploads] = useState<CreativeUpload[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fetchUploads = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('creative_uploads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUploads((data as unknown as CreativeUpload[]) || []);
    } catch (err: any) {
      console.error('Error fetching uploads:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads]);

  const uploadFile = useCallback(async (
    file: File,
    metadata: { name?: string; category?: string; tags?: string[]; description?: string }
  ) => {
    if (!user?.id) {
      toast.error('Faça login para enviar arquivos');
      return null;
    }

    // Validate file type
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
    if (!isImage && !isVideo) {
      toast.error('Tipo de arquivo não suportado. Use PNG, JPG, WebP, GIF, MP4, MOV ou WebM.');
      return null;
    }

    // Validate file size
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
    if (file.size > maxSize) {
      toast.error(`Arquivo muito grande. Máximo: ${isImage ? '10MB' : '50MB'}`);
      return null;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${user.id}/library/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('creatives')
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('creatives')
        .getPublicUrl(path);

      const fileUrl = urlData.publicUrl;
      const fileType = isImage ? 'image' : 'video';

      // Get image dimensions if image
      let dimensions: string | null = null;
      if (isImage) {
        dimensions = await new Promise<string | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(`${img.width}x${img.height}`);
          img.onerror = () => resolve(null);
          img.src = URL.createObjectURL(file);
        });
      }

      // Insert record
      const record = {
        user_id: user.id,
        name: metadata.name || file.name.replace(/\.[^.]+$/, ''),
        file_url: fileUrl,
        thumbnail_url: isImage ? fileUrl : null,
        file_type: fileType,
        mime_type: file.type,
        file_size_bytes: file.size,
        dimensions,
        category: metadata.category || 'geral',
        tags: metadata.tags || [],
        description: metadata.description || null,
      };

      const { data, error } = await supabase
        .from('creative_uploads')
        .insert(record)
        .select()
        .single();

      if (error) throw error;

      setUploads(prev => [data as unknown as CreativeUpload, ...prev]);
      toast.success('Criativo enviado com sucesso!');
      return data;
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error('Erro ao enviar arquivo: ' + (err.message || 'Tente novamente'));
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [user?.id]);

  const deleteUpload = useCallback(async (id: string) => {
    try {
      const upload = uploads.find(u => u.id === id);
      if (upload) {
        // Delete from storage
        const path = upload.file_url.split('/creatives/')[1];
        if (path) {
          await supabase.storage.from('creatives').remove([path]);
        }
      }

      const { error } = await supabase
        .from('creative_uploads')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setUploads(prev => prev.filter(u => u.id !== id));
      toast.success('Criativo removido');
    } catch (err: any) {
      toast.error('Erro ao remover: ' + err.message);
    }
  }, [uploads]);

  const updateUpload = useCallback(async (id: string, updates: Partial<CreativeUpload>) => {
    try {
      const { error } = await supabase
        .from('creative_uploads')
        .update(updates as any)
        .eq('id', id);

      if (error) throw error;
      setUploads(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    } catch (err: any) {
      toast.error('Erro ao atualizar: ' + err.message);
    }
  }, []);

  const toggleFavorite = useCallback(async (id: string) => {
    const upload = uploads.find(u => u.id === id);
    if (upload) {
      await updateUpload(id, { is_favorite: !upload.is_favorite } as any);
    }
  }, [uploads, updateUpload]);

  return {
    uploads,
    isLoading,
    isUploading,
    fetchUploads,
    uploadFile,
    deleteUpload,
    updateUpload,
    toggleFavorite,
  };
}
