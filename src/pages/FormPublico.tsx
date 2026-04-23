import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, AlertCircle, Star } from 'lucide-react';

type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date'
  | 'select' | 'radio' | 'checkbox' | 'rating';

interface FormField {
  id: string; label: string; type: FieldType;
  placeholder: string; required: boolean; enabled: boolean;
  options?: string[];
}

function FieldInput({
  field, value, onChange, color,
}: {
  field: FormField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
  color: string;
}) {
  const strVal = Array.isArray(value) ? '' : (value as string);
  const arrVal = Array.isArray(value) ? (value as string[]) : [];
  const focusStyle = { '--tw-ring-color': color } as React.CSSProperties;

  if (field.type === 'textarea') {
    return (
      <Textarea
        required={field.required}
        placeholder={field.placeholder || 'Sua resposta...'}
        value={strVal}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="resize-none border-gray-200 rounded-lg focus:ring-2"
        style={focusStyle}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <select
        required={field.required}
        value={strVal}
        onChange={e => onChange(e.target.value)}
        className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white text-gray-800 focus:outline-none focus:ring-2 focus:border-transparent"
        style={focusStyle}
      >
        <option value="">Selecionar...</option>
        {(field.options || []).map((opt, i) => (
          <option key={i} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (field.type === 'radio') {
    return (
      <div className="space-y-2">
        {(field.options || []).map((opt, i) => (
          <label key={i} className="flex items-center gap-3 cursor-pointer group">
            <div
              className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
              style={{ borderColor: strVal === opt ? color : '#d1d5db', background: strVal === opt ? color : 'white' }}
              onClick={() => onChange(opt)}
            >
              {strVal === opt && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
            <span className="text-sm text-gray-700">{opt}</span>
            <input type="radio" name={field.id} value={opt} required={field.required && i === 0} checked={strVal === opt} onChange={() => onChange(opt)} className="sr-only" />
          </label>
        ))}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-2">
        {(field.options || []).map((opt, i) => {
          const checked = arrVal.includes(opt);
          return (
            <label key={i} className="flex items-center gap-3 cursor-pointer">
              <div
                className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                style={{ borderColor: checked ? color : '#d1d5db', background: checked ? color : 'white' }}
                onClick={() => onChange(checked ? arrVal.filter(v => v !== opt) : [...arrVal, opt])}
              >
                {checked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          );
        })}
        {field.required && (
          <input type="text" value={arrVal.length > 0 ? 'ok' : ''} required readOnly className="sr-only" tabIndex={-1} />
        )}
      </div>
    );
  }

  if (field.type === 'rating') {
    const rating = Number(strVal) || 0;
    return (
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => onChange(String(n))} className="transition-transform hover:scale-110 focus:outline-none">
            <Star className="h-8 w-8 transition-colors" style={{ color: n <= rating ? color : '#d1d5db' }} fill={n <= rating ? color : '#d1d5db'} />
          </button>
        ))}
        {field.required && (
          <input type="text" value={rating > 0 ? 'ok' : ''} required readOnly className="sr-only" tabIndex={-1} />
        )}
      </div>
    );
  }

  return (
    <Input
      type={field.type || 'text'}
      placeholder={field.placeholder || ''}
      required={field.required}
      value={strVal}
      onChange={e => onChange(e.target.value)}
      className="h-11 border-gray-200 focus:ring-2 rounded-lg"
      style={focusStyle}
    />
  );
}

export default function FormPublico() {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});

  useEffect(() => {
    if (!formId || formId === 'preview') { setLoading(false); return; }
    supabase
      .from('capture_forms' as any)
      .select('id, title, description, primary_color, logo_url, cover_url, fields, success_message, redirect_url, is_active')
      .eq('id', formId)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => { setForm(data); setLoading(false); });
  }, [formId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const enabledFields = (form.fields as FormField[]).filter(f => f.enabled);
      const custom_data: Record<string, string | string[]> = {};
      enabledFields.forEach(f => {
        if (!['name', 'email', 'phone'].includes(f.id)) {
          custom_data[f.label || f.id] = values[f.id] || (f.type === 'checkbox' ? [] : '');
        }
      });

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/form-submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({
            form_id: formId,
            name: String(values['name'] || ''),
            email: String(values['email'] || ''),
            phone: String(values['phone'] || ''),
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

  const setFieldValue = (id: string, val: string | string[]) =>
    setValues(v => ({ ...v, [id]: val }));

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

  const color = form.primary_color || '#6366f1';
  const fields: FormField[] = (form.fields || []).filter((f: FormField) => f.enabled);
  const hasCover = Boolean(form.cover_url);
  const hasLogo = Boolean(form.logo_url);

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg" style={{ background: `${color}20`, border: `2px solid ${color}40` }}>
          <CheckCircle2 className="h-10 w-10" style={{ color }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Enviado com sucesso!</h2>
        <p className="text-gray-500 text-base">{form.success_message}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-[480px] bg-white rounded-2xl shadow-xl overflow-hidden">

        {hasCover ? (
          <div className="relative h-44" style={{ backgroundImage: `url(${form.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
            <div className="absolute inset-0 bg-black/20" />
            {hasLogo && (
              <div className="absolute -bottom-8 left-6 w-16 h-16 rounded-full border-4 border-white shadow-lg overflow-hidden bg-white">
                <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        ) : (
          <div className="h-28 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${color}33, ${color}99)` }}>
            {hasLogo
              ? <img src={form.logo_url} alt="Logo" className="h-16 object-contain drop-shadow-md" />
              : <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg" style={{ background: color }}>{form.title?.[0]?.toUpperCase() || '?'}</div>
            }
          </div>
        )}

        <div className={`p-8 ${hasCover && hasLogo ? 'pt-12' : 'pt-6'}`}>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-800">{form.title}</h1>
            {form.description && <p className="text-gray-500 mt-1.5 text-sm leading-relaxed">{form.description}</p>}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {fields.map(field => (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={field.id} className="text-sm font-medium text-gray-700">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                <FieldInput
                  field={field}
                  value={values[field.id] ?? (field.type === 'checkbox' ? [] : '')}
                  onChange={val => setFieldValue(field.id, val)}
                  color={color}
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
              className="w-full h-12 text-base font-semibold rounded-xl text-white shadow-md hover:opacity-90 transition-opacity mt-2"
              style={{ background: color, border: 'none' }}
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Enviar'}
            </Button>
          </form>
        </div>

        <div className="px-8 pb-5 text-center">
          <p className="text-[11px] text-gray-400">Powered by <strong>Logos IA</strong></p>
        </div>
      </div>
    </div>
  );
}
