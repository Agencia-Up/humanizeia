import React, { useEffect, useState, memo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { SUPABASE_PUBLIC_KEY, supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, AlertCircle, Star, ChevronDown } from 'lucide-react';

type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date'
  | 'select' | 'radio' | 'checkbox' | 'rating';

interface FormField {
  id: string; label: string; type: FieldType;
  placeholder: string; required: boolean; enabled: boolean;
  options?: string[];
}

/* ── Base styles ─────────────────────────────────────────────────────────── */
// font-size mínimo 16px nos inputs impede o zoom automático do iOS Safari
const inputBase =
  'w-full border border-gray-200 rounded-xl px-4 text-base text-gray-800 bg-white outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

/* ── Renderizador de cada campo ──────────────────────────────────────────── */
const FieldInput = memo(({
  field, value, onChange, color,
}: {
  field: FormField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
  color: string;
}) => {
  const str = Array.isArray(value) ? '' : (value as string);
  const arr = Array.isArray(value) ? (value as string[]) : [];

  const handleText  = (val: string)   => onChange(val);
  const handleCheck = (val: string[]) => onChange(val);

  if (field.type === 'textarea') {
    return (
      <textarea
        required={field.required}
        placeholder={field.placeholder || 'Sua resposta...'}
        value={str}
        onChange={e => handleText(e.target.value)}
        rows={4}
        className={`${inputBase} py-3 resize-none`}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <div className="relative">
        <select
          required={field.required}
          value={str}
          onChange={e => handleText(e.target.value)}
          className={`${inputBase} h-14 pl-4 pr-10 appearance-none cursor-pointer`}
        >
          <option value="">Selecionar...</option>
          {(field.options || []).map((opt, i) => (
            <option key={i} value={opt}>{opt}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
      </div>
    );
  }

  if (field.type === 'radio') {
    return (
      <div className="space-y-3">
        {(field.options || []).map((opt, i) => (
          <label key={i} className="flex items-center gap-3 cursor-pointer select-none">
            <input type="radio" name={field.id} value={opt}
              required={field.required && i === 0}
              checked={str === opt}
              onChange={() => handleText(opt)}
              className="sr-only"
            />
            <span
              className="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
              style={{ borderColor: str === opt ? color : '#d1d5db', background: str === opt ? color : 'white' }}
            >
              {str === opt && <span className="w-2.5 h-2.5 rounded-full bg-white block" />}
            </span>
            <span className="text-base text-gray-700">{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-3">
        {(field.options || []).map((opt, i) => {
          const checked = arr.includes(opt);
          return (
            <label key={i} className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" value={opt} checked={checked}
                onChange={() => handleCheck(checked ? arr.filter(v => v !== opt) : [...arr, opt])}
                className="sr-only"
              />
              <span
                className="w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all"
                style={{ borderColor: checked ? color : '#d1d5db', background: checked ? color : 'white' }}
              >
                {checked && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className="text-base text-gray-700">{opt}</span>
            </label>
          );
        })}
        {field.required && (
          <input type="text" value={arr.length > 0 ? 'ok' : ''} required readOnly tabIndex={-1} className="sr-only" />
        )}
      </div>
    );
  }

  if (field.type === 'rating') {
    const rating = Number(str) || 0;
    return (
      <div className="flex gap-3">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button"
            onClick={() => handleText(String(n))}
            className="transition-transform active:scale-95 focus:outline-none"
          >
            <Star className="h-9 w-9"
              style={{ color: n <= rating ? color : '#d1d5db' }}
              fill={n <= rating ? color : '#d1d5db'}
            />
          </button>
        ))}
        {field.required && (
          <input type="text" value={rating > 0 ? 'ok' : ''} required readOnly tabIndex={-1} className="sr-only" />
        )}
      </div>
    );
  }

  /* text / email / tel / number / date */
  return (
    <input
      type={field.type}
      placeholder={field.placeholder || ''}
      required={field.required}
      value={str}
      onChange={e => handleText(e.target.value)}
      className={`${inputBase} h-14`}
    />
  );
});
FieldInput.displayName = 'FieldInput';

/* ── Componente principal ────────────────────────────────────────────────── */
export default function FormPublico() {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm]               = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [values, setValues]           = useState<Record<string, string | string[]>>({});

  useEffect(() => {
    if (!formId || formId === 'preview') { setLoading(false); return; }
    supabase
      .from('capture_forms' as any)
      .select('id,title,description,primary_color,logo_url,cover_url,fields,success_message,redirect_url,is_active')
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
          custom_data[f.label || f.id] = values[f.id] ?? (f.type === 'checkbox' ? [] : '');
        }
      });

      const params = new URLSearchParams(window.location.search);
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/form-submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_PUBLIC_KEY,
            'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
          },
          body: JSON.stringify({
            form_id: formId,
            name:    String(values['name']  || ''),
            email:   String(values['email'] || ''),
            phone:   String(values['phone'] || ''),
            custom_data,
            utm_source:   params.get('utm_source')   || undefined,
            utm_campaign: params.get('utm_campaign') || undefined,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao enviar');
      if (json.redirect_url) { window.location.href = json.redirect_url; return; }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const setVal = useCallback((id: string, val: string | string[]) =>
    setValues(prev => ({ ...prev, [id]: val })), []);

  /* ── Loading ── */
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  /* ── Not found ── */
  if (!form) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="text-center">
        <AlertCircle className="h-14 w-14 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-700">Formulário não encontrado</h2>
        <p className="text-gray-500 mt-1 text-sm">Este link pode estar inativo ou inválido.</p>
      </div>
    </div>
  );

  const color   = form.primary_color || '#6366f1';
  const fields: FormField[] = (form.fields || []).filter((f: FormField) => f.enabled);
  const hasCover = Boolean(form.cover_url);
  const hasLogo  = Boolean(form.logo_url);

  /* ── Sucesso ── */
  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="text-center max-w-xs w-full">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: `${color}18`, border: `3px solid ${color}50` }}
        >
          <CheckCircle2 className="h-12 w-12" style={{ color }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-3">Enviado com sucesso!</h2>
        <p className="text-gray-500 text-base leading-relaxed">{form.success_message}</p>
      </div>
    </div>
  );

  /* ── Render principal ── */
  return (
    /*
      Mobile: sem padding externo → card ocupa 100% da tela
      Desktop (sm+): padding externo + card centralizado com max-w
    */
    <div className="min-h-screen bg-gray-100 sm:flex sm:items-start sm:justify-center sm:py-10 sm:px-4">
      <div className="w-full sm:max-w-[500px] bg-white sm:rounded-2xl sm:shadow-xl overflow-hidden">

        {/* ── Capa ── */}
        {hasCover ? (
          <div
            className="relative h-44 sm:h-48 sm:rounded-t-2xl overflow-hidden"
            style={{ backgroundImage: `url(${form.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="absolute inset-0 bg-black/15" />
            {hasLogo && (
              <div className="absolute -bottom-8 left-5 z-10 w-16 h-16 rounded-full border-4 border-white shadow-lg bg-white overflow-hidden">
                <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        ) : (
          /* Sem capa: gradiente + logo ou inicial */
          <div
            className="h-32 sm:h-36 sm:rounded-t-2xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${color}30, ${color}90)` }}
          >
            {hasLogo
              ? <img src={form.logo_url} alt="Logo" className="h-16 object-contain drop-shadow" />
              : (
                <div
                  className="w-18 h-18 w-[72px] h-[72px] rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-lg"
                  style={{ background: color }}
                >
                  {form.title?.[0]?.toUpperCase() ?? '?'}
                </div>
              )
            }
          </div>
        )}

        {/* ── Título + Descrição ── */}
        <div className={`px-5 sm:px-8 pb-1 ${hasCover && hasLogo ? 'pt-12' : 'pt-6'}`}>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 leading-tight">{form.title}</h1>
          {form.description && (
            <p className="text-gray-500 mt-1.5 text-sm sm:text-base leading-relaxed">{form.description}</p>
          )}
        </div>

        {/* ── Campos ── */}
        <form onSubmit={handleSubmit} className="px-5 sm:px-8 pt-5 pb-6 space-y-5">
          {fields.map(field => (
            <div key={field.id} className="space-y-2">
              <label htmlFor={field.id} className="block text-sm font-semibold text-gray-700">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <FieldInput
                field={field}
                value={values[field.id] ?? (field.type === 'checkbox' ? [] : '')}
                onChange={val => setVal(field.id, val)}
                color={color}
              />
            </div>
          ))}

          {/* ── Erro ── */}
          {error && (
            <div className="flex items-start gap-2.5 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Botão enviar ── */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-14 rounded-xl text-white text-base font-semibold shadow flex items-center justify-center gap-2 transition-opacity active:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            style={{ backgroundColor: color }}
          >
            {submitting
              ? <><Loader2 className="h-5 w-5 animate-spin" /> Enviando...</>
              : 'Enviar'
            }
          </button>
        </form>

        {/* ── Rodapé ── */}
        <div className="px-5 sm:px-8 pb-8 text-center">
          <p className="text-xs text-gray-400">
            Powered by <span className="font-semibold">Logos IA</span>
          </p>
        </div>

      </div>
    </div>
  );
}
