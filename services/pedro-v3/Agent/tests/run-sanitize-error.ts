import { sanitizeTurnError } from "../src/runtime/sanitize-error.ts";

let ok = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok += 1; console.log(`OK  ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`); }
}

// 1. Erro tipado (name + code) sai legivel.
class FakeTyped extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SupabaseServiceGatewayError"; }
}
const t1 = sanitizeTurnError(new FakeTyped("HTTP_FAILURE"));
check("erro tipado vira 'Name:code: msg'", t1 === "SupabaseServiceGatewayError:HTTP_FAILURE: HTTP_FAILURE", t1);

// 2. Redige chave sk-.
const t2 = sanitizeTurnError(new Error("auth failed with key sk-proj-ABCDEF1234567890 boom"));
check("redige chave sk-", !/sk-proj-ABCDEF1234567890/.test(t2) && /sk-\*\*\*/.test(t2), t2);

// 3. Redige JWT eyJ.
const t3 = sanitizeTurnError(new Error("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig rejected"));
check("redige JWT eyJ", !/eyJhbGciOiJIUzI1NiI/.test(t3) && /jwt-\*\*\*/.test(t3), t3);

// 4. Redige Bearer.
const t4 = sanitizeTurnError(new Error("header Authorization: Bearer abcdef1234567890 invalid"));
check("redige Bearer", !/Bearer abcdef1234567890/.test(t4) && /Bearer \*\*\*/i.test(t4), t4);

// 5. Trunca em 300 chars.
const t5 = sanitizeTurnError(new Error("x".repeat(1000)));
check("trunca em 300 chars", t5.length === 300, `len=${t5.length}`);

// 6. Input nao-Error vira string segura.
const t6 = sanitizeTurnError("plain string boom");
check("input nao-Error vira string", t6 === "Error: plain string boom", t6);
const t7 = sanitizeTurnError(null);
check("input null nao quebra", typeof t7 === "string" && t7.startsWith("Error:"), t7);

console.log(`=== SANITIZE ERROR: ${ok} OK | ${failed} FALHA ===`);
if (failed > 0) process.exit(1);
