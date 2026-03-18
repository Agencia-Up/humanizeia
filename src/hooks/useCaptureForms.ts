import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface CaptureForm {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  instance_id: string | null;
  welcome_message: string;
  auto_create_contact: boolean;
  auto_send_whatsapp: boolean;
  auto_add_to_crm: boolean;
  auto_fire_capi: boolean;
  tags: string[];
  redirect_url: string | null;
  is_active: boolean;
  submission_count: number;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  created_at: string;
}

export function useCaptureForms() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const formsQuery = useQuery({
    queryKey: ['capture-forms', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('capture_forms')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as CaptureForm[];
    },
    enabled: !!user,
  });

  const createForm = useMutation({
    mutationFn: async (form: Partial<CaptureForm>) => {
      const { data, error } = await supabase
        .from('capture_forms')
        .insert({ ...form, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-forms'] });
      toast.success('Formulário criado com sucesso!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateForm = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CaptureForm> & { id: string }) => {
      const { error } = await supabase
        .from('capture_forms')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-forms'] });
      toast.success('Formulário atualizado!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteForm = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('capture_forms').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capture-forms'] });
      toast.success('Formulário removido!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleForm = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('capture_forms')
        .update({ is_active } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['capture-forms'] }),
  });

  return {
    forms: formsQuery.data || [],
    isLoading: formsQuery.isLoading,
    createForm,
    updateForm,
    deleteForm,
    toggleForm,
  };
}

export function useFormSubmissions(formId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['form-submissions', formId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('capture_form_submissions')
        .select('*')
        .eq('form_id', formId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as FormSubmission[];
    },
    enabled: !!user && !!formId,
  });
}
