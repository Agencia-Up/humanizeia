// ============================================================================
// pedroV3Bridge.ctwa-test.ts — F2.32 (CTWA): o bridge extrai o externalAdReply SANITIZADO de vários níveis do payload
//   Meta/uazapi e o forwarda ao v3 (raw.adReferral). Offline, sem rede.
//   Rodar (usa o tsx do Agent): node "services/pedro-v3/Agent/node_modules/tsx/dist/cli.mjs" supabase/functions/_shared/pedro-v2/pedroV3Bridge.ctwa-test.ts
// ============================================================================
import { enrichAdReferralWithSemanticContext, extractAdReferral } from "./pedroV3Bridge.ts";
import { resolvePedroV3AdSemantic } from "./pedroV3AdSemantic.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Payload REAL (podado) — externalAdReply em message.extendedTextMessage.contextInfo.
const payloadExtended = {
  messages: [{
    message: {
      extendedTextMessage: {
        text: "tem esse?",
        contextInfo: {
          conversionSource: "FB_Ads",
          externalAdReply: {
            title: "Fale com nossos consultores",
            body: "Veículos revisados",
            greetingMessageBody: "Olá! Quer saber mais sobre a Ranger XLT TD 3.2 2016?",
            sourceId: "120253981641730460",
            sourceType: "ad",
            sourceUrl: "https://fb.me/c9tWuhhGL",
            originalImageURL: "https://scontent.fbcdn.net/full.jpg",
            thumbnailUrl: "https://scontent.fbcdn.net/s540.jpg",
            jpegThumbnail: "BASE64BLOBSHOULDNOTLEAK...",
          },
        },
      },
    },
  }],
};

// Payload alternativo — externalAdReply em data.message.content.contextInfo (Fase 2 real: leads Ranger/Creta).
const payloadContent = {
  data: {
    message: {
      content: {
        text: "oi",
        contextInfo: {
          externalAdReply: {
            greeting: "Quer saber mais sobre o Jeep Compass?",
            source_id: "999",
            source_url: "https://facebook.com/x",
          },
        },
      },
    },
  },
};

const payloadConversionOnly = {
  messages: [{
    message: {
      extendedTextMessage: {
        text: "Olá! Tenho interesse e queria mais informações, por favor.",
        contextInfo: {
          conversionSource: "ctwa_ad",
          conversionData: "opaque-meta-conversion-data",
          sourceId: "120000000000001",
        },
      },
    },
  }],
};

async function main(): Promise<void> {
  console.log("== F2.32 bridge: extração do externalAdReply (CTWA) ==");

  {
    const ad = extractAdReferral(payloadExtended);
    check("[E-1] extrai greetingMessageBody (com o veículo)", ad != null && (ad.greeting ?? "").includes("Ranger"), `ad=${JSON.stringify(ad)}`);
    check("[E-2] adId = sourceId do Meta", ad?.adId === "120253981641730460");
    check("[E-3] sourceUrl + title + body", ad?.sourceUrl === "https://fb.me/c9tWuhhGL" && ad?.title === "Fale com nossos consultores" && ad?.body === "Veículos revisados");
    check("[E-4] source = conversionSource (FB_Ads)", ad?.source === "FB_Ads");
    check("[E-5] imagens: original + thumbnail (SEM blob base64)", (ad?.imageUrls ?? []).includes("https://scontent.fbcdn.net/full.jpg") && !JSON.stringify(ad).includes("BASE64BLOB"));
  }
  {
    const ad = extractAdReferral(payloadContent);
    check("[C-1] lê externalAdReply de data.message.content.contextInfo", ad != null && (ad.greeting ?? "").includes("Compass"), `ad=${JSON.stringify(ad)}`);
    check("[C-2] aliases source_id / source_url", ad?.adId === "999" && ad?.sourceUrl === "https://facebook.com/x");
  }
  {
    const ad = extractAdReferral(payloadConversionOnly);
    check("[C-3] referral CTWA sem externalAdReply ainda preserva a origem", ad?.source === "ctwa_ad");
    check("[C-4] conversionData opaco não é tratado como veículo nem vaza ao contexto", ad?.vehicleQuery == null && ad?.body == null && ad?.greeting == null);
  }
  {
    const raw = extractAdReferral(payloadExtended)!;
    const ad = enrichAdReferralWithSemanticContext(raw, {
      vehicle_query: "Mitsubishi Pajero TR4 2013",
      vehicle_type: "suv",
      summary: "Arte do anúncio mostra uma Pajero TR4 2013.",
      confidence: 0.91,
      diagnostics: { used_image_inference: true },
    });
    check("[V-1] leitura visual vira fato semântico, não texto do lead", ad.vehicleQuery === "Mitsubishi Pajero TR4 2013" && ad.semanticSource === "image");
    check("[V-2] confiança visual é limitada ao intervalo factual", ad.confidence === 0.91);
  }
  {
    const raw = extractAdReferral(payloadExtended)!;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, init });
      if (!url.includes("api.openai.com")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          vehicle_query: "Ford EcoSport SE 1.5 2020",
          vehicle_type: "suv",
          summary: "Arte mostra EcoSport SE 1.5 2020.",
          confidence: 0.96,
        }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const semantic = await resolvePedroV3AdSemantic(raw, "test-key", { fetcher: fakeFetch, model: "gpt-4.1-mini" });
    const requestBody = JSON.parse(String(calls.find((call) => call.url.includes("api.openai.com"))?.init?.body ?? "{}"));
    check("[V-3] resolvedor visual usa uma leitura factual multimodal", semantic?.vehicle_query === "Ford EcoSport SE 1.5 2020" && calls.length === 2);
    check("[V-4] imagem viaja como data URL, sem depender do download da OpenAI", String(requestBody.messages?.[1]?.content?.[1]?.image_url?.url ?? "").startsWith("data:image/jpeg;base64,"));
  }
  {
    const raw = { ...extractAdReferral(payloadExtended)!, imageUrls: ["https://example.com/private.jpg"] };
    let calls = 0;
    const semantic = await resolvePedroV3AdSemantic(raw, "test-key", {
      fetcher: async (): Promise<Response> => {
        calls += 1;
        return new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/jpeg" } });
      },
    });
    check("[V-5] leitura visual aceita somente CDN factual do Meta", semantic === null && calls === 0);
  }
  {
    check("[N-1] payload SEM anúncio -> null", extractAdReferral({ messages: [{ message: { conversation: "oi" } }] }) === null);
    check("[N-2] payload vazio -> null", extractAdReferral({}) === null);
  }

  console.log(`\n== F2.32 bridge: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
