import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface SocialPost {
  id: string;
  user_id: string;
  platform: 'instagram' | 'facebook' | 'linkedin';
  post_type: 'carousel' | 'single_image' | 'video' | 'story' | 'reel';
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  caption: string;
  hashtags: string[];
  slides?: CarouselSlide[];
  media_urls?: string[];
  scheduled_at?: string;
  published_at?: string;
  ig_media_id?: string;
  insights?: PostInsights;
  created_at: string;
}

export interface CarouselSlide {
  order: number;
  headline: string;
  body: string;
  cta?: string;
  bg_color?: string;
  accent_color?: string;
  image_prompt?: string;
  // V2 rich fields
  type?: 'cover' | 'content' | 'list' | 'quote' | 'cta';
  sub_headline?: string;
  bullets?: string[] | null;
  visual_cue?: string;
  layout?: 'centered' | 'left' | 'split' | 'minimal' | 'full_bleed';
  accent_word?: string;
  image_url?: string;
  visual_config?: { bg?: string; text?: string; accent?: string };
}

export interface PostInsights {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagement_rate: number;
}

export interface GeneratedCarousel {
  topic: string;
  audience: string;
  slides: CarouselSlide[];
  caption: string;
  hashtags: string[];
  cover_headline: string;
  carousel_type?: string;
  visual_style?: string;
  hook_promise?: string;
}

export interface CarouselIdea {
  title: string;
  hook: string;
  type: string;
  viral_score: number;
  why: string;
}

export interface TrendsBrief {
  niche: string;
  carousel_ideas: CarouselIdea[];
  raw_topics: { title: string; summary: string; source: string }[];
  generated_at: string;
}

export function useSocialMedia() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [generatedCarousel, setGeneratedCarousel] = useState<GeneratedCarousel | null>(null);

  // ─── Fetch Posts ─────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async (status?: SocialPost['status']) => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase
        .from('social_posts' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      setPosts((data as unknown as SocialPost[]) || []);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar posts', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  // ─── Generate Carousel with AI ───────────────────────────────────────────
  const generateCarousel = useCallback(async (params: {
    topic: string;
    audience: string;
    tone: string;
    slide_count: number;
    include_cta: boolean;
    brand_name?: string;
  }) => {
    if (!user) return null;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'generate_carousel', ...params },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setGeneratedCarousel(data.carousel);
      return data.carousel as GeneratedCarousel;
    } catch (err: any) {
      toast({ title: 'Erro ao gerar carrossel', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setGenerating(false);
    }
  }, [user, toast]);

  // ─── Save Post as Draft ──────────────────────────────────────────────────
  const saveDraft = useCallback(async (post: Partial<SocialPost>) => {
    if (!user) return null;
    try {
      const { data, error } = await supabase
        .from('social_posts' as any)
        .insert({
          user_id: user.id,
          platform: post.platform || 'instagram',
          post_type: post.post_type || 'carousel',
          status: 'draft',
          caption: post.caption || '',
          hashtags: post.hashtags || [],
          slides: post.slides || [],
          media_urls: post.media_urls || [],
        })
        .select()
        .single();

      if (error) throw error;
      toast({ title: 'Rascunho salvo!', description: 'Post salvo como rascunho.' });
      await fetchPosts();
      return data as unknown as SocialPost;
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [user, toast, fetchPosts]);

  // ─── Schedule Post ────────────────────────────────────────────────────────
  const schedulePost = useCallback(async (postId: string, scheduledAt: string) => {
    try {
      const { error } = await supabase
        .from('social_posts' as any)
        .update({ status: 'scheduled', scheduled_at: scheduledAt })
        .eq('id', postId)
        .eq('user_id', user?.id);

      if (error) throw error;
      toast({ title: 'Post agendado!', description: `Publicação programada para ${new Date(scheduledAt).toLocaleString('pt-BR')}` });
      await fetchPosts();
    } catch (err: any) {
      toast({ title: 'Erro ao agendar', description: err.message, variant: 'destructive' });
    }
  }, [user, toast, fetchPosts]);

  // ─── Publish Now via Instagram API ───────────────────────────────────────
  const publishNow = useCallback(async (postId: string) => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'publish_post', post_id: postId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: 'Post publicado!', description: 'Seu post foi publicado no Instagram.' });
      await fetchPosts();
    } catch (err: any) {
      toast({ title: 'Erro ao publicar', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, toast, fetchPosts]);

  // ─── Get Post Insights ────────────────────────────────────────────────────
  const refreshInsights = useCallback(async (postId: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'get_post_insights', post_id: postId },
      });
      if (error) throw error;
      if (data?.insights) {
        await supabase
          .from('social_posts' as any)
          .update({ insights: data.insights })
          .eq('id', postId);
        await fetchPosts();
      }
    } catch {
      // Silent fail for insights
    }
  }, [user, fetchPosts]);

  // ─── Delete Draft ────────────────────────────────────────────────────────
  const deleteDraft = useCallback(async (postId: string) => {
    try {
      await supabase.from('social_posts' as any).delete().eq('id', postId).eq('user_id', user?.id);
      toast({ title: 'Rascunho removido' });
      await fetchPosts();
    } catch (err: any) {
      toast({ title: 'Erro ao deletar', description: err.message, variant: 'destructive' });
    }
  }, [user, toast, fetchPosts]);

  // ─── Generate Carousel V2 (Rich Page-Based) ──────────────────────────────
  const generateCarouselV2 = useCallback(async (params: {
    topic: string;
    audience: string;
    tone: string;
    slide_count: number;
    include_cta: boolean;
    brand_name?: string;
    carousel_type?: string;
    paul_copy?: string;
    trend_context?: string;
    client_image_url?: string;
  }) => {
    if (!user) return null;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'generate_carousel_v2', ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedCarousel(data.carousel);
      return data.carousel as GeneratedCarousel;
    } catch (err: any) {
      toast({ title: 'Erro ao gerar carrossel', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setGenerating(false);
    }
  }, [user, toast]);

  // ─── Fetch Trends Brief ───────────────────────────────────────────────────
  const fetchTrendsBrief = useCallback(async (niche: string): Promise<TrendsBrief | null> => {
    if (!user) return null;
    try {
      const { data, error } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'fetch_trends_brief', niche, limit: 8 },
      });
      if (error) throw error;
      return data as TrendsBrief;
    } catch (err: any) {
      toast({ title: 'Erro ao buscar tendências', description: err.message, variant: 'destructive' });
      return null;
    }
  }, [user, toast]);

  return {
    loading,
    generating,
    posts,
    generatedCarousel,
    setGeneratedCarousel,
    fetchPosts,
    generateCarousel,
    generateCarouselV2,
    fetchTrendsBrief,
    saveDraft,
    schedulePost,
    publishNow,
    refreshInsights,
    deleteDraft,
  };
}
