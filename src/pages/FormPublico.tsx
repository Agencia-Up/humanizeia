import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function FormPublico() {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!formId) return;
    supabase
      .from('capture_forms' as any)
      .select('id, title, description, primary_color, logo_url, fields, success_message, redirect_url, is_active')
      .eq('id', formId)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        setForm(data);
        setLoading(false);
      });
  }, [formId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const enabledFields = (form.fields as any[]).filter((f: any) => f.enabled);
      const custom_data: Record<string, string> = {};
      enabledFields.forEach((f: any) => {
        if (!['name', 'email', 'phone'].includes(f.id)) custom_data[f.id] = values[f.id] || '';
      });

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/form-submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({
            form_id: formId,
            name: values['name'] || '',
            email: values['email'] || '',
            phone: values['phone'] || '',
            custom_data,
            utm_source: new URLSearchParams(window.location.search).get('utm_source') || undefined,
            utm_campaign: new URLSearchParams(window.location.search).get('utm_campaign') || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      if (data.redirect_url) { window.location.href = data.redirect_url; return; }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  if (!form) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-gray-700">Formulário não encontrado</h2>
        <p className="text-gray-500 mt-1">Este link pode estar inativo ou inválido.</p>
      </div>
    </div>
  );

  const color = form.primary_color || '#1565C0';
  const fields: any[] = (form.fields || []).filter((f: any) => f.enabled);

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-sm px-6">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: `${color}20` }}>
          <CheckCircle2 className="h-8 w-8" style={{ color }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Enviado!</h2>
        <p className="text-gray-500">{form.success_message}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-10 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        {/* Header colorido */}
        <div className="p-8 text-white text-center" style={{ background: color }}>
          {form.logo_url && (
            <img src={form.logo_url} alt="Logo" className="h-14 mx-auto mb-4 object-contain" />
          )}
          <h1 className="text-2xl font-bold">{form.title}</h1>
          {form.description && <p className="mt-2 text-sm opacity-90">{form.description}</p>}
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          {fields.map((field: any) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id} className="text-sm font-medium text-gray-700">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </Label>
              <Input
                id={field.id}
                type={field.type || 'text'}
                placeholder={field.placeholder || ''}
                required={field.required}
                value={values[field.id] || ''}
                onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}
                className="h-11 border-gray-200 focus:ring-2 rounded-lg"
                style={{ '--tw-ring-color': color } as any}
              />
            </div>
          ))}

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-12 text-base font-semibold rounded-xl text-white"
            style={{ background: color }}
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Enviar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
