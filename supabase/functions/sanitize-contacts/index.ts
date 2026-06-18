import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Sanitize Contacts Edge Function
 * 
 * Receives an array of raw contacts and returns sanitized, deduplicated contacts.
 * Also checks WhatsApp validity via UazAPI if instance config is available.
 *
 * Input: { user_id, list_id, contacts: [{ phone, name?, group_name?, source? }], check_whatsapp?: boolean }
 * Output: { success, sanitized: [...], stats: { total_input, duplicates_removed, invalid_phones, whatsapp_invalid, total_valid } }
 */

// ===== E.164 Phone Formatting =====
function formatPhoneE164(raw: string): string | null {
  if (!raw) return null;

  // Strip all non-digit characters
  let digits = raw.replace(/\D/g, '');

  if (digits.length < 10) return null;

  // Brazilian numbers: add country code 55 if missing
  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }

  // Validate Brazilian number structure
  if (digits.startsWith('55')) {
    const nationalPart = digits.substring(2);
    // DDD (2 digits) + number (8 or 9 digits)
    if (nationalPart.length < 10 || nationalPart.length > 11) return null;

    const ddd = parseInt(nationalPart.substring(0, 2));
    if (ddd < 11 || ddd > 99) return null;

    // Mobile numbers (9 digits) should start with 9
    if (nationalPart.length === 11 && nationalPart[2] !== '9') {
      // Could be a landline with extra digit - try removing
    }

    // Landline numbers (8 digits) - valid
    // Mobile numbers (9 digits starting with 9) - valid
  }

  // Final validation: reasonable length for international numbers
  if (digits.length < 12 || digits.length > 15) return null;

  return digits;
}

// ===== Deduplication against DB =====
async function findExistingPhones(
  supabase: any,
  userId: string,
  phones: string[],
  listId?: string | null,
): Promise<Set<string>> {
  const existing = new Set<string>();

  // Query in batches of 500 to avoid query size limits
  for (let i = 0; i < phones.length; i += 500) {
    const batch = phones.slice(i, i + 500);
    let query = supabase
      .from('wa_contacts')
      .select('phone')
      .eq('user_id', userId)
      .in('phone', batch);
    // Dedup POR LISTA: só conta como duplicado quem já está NESTA lista. O unique
    // é (user_id, list_id, phone), então o mesmo contato pode (e deve) entrar em
    // listas diferentes. Sem isso, contato que já existia em outra lista era
    // ignorado e a lista nova ficava vazia (0 importados / N duplicados).
    if (listId) query = query.eq('list_id', listId);
    const { data } = await query;

    if (data) {
      for (const row of data) {
        existing.add(row.phone);
      }
    }
  }

  return existing;
}

// ===== WhatsApp Validation via UazAPI =====
async function checkWhatsAppNumbers(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
  phones: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // UazAPI supports batch number check
  try {
    const res = await fetch(`${baseUrl}/chat/whatsappNumbers/${instanceName}`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        numbers: phones,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      // Response format: array of { exists: boolean, jid: string, number: string }
      const entries = Array.isArray(data) ? data : (data?.data || data?.numbers || []);
      for (const entry of entries) {
        const num = (entry.number || entry.jid || '').replace(/@.*$/, '').replace(/\D/g, '');
        if (num) {
          results.set(num, entry.exists === true || entry.numberExists === true);
        }
      }
    } else {
      console.warn(`[sanitize] WhatsApp check returned ${res.status}, skipping validation`);
    }
  } catch (err) {
    console.warn('[sanitize] WhatsApp number check failed, skipping:', err);
  }

  return results;
}

