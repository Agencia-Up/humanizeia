import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, AlertCircle, Star, ChevronDown } from 'lucide-react';

type FieldType = 'text' | 'textarea' | 'email' | 'tel' | 'number' | 'date'
  | 'select' | 'radio' | 'checkbox' | 'rating';

interface FormField {
  id: string; label: string; type: FieldType;
  placeholder: string; required: boolean; enabled: boolean;
  options?: string[];
}

/* ── Estilos de foco reutilizáveis ─────────────────────────────────── */
const inputBase = 'w-full h-11 border border-gray-200 rounded-lg px-3 text-sm text-gray-800 bg-white outline-none transition-colors focus:border-gray-400';

/* ── Renderizador de cada campo ─────────────────────────────────────── */
function FieldInput({
  field, value, onChange, color,
}: {
  field: FormField;
  value: string | string[];
  onChange: (val: string | string[]) => void;
  color: string;
}) {
  const str = Array.isArray(value) ? '' : (value as string);
  const arr = Array.isArray(value) ? (value as string[]) : [];

  /* Textarea */
  if (field.type === 'textarea') {
    return (
      <Textarea
        required={field.required}
        placeholder={field.placeholder || 'Sua resposta...'}
        value={str}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="resize-none border-gray-200 rounded-lg text-sm focus:border-gray-400 focus:outline-none"
      />
    );
  }

  /* Select */
  if (field.type === 'select') {
    return (
      <div className="relative">
        <select
          required={field.required}
          value={str}
          onChange={e => onChange(e.target.value)}
          className="appearance-none w-full h-11 border border-gray-200 rounded-lg pl-3 pr-9 text-sm bg-white text-gray-800 outline-none focus:border-gray-400 transition-colors cursor-pointer"
        >
          <option value="">Selecionar...</option>
          {(field.options || []).map((opt, i) => (
            <option key={i} value={opt}>{opt}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    );
  }

  /* Radio */
  if (field.type === 'radio') {
    return (
      <div className="space-y-2.5">
        {(field.options || []).map((opt, i) => (
          <label key={i} className="flex items-center gap-3 cursor-pointer select-none group">
            <input
              type="radio"
              name={field.id}
              value={opt}
              required={field.required && i === 0}
              checked={str === opt}
              onChange={() => onChange(opt)}
              className="sr-only"
            />
            {/* círculo visual */}
            <span
              className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
              style={{ borderColor: str === opt ? color : '#d1d5db', background: str === opt ? color : 'white' }}
            >
              {str === opt && <span className="w-2 h-2 rounded-full bg-white block" />}
            </span>
            <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  /* Checkbox */
  if (field.type === 'checkbox') {
    return (
      <div className="space-y-2.5">
        {(field.options || []).map((opt, i) => {
          const checked = arr.includes(opt);
          return (
            <label key={i} className="flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                value={opt}
                checked={checked}
                onChange={() => onChange(checked ? arr.filter(v => v !== opt) : [...arr, opt])}
                className="sr-only"
              />
              {/* quadrado visual */}
              <span
                className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                style={{ borderColor: checked ? color : '#d1d5db', background: checked ? color : 'white' }}
              >
                {checked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
            </label>
          );
        })}
        {/* campo oculto para validação HTML5 */}
        {field.required && (
          <input
            type="text"
            value={arr.length > 0 ? 'ok' : ''}
            required
            readOnly
            tabIndex={-1}
            className="sr-only"
          />
        )}
      </div>
    );
  }

  /* Rating */
  if (field.type === 'rating') {
    const rating = Number(str) || 0;
    return (
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(String(n))}
            className="transition-transform hover:scale-110 focus:outline-none active:scale-95"
          >
            <Star
              className="h-8 w-8"
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

  /* Default: text / email / tel / number / date */
  return (
    <Input
      type={field.type === 'tel' ? 'tel' : field.type}
      placeholder={field.placeholder || ''}
      required={field.required}
      value={str}
      onChange={e => onChange(e.target.value)}
      className={inputBase}
    />
  );
}

/* ── Componente principal ────────────────────────────────────────────── */
export default function FormPublico() {
  const { formId } = useParams<{ formId: string }>();
  const [form, setForm]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [values, setValues]       = useState<Record<string, string | string[]>>({});

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
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
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

  const setVal = (id: string, val: string | string[]) =>
    setValues(prev => ({ ...prev, [id]: val }));

  /* ── Estados especiais ── */
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  if (!form) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-gray-700">Formulário não encontrado</h2>
        <p className="text-gray-500 mt-1 text-sm">Este link pode estar inativo ou inválido.</p>
      </div>
    </div>
  );

  const color  = form.primary_color || '#6366f1';
  const fields: FormField[] = (form.fields || []).filter((f: FormField) => f.enabled);
  const hasCover = Boolean(form.cover_url);
  const hasLogo  = Boolean(form.logo_url);

  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: `${color}18`, border: `2px solid ${color}50` }}
        >
          <CheckCircle2 className="h-10 w-10" style={{ color }} />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Enviado com sucesso!</h2>
        <p className="text-gray-500">{form.success_message}</p>
      </div>
    </div>
  );

  /* ── Render principal ── */
  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center py-10 px-4">
      {/*
        IMPORTANTE: sem overflow-hidden no card para o logo não ser cortado.
        Cada seção tem seu próprio rounded.
      */}
      <div className="w-full max-w-[480px] rounded-2xl shadow-xl bg-white">

        {/* ── Capa ── */}
        {hasCover ? (
          <div
            className="relative h-44 rounded-t-2xl overflow-hidden"
            style={{ backgroundImage: `url(${form.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            {/* escurecimento sutil */}
            <div className="absolute inset-0 bg-black/15 rounded-t-2xl" />

            {/* Logo flutuante sobre a borda inferior da capa */}
            {hasLogo && (
              <div className="absolute -bottom-7 left-6 z-10 w-14 h-14 rounded-full border-[3px] border-white shadow-md bg-white overflow-hidden">
                <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        ) : (
          /* Header sem capa: gradiente com logo ou inicial */
          <div
            className="h-28 rounded-t-2xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${color}30, ${color}90)` }}
          >
            {hasLogo
              ? <img src={form.logo_url} alt="Logo" className="h-16 object-contain drop-shadow" />
              : (
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow"
                  style={{ background: color }}
                >
                  {form.title?.[0]?.toUpperCase() ?? '?'}
                </div>
              )
            }
          </div>
        )}

        {/* ── Corpo ── */}
        {/* pt-10 = 40px quando tem logo saindo 28px (7 * 4) abaixo da capa */}
        <div className={`px-8 pb-2 ${hasCover && hasLogo ? 'pt-10' : 'pt-6'}`}>
          <h1 className="text-2xl font-bold text-gray-800 leading-tight">{form.title}</h1>
          {form.description && (
            <p className="text-gray-500 mt-1.5 text-sm leading-relaxed">{form.description}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-8 pb-8 pt-5 space-y-5">
          {fields.map(field => (
            <div key={field.id} className="space-y-1.5">
              <label htmlFor={field.id} className="block text-sm font-medium text-gray-700">
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

          {error && (
            <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Botão — usando <button> nativo para evitar conflito de estilos shadcn */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl text-white text-base font-semibold shadow-sm flex items-center justify-center gap-2 transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            style={{ backgroundColor: color }}
          >
            {submitting
              ? <><Loader2 className="h-5 w-5 animate-spin" /> Enviando...</>
              : 'Enviar'
            }
          </button>
        </form>

        {/* ── Rodapé ── */}
        <div className="px-8 pb-6 text-center rounded-b-2xl">
          <p className="text-[11px] text-gray-400">
            Feito com <span className="font-semibold">Logos IA</span>
          </p>
        </div>

      </div>
    </div>
  );
}
