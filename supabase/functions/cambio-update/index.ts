// ============================================================================
// cambio-update — atualiza o cambio USD->BRL em config_cobranca (FASE 2b)
// ----------------------------------------------------------------------------
// Puxa a cotacao do dolar e grava em public.config_cobranca (linha unica id=1):
// cambio_usd_brl + cambio_fonte + cambio_atualizado_em (auditoria: o que veio,
// de QUAL fonte, e quando).
//
// FONTES (todas GRATIS e SEM CHAVE), tentadas EM ORDEM ate uma responder:
//   1. AwesomeAPI (Brasil, escolha do Wander)  -> economia.awesomeapi.com.br
//   2. open.er-api.com (fallback diario)        -> open.er-api.com
//   3. Frankfurter / BCE (fallback dias uteis)  -> api.frankfurter.app
// Motivo do fallback: a AwesomeAPI no tier sem-chave devolve HTTP 429 quando o
// IP de egress (compartilhado entre projetos Supabase) estoura o limite. O
// fallback garante que o cambio atualiza mesmo assim. A fonte que de fato
// respondeu fica gravada em cambio_fonte (rastreavel).
//
// So escreve no banco do PROPRIO projeto (SUPABASE_URL do ambiente). Nao toca
// no Pedro nem em saldo de ninguem. Idempotente: sempre UPDATE da linha id=1.
// Dinheiro/cambio em NUMERIC no banco; validamos numerico + faixa sana antes.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Faixa de sanidade: se a fonte devolver algo absurdo (0, 999, etc), descarta.
// O dolar comercial fica historicamente entre ~3 e ~12 BRL. Trava defensiva.
const CAMBIO_MIN = 3.0;
const CAMBIO_MAX = 12.0;

type FonteResult = { cambio: number; fonte: string; extra?: unknown } | null;

// --- Fonte 1: AwesomeAPI (Brasil, escolha do Wander) ------------------------
async function fromAwesomeApi(): Promise<FonteResult> {
  const resp = await fetch("https://economia.awesomeapi.com.br/last/USD-BRL", {
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`AwesomeAPI HTTP ${resp.status}`);
  const json = await resp.json();
  const q = json?.USDBRL;
  const bid = Number(q?.bid);
  if (!Number.isFinite(bid)) throw new Error("AwesomeAPI sem USDBRL.bid");
  return { cambio: bid, fonte: "awesomeapi", extra: { create_date: q?.create_date ?? null } };
}

// --- Fonte 2: open.er-api.com (gratis, sem chave, atualizacao diaria) -------
async function fromOpenErApi(): Promise<FonteResult> {
  const resp = await fetch("https://open.er-api.com/v6/latest/USD", {
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`open.er-api HTTP ${resp.status}`);
  const json = await resp.json();
  const brl = Number(json?.rates?.BRL);
  if (json?.result !== "success" || !Number.isFinite(brl)) {
    throw new Error("open.er-api sem rates.BRL");
  }
  return { cambio: brl, fonte: "open.er-api.com", extra: { time_last_update_utc: json?.time_last_update_utc ?? null } };
}

// --- Fonte 3: Frankfurter / BCE (gratis, sem chave, dias uteis) -------------
async function fromFrankfurter(): Promise<FonteResult> {
  const resp = await fetch("https://api.frankfurter.app/latest?from=USD&to=BRL", {
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Frankfurter HTTP ${resp.status}`);
  const json = await resp.json();
  const brl = Number(json?.rates?.BRL);
  if (!Number.isFinite(brl)) throw new Error("Frankfurter sem rates.BRL");
  return { cambio: brl, fonte: "frankfurter", extra: { date: json?.date ?? null } };
}

const FONTES: Array<{ nome: string; fn: () => Promise<FonteResult> }> = [
  { nome: "awesomeapi", fn: fromAwesomeApi },
  { nome: "open.er-api.com", fn: fromOpenErApi },
  { nome: "frankfurter", fn: fromFrankfurter },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tentativas: Array<{ fonte: string; erro: string }> = [];
  let escolhido: FonteResult = null;

  // 1. Tenta as fontes em ordem; primeira com valor numerico SANO vence.
  for (const f of FONTES) {
    try {
      const r = await f.fn();
      if (r && Number.isFinite(r.cambio) && r.cambio >= CAMBIO_MIN && r.cambio <= CAMBIO_MAX) {
        escolhido = r;
        break;
      }
      tentativas.push({ fonte: f.nome, erro: r ? `fora da faixa (${r.cambio})` : "sem valor" });
    } catch (err: any) {
      tentativas.push({ fonte: f.nome, erro: err?.message || "erro" });
    }
  }

  if (!escolhido) {
    return new Response(
      JSON.stringify({ error: "Nenhuma fonte de cambio respondeu", tentativas }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // config_cobranca.cambio_usd_brl e numeric(10,4) -> 4 casas
  const cambio = Number(escolhido.cambio.toFixed(4));

  // 2. Grava na linha unica (id=1) com a fonte que respondeu + carimbo de tempo
  const { data: updated, error: upErr } = await supabase
    .from("config_cobranca")
    .update({
      cambio_usd_brl: cambio,
      cambio_fonte: escolhido.fonte,
      cambio_atualizado_em: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("cambio_usd_brl, cambio_fonte, cambio_atualizado_em")
    .maybeSingle();

  if (upErr) {
    return new Response(
      JSON.stringify({ error: "Falha ao gravar config_cobranca", detail: upErr.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (!updated) {
    return new Response(
      JSON.stringify({ error: "config_cobranca id=1 nao existe (rodar migration de seed antes)" }),
      { status: 412, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      cambio_usd_brl: updated.cambio_usd_brl,
      cambio_fonte: updated.cambio_fonte,
      cambio_atualizado_em: updated.cambio_atualizado_em,
      fonte_extra: escolhido.extra ?? null,
      tentativas_antes: tentativas, // auditoria: o que falhou antes da que venceu
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
});
