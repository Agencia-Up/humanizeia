// Testes offline da classificacao/canonicalizacao da sync UAZAPI. Deno, sem rede.
//   deno run classify.offline-test.ts
import { classifyActor, isGroupOrSpecial, logosPhoneKey, mapMessageType, msgTs, type V3Sig } from "./classify.ts";

let ok = 0, failed = 0;
const check = (n: string, p: boolean) => { p ? (ok++, console.log("  OK  " + n)) : (failed++, console.error("  RED " + n)); };

console.log("Sync UAZAPI — helpers puros");

// logos_phone_key: com/sem 55, 9o digito; nunca last-8 puro p/ numero normal
check("key: 5512997971988 -> 1297971988", logosPhoneKey("5512997971988") === "1297971988");
check("key: 12997971988 (sem 55) == com 55", logosPhoneKey("12997971988") === logosPhoneKey("5512997971988"));
check("key: JID 5512997971988@s.whatsapp.net", logosPhoneKey("5512997971988@s.whatsapp.net") === "1297971988");
check("key: len 10 (DDD+8)", logosPhoneKey("1297971988").length === 10);

// exclusao de grupo/status/broadcast/newsletter
check("grupo por @g.us", isGroupOrSpecial({ wa_chatid: "120363000000@g.us" }) === true);
check("grupo por flag wa_isGroup", isGroupOrSpecial({ wa_chatid: "551299@s.whatsapp.net", wa_isGroup: true }) === true);
check("broadcast", isGroupOrSpecial({ wa_chatid: "551299@broadcast" }) === true);
check("newsletter", isGroupOrSpecial({ wa_chatid: "abc@newsletter" }) === true);
check("privado normal NAO e grupo", isGroupOrSpecial({ wa_chatid: "5512997971988@s.whatsapp.net" }) === false);

// tipo de midia
check("ImageMessage -> image", mapMessageType("ImageMessage") === "image");
check("AudioMessage/ptt -> audio", mapMessageType("PttMessage") === "audio" && mapMessageType("AudioMessage") === "audio");
check("DocumentMessage -> document", mapMessageType("DocumentMessage") === "document");
check("Conversation -> text", mapMessageType("Conversation") === "text");

// timestamp: aceita segundos e ms
check("ts em ms", msgTs({ messageTimestamp: 1785326179000 }) === 1785326179000);
check("ts em segundos -> ms", msgTs({ messageTimestamp: 1785326179 }) === 1785326179000);

// AUTORIA por evidencia (nunca pela instancia)
const v3map = new Map<string, V3Sig[]>();
const key = logosPhoneKey("5512997971988");
const bucket = Math.floor(1785326179000 / 60000);
v3map.set(key, [{ b: bucket, t: "ola, tudo bem?" }]);
check("cliente: fromMe=false", classifyActor({ fromMe: false, text: "oi" }, key, v3map).actor === "cliente");
check("ia_v3: fromMe=true casa assinatura V3", classifyActor({ fromMe: true, text: "Ola, tudo bem?", messageTimestamp: 1785326179000 }, key, v3map).actor === "ia_v3");
check("humano_manual: fromMe=true SEM casar V3", classifyActor({ fromMe: true, text: "vou te ligar", messageTimestamp: 1785326179000 }, key, v3map).actor === "humano_manual");
check("humano_manual: fromMe=true sem assinaturas (nunca IA por instancia)", classifyActor({ fromMe: true, text: "x", messageTimestamp: 1785326179000 }, "9999999999", v3map).actor === "humano_manual");
check("direcao: fromMe=false incoming / true outgoing", classifyActor({ fromMe: false }, key, v3map).dir === "incoming" && classifyActor({ fromMe: true }, key, v3map).dir === "outgoing");

console.log(`\nRESULT ok=${ok} failed=${failed}`);
if (failed > 0) Deno.exit(1);
