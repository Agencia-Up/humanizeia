// ============================================================================
// pedroV3Bridge.ctwa-test.ts — F2.32 (CTWA): o bridge extrai o externalAdReply SANITIZADO de vários níveis do payload
//   Meta/uazapi e o forwarda ao v3 (raw.adReferral). Offline, sem rede.
//   Rodar (usa o tsx do Agent): node "services/pedro-v3/Agent/node_modules/tsx/dist/cli.mjs" supabase/functions/_shared/pedro-v2/pedroV3Bridge.ctwa-test.ts
// ============================================================================
import { extractAdReferral } from "./pedroV3Bridge.ts";

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
    check("[N-1] payload SEM anúncio -> null", extractAdReferral({ messages: [{ message: { conversation: "oi" } }] }) === null);
    check("[N-2] payload vazio -> null", extractAdReferral({}) === null);
  }

  console.log(`\n== F2.32 bridge: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
