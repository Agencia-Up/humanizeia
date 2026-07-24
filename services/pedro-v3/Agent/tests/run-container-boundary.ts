// ============================================================================
// run-container-boundary.ts — GUARD DE FRONTEIRA DO CONTAINER (incidente 2026-07-22, produção parada ~27h).
//
// O QUE ACONTECEU: `openai-agent-brain.ts` importava o contrato de política do RAIZ do repositório, com seis `../`:
//     import { TENANT_POLICY_ACTIONS } from "../../../../../../src/lib/pedroFunnelPolicyContract.ts";
// Na máquina de dev resolve. No container NÃO: o Dockerfile copia SOMENTE `Agent/src` para `/app/src`, então os seis
// `../` escapam de `/app` e o Node procura `/src/lib/...` na raiz do filesystem. Log real do EasyPanel:
//     ERR_MODULE_NOT_FOUND: Cannot find module '/src/lib/pedroFunnelPolicyContract.ts'
// O processo morria ANTES de `server.listen` -> crash loop -> healthcheck falhando -> serviço amarelo -> ZERO mensagem
// entrando na v3_inbox. Ninguém percebeu por ~36h porque o container velho seguiu rodando a imagem antiga até reiniciar.
//
// POR QUE NENHUM GATE PEGOU: `tsc` resolve pelo repositório (o arquivo existe!) e `docker build` NÃO executa o código —
// o build fica verde e a falha só aparece em runtime, em produção. Todos os testes passavam.
//
// ESTE GUARD FECHA ISSO: varre `src/` (o que de fato vai para a imagem) e falha se QUALQUER import escapar da pasta.
// É a mesma fronteira que o Dockerfile impõe — agora verificada no test:all, de graça, antes do deploy.
//   npx tsx tests/run-container-boundary.ts
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const AGENT_ROOT = resolve(import.meta.dirname, "..");
const SRC_ROOT = join(AGENT_ROOT, "src");

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Captura o specifier de import/export estático e de import() dinâmico.
const SPEC_RX = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function main(): void {
  const files = allTsFiles(SRC_ROOT);
  check("[BOUNDARY] achou os arquivos de src/", files.length > 20, `${files.length} arquivos`);

  const escapes: string[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(SPEC_RX)) {
      const spec = match[1] ?? match[2];
      if (!spec || !spec.startsWith(".")) continue;   // pacote npm (node_modules vai na imagem via npm ci)
      const target = resolve(dirname(file), spec);
      // O alvo TEM de continuar dentro de src/ — é exatamente o que o `COPY Agent/src ./src` garante.
      if (!target.startsWith(SRC_ROOT)) {
        escapes.push(`${relative(AGENT_ROOT, file)} -> ${spec}`);
      }
    }
  }

  check(
    "[BOUNDARY] NENHUM import de src/ escapa da pasta copiada para a imagem",
    escapes.length === 0,
    escapes.length > 0 ? `${escapes.length} fuga(s): ${escapes.slice(0, 5).join(" | ")}` : "",
  );

  // NÃO-VACUIDADE: se a varredura não estivesse enxergando imports relativos, o teste acima passaria vazio e não
  // provaria nada. Aqui exigimos que ela tenha encontrado imports relativos de verdade dentro de src/.
  let relativos = 0;
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(SPEC_RX)) {
      const spec = match[1] ?? match[2];
      if (spec?.startsWith(".")) relativos += 1;
    }
  }
  check("[BOUNDARY] a varredura realmente le imports relativos (nao-vacuidade)", relativos > 50, `${relativos} imports relativos vistos`);

  // ── PARIDADE DO CONTRATO ──────────────────────────────────────────────────────────────────────────────────────
  // A cópia dentro do Agent existe porque o arquivo do portal está FORA do contexto de build desta imagem. Duas
  // cópias de um CONTRATO divergem com o tempo e produzem bug silencioso — então a divergência falha aqui.
  const canonico = resolve(AGENT_ROOT, "../../../src/lib/pedroFunnelPolicyContract.ts");
  const copia = join(SRC_ROOT, "domain/tenant-policy-contract.ts");
  const norm = (s: string): string => s.replace(/\r\n/g, "\n").trim();
  const canonicoTxt = norm(readFileSync(canonico, "utf8"));
  // A cópia carrega um cabeçalho explicativo; comparamos o CORPO (o contrato em si).
  const copiaTxt = norm(readFileSync(copia, "utf8"));
  const corpoDaCopia = copiaTxt.slice(copiaTxt.indexOf(canonicoTxt.slice(0, 60)));

  check("[PARIDADE] a copia do Agent contem o contrato canonico integral", corpoDaCopia === canonicoTxt,
    corpoDaCopia === canonicoTxt ? "" : `canonico=${canonicoTxt.length} chars, corpo da copia=${corpoDaCopia.length} chars — SINCRONIZE as duas`);

  console.log(`\n== CONTAINER BOUNDARY: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) {
    console.error("\nFALHAS:\n" + fails.map((f) => ` - ${f}`).join("\n"));
    console.error("\nATENCAO: uma fuga aqui derruba o container em PRODUCAO (crash loop antes do listen), mesmo com tsc e build verdes.");
    process.exit(1);
  }
}

main();
