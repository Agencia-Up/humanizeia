import { describe, expect, it } from "vitest";
import {
  isSellerAckText,
  resolveUazapiPhone,
  resolveUazapiRemoteJid,
} from "../../supabase/functions/_shared/pedro-v2/phone";

describe("Pedro V2 UAZAPI phone resolver", () => {
  it("uses senderPn when remoteJid is a WhatsApp LID", () => {
    const payload = {
      data: {
        key: {
          remoteJid: "168856723177632@lid",
          senderPn: "5512997732236@s.whatsapp.net",
        },
      },
    };

    expect(resolveUazapiRemoteJid(payload)).toBe("5512997732236@s.whatsapp.net");
    expect(resolveUazapiPhone(payload)).toBe("5512997732236");
  });

  it("uses remoteJidAlt when remoteJid is a WhatsApp LID", () => {
    const payload = {
      data: {
        key: {
          remoteJid: "168856723177632@lid",
          remoteJidAlt: "5512982624621@s.whatsapp.net",
        },
      },
    };

    expect(resolveUazapiRemoteJid(payload)).toBe("5512982624621@s.whatsapp.net");
    expect(resolveUazapiPhone(payload)).toBe("5512982624621");
  });

  it("prefers remoteJidAlt on fromMe messages to keep the lead phone", () => {
    const payload = {
      data: {
        key: {
          fromMe: true,
          remoteJid: "168856723177632@lid",
          remoteJidAlt: "5512988627923@s.whatsapp.net",
          senderPn: "5512999990000@s.whatsapp.net",
        },
      },
    };

    expect(resolveUazapiRemoteJid(payload)).toBe("5512988627923@s.whatsapp.net");
    expect(resolveUazapiPhone(payload)).toBe("5512988627923");
  });

  it("keeps normal WhatsApp JID unchanged", () => {
    const payload = {
      data: {
        key: {
          remoteJid: "5512991422219@s.whatsapp.net",
        },
      },
    };

    expect(resolveUazapiRemoteJid(payload)).toBe("5512991422219@s.whatsapp.net");
    expect(resolveUazapiPhone(payload)).toBe("5512991422219");
  });
});

describe("seller acknowledgement text", () => {
  it("accepts clear seller confirmations", () => {
    expect(isSellerAckText("ok")).toBe(true);
    expect(isSellerAckText("confirmo")).toBe(true);
    expect(isSellerAckText("pode deixar")).toBe(true);
    expect(isSellerAckText("👍")).toBe(true);
  });

  it("does not accept seller questions as confirmation", () => {
    expect(isSellerAckText("quem e esse cliente?")).toBe(false);
    expect(isSellerAckText("qual carro ele quer?")).toBe(false);
    expect(isSellerAckText("me manda mais dados")).toBe(false);
  });
});
