// Testes do splitter de mensagens (IT-1.1 do plano de humanização).

import { describe, it, expect } from "vitest";
import { splitMessageForHumanization } from "../../supabase/functions/_shared/humanization/messageSplit";

describe("splitMessageForHumanization", () => {
  describe("nao divide quando nao deve", () => {
    it("texto vazio retorna ['']", () => {
      expect(splitMessageForHumanization("")).toEqual([""]);
    });

    it("string com so espacos retorna ['']", () => {
      expect(splitMessageForHumanization("   \n  ")).toEqual([""]);
    });

    it("texto curto (abaixo de minLength) nao divide", () => {
      const short = "Oi! Sou o Pedro. Como posso ajudar?";
      expect(splitMessageForHumanization(short)).toEqual([short]);
    });

    it("texto longo mas com 1 frase so nao divide", () => {
      const oneSentence =
        "Esse Civic Touring 2022 prata com 38000 km esta em otimo estado de conservacao e tem todas as revisoes em dia feitas na concessionaria autorizada";
      expect(splitMessageForHumanization(oneSentence)).toEqual([oneSentence]);
    });

    it("respeita minLength customizado", () => {
      const text = "Frase um. Frase dois. Frase tres.";
      // 33 chars — abaixo de 50, nao divide
      expect(splitMessageForHumanization(text, { minLength: 50 })).toEqual([
        text,
      ]);
    });
  });

  describe("divide corretamente em multiplas frases", () => {
    it("texto longo com 3 frases vira 3 partes (maxParts=3)", () => {
      const text =
        "Temos o Onix LT Turbo 2022, prata, com apenas 38 mil km rodados. " +
        "O preco esta em R$ 78.900 a vista ou facilitamos com entrada e parcelas. " +
        "Voce esta pensando em comprar a vista, financiar ou trocar seu carro atual?";
      const parts = splitMessageForHumanization(text);
      expect(parts).toHaveLength(3);
      parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
    });

    it("texto com 5 frases respeita maxParts=2", () => {
      const text =
        "Primeira frase grande aqui sim demais bem grande. " +
        "Segunda frase tambem grande aqui demais. " +
        "Terceira frase ainda grande aqui sim! " +
        "Quarta frase grande aqui tambem demais. " +
        "Quinta frase grande aqui demais bem grande.";
      const parts = splitMessageForHumanization(text, { maxParts: 2 });
      expect(parts.length).toBeLessThanOrEqual(2);
      expect(parts.length).toBeGreaterThan(0);
    });

    it("nao quebra dentro de R$ 12.500,00", () => {
      const text =
        "Olha esse Onix bonito demais. O valor esta em R$ 12.500,00 para sair daqui ja licenciado. " +
        "Voce quer agendar uma visita pra ver de perto e fazer test drive hoje ainda?";
      const parts = splitMessageForHumanization(text);
      // nenhuma parte pode terminar em "R$ 12" ou comecar com "500,00"
      const joined = parts.join(" | ");
      expect(joined).toContain("R$ 12.500,00");
      parts.forEach((p) => {
        expect(p).not.toMatch(/^[\d,]+/);
      });
    });

    it("nao quebra dentro de site.com.br", () => {
      const text =
        "Pra ver o detalhe acesse logoscar.com.br quando puder. " +
        "Te mando o link tambem por aqui no whats pra facilitar pra voce.";
      const parts = splitMessageForHumanization(text, { minLength: 50 });
      const joined = parts.join(" | ");
      expect(joined).toContain("logoscar.com.br");
    });

    it("divide em \\n+ tambem", () => {
      const text =
        "Boas noticias!\n\nTemos 3 opcoes pra voce no estoque hoje. Posso te mostrar agora ou prefere amanha de manha?";
      const parts = splitMessageForHumanization(text, { minLength: 50 });
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]).toContain("Boas noticias");
    });

    it("preserva pontuacao no final de cada parte", () => {
      const text =
        "Tudo bem? Como voce esta hoje? Posso te ajudar com algum modelo especifico ou voce ja viu algo que gostou no nosso site essa semana?";
      const parts = splitMessageForHumanization(text, { minLength: 50 });
      parts.forEach((p) => {
        // ultima parte pode terminar em qualquer pontuacao incl. ?
        expect(p).toMatch(/[.!?]\s*$/);
      });
    });
  });

  describe("edge cases", () => {
    it("nunca retorna array vazio", () => {
      expect(splitMessageForHumanization("").length).toBe(1);
      expect(splitMessageForHumanization("x").length).toBe(1);
      expect(splitMessageForHumanization("a b c").length).toBe(1);
    });

    it("nunca retorna parte vazia ou whitespace", () => {
      const inputs = [
        "Oi.   Tudo bem.   Vamos la.",
        "frase 1.\n\n\nfrase 2.\n\nfrase 3.",
        "Tem o civic. Tem o onix.",
      ];
      inputs.forEach((input) => {
        const parts = splitMessageForHumanization(input, { minLength: 10 });
        parts.forEach((p) => {
          expect(p.trim().length).toBeGreaterThan(0);
        });
      });
    });

    it("maxParts=1 sempre retorna 1 parte", () => {
      const text =
        "Frase um aqui maior. Frase dois aqui maior tambem. Frase tres aqui maior demais.";
      expect(splitMessageForHumanization(text, { maxParts: 1, minLength: 10 })).toHaveLength(1);
    });

    it("texto com emojis nao quebra mal", () => {
      const text =
        "Oi! 😊 Tudo bem por ai? Tenho 3 carros otimos pra te mostrar hoje na loja: Onix, Tracker e Compass 🚗 Quer ver fotos?";
      const parts = splitMessageForHumanization(text, { minLength: 50 });
      const joined = parts.join(" ");
      expect(joined).toContain("😊");
      expect(joined).toContain("🚗");
    });
  });
});