// ===== Get UazAPI Instance =====
async function getEvolutionInstance(supabase: any, userId: string) {
  const { data: instance } = await supabase
    .from('wa_instances')
    .select('api_url, api_key_encrypted, instance_name')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (instance) {
    return {
      apiUrl: instance.api_url.replace(/\/$/, ''),
      apiKey: instance.api_key_encrypted,
      instanceName: instance.instance_name,
    };
  }

  // Fallback to whatsapp_config
  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('api_url, api_key, instance_name')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (config) {
    return {
      apiUrl: config.api_url.replace(/\/$/, ''),
      apiKey: config.api_key,
      instanceName: config.instance_name,
    };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: support both user JWT and service-role calls (internal function-to-function)
    let user_id: string;
    const authHeader = req.headers.get('Authorization');
    const serviceRoleToken = supabaseServiceKey;
    const bearerToken = authHeader?.replace('Bearer ', '') || '';

    if (bearerToken === serviceRoleToken) {
      // Internal service-to-service call (from other edge functions)
      const body_peek = await req.clone().json();
      if (!body_peek.user_id) {
        return new Response(JSON.stringify({ success: false, error: 'user_id obrigatório para chamadas internas' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      user_id = body_peek.user_id;
    } else if (authHeader?.startsWith('Bearer ')) {
      const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      user_id = userData.user.id;
    } else {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Seller detection: if user is a seller, use their manager's ID for data queries
    const { data: profileData } = await supabase
      .from("profiles")
      .select("role, manager_id")
      .eq("id", user_id)
      .single();

    const isSeller = profileData?.role === "seller" && !!profileData?.manager_id;
    const effectiveUserId = isSeller ? profileData.manager_id : user_id;

    const body = await req.json();
    const {
      list_id,
      contacts,
      check_whatsapp = false,
      source = 'manual',
    } = body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'contacts[] é obrigatório',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[sanitize-contacts] Processing ${contacts.length} contacts for user ${user_id}`);

    const stats = {
      total_input: contacts.length,
      invalid_phones: 0,
      duplicates_in_batch: 0,
      duplicates_in_db: 0,
      whatsapp_invalid: 0,
      total_valid: 0,
    };

    // Step 1: Format phones to E.164 and deduplicate within batch
    const formattedMap = new Map<string, any>();

    for (const contact of contacts) {
      const rawPhone = contact.phone || '';
      const formatted = formatPhoneE164(rawPhone);

      if (!formatted) {
        stats.invalid_phones++;
        continue;
      }

      if (formattedMap.has(formatted)) {
        stats.duplicates_in_batch++;
        // Update with richer data if available
        const existing = formattedMap.get(formatted);
        if (!existing.name && contact.name) existing.name = contact.name;
        if (!existing.group_name && contact.group_name) existing.group_name = contact.group_name;
        continue;
      }

      formattedMap.set(formatted, {
        phone: formatted,
        name: contact.name || null,
        group_name: contact.group_name || null,
        source: contact.source || source,
      });
    }

    console.log(`[sanitize-contacts] After format & batch dedup: ${formattedMap.size} unique phones`);

    // Step 2: Check for duplicates in database
    const phonesToCheck = Array.from(formattedMap.keys());
    const existingPhones = await findExistingPhones(supabase, effectiveUserId, phonesToCheck, list_id);

    // Remove duplicates that already exist in DB
    for (const phone of existingPhones) {
      if (formattedMap.has(phone)) {
        formattedMap.delete(phone);
        stats.duplicates_in_db++;
      }
    }

    console.log(`[sanitize-contacts] After DB dedup: ${formattedMap.size} new contacts`);

    // Step 3: WhatsApp validation (optional)
    if (check_whatsapp && formattedMap.size > 0) {
      const evolutionConfig = await getEvolutionInstance(supabase, effectiveUserId);

      if (evolutionConfig) {
        const phonesForCheck = Array.from(formattedMap.keys());
        // Check in batches of 100
        for (let i = 0; i < phonesForCheck.length; i += 100) {
          const batch = phonesForCheck.slice(i, i + 100);
          const waResults = await checkWhatsAppNumbers(
            evolutionConfig.apiUrl,
            evolutionConfig.apiKey,
            evolutionConfig.instanceName,
            batch
          );

          for (const [phone, exists] of waResults) {
            if (!exists) {
              const contact = formattedMap.get(phone);
              if (contact) {
                contact.is_valid = false;
                stats.whatsapp_invalid++;
              }
            }
          }
        }
      } else {
        console.warn('[sanitize-contacts] No UazAPI instance found, skipping WhatsApp check');
      }
    }

    // Step 4: Prepare final sanitized contacts
    const sanitized = Array.from(formattedMap.values()).map(c => ({
      user_id: effectiveUserId,
      list_id: list_id || null,
      phone: c.phone,
      name: c.name,
      group_name: c.group_name,
      source: c.source,
      is_valid: c.is_valid !== false, // default true unless WhatsApp check says otherwise
    }));

    stats.total_valid = sanitized.length;

    // Step 5: Insert into database if list_id provided
    let insertedCount = 0;
    if (list_id && sanitized.length > 0) {
      for (let i = 0; i < sanitized.length; i += 500) {
        const batch = sanitized.slice(i, i + 500);
        // upsert idempotente: se sobrar algum (user_id,list_id,phone) já existente
        // NESTA lista, ignora em vez de derrubar o lote inteiro.
        const { error: insertErr } = await supabase.from('wa_contacts')
          .upsert(batch, { onConflict: 'user_id,list_id,phone', ignoreDuplicates: true });
        if (insertErr) {
          console.error('[sanitize-contacts] Insert batch error:', insertErr);
        } else {
          insertedCount += batch.length;
        }
      }

      // Update list contact count
      const { count } = await supabase
        .from('wa_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', list_id);

      await supabase
        .from('wa_contact_lists')
        .update({ contact_count: count || 0 })
        .eq('id', list_id);
    }

    console.log(`[sanitize-contacts] Done. Stats:`, stats);

    return new Response(JSON.stringify({
      success: true,
      sanitized: list_id ? undefined : sanitized, // Only return contacts if not auto-inserting
      inserted_count: insertedCount,
      stats,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[sanitize-contacts] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
