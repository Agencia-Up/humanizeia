const fs = require('fs');
const file = 'e:\\Projetos - Antigravity\\HUMANIZEIA\\humanizeia\\supabase\\functions\\wa-inbox-webhook\\index.ts';
let content = fs.readFileSync(file, 'utf8');
const isCRLF = content.includes('\r\n');

content = content.replace(
  'const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");',
  'const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");\n    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");'
);

content = content.replace(
  'if (!mediaFallbackReply && !isAnthropicModel && !LOVABLE_API_KEY) {',
  'if (!mediaFallbackReply && !isAnthropicModel && !LOVABLE_API_KEY && !OPENAI_API_KEY) {'
);

content = content.replace(
  'console.error("[ai-agent] LOVABLE_API_KEY not configured");',
  'console.error("[ai-agent] LOVABLE_API_KEY and OPENAI_API_KEY not configured");'
);

const fetchReplacement = `        let fetchUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
        let fetchAuth = \`Bearer \${LOVABLE_API_KEY}\`;
        let fetchModel = model;

        if (!LOVABLE_API_KEY && OPENAI_API_KEY && (isModelOpenAI || model.includes('gpt'))) {
           fetchUrl = "https://api.openai.com/v1/chat/completions";
           fetchAuth = \`Bearer \${OPENAI_API_KEY}\`;
           fetchModel = model.replace("openai/", "");
        }

        const res = await fetch(fetchUrl, {
          method: "POST",
          headers: {
            Authorization: fetchAuth,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...basePayload, ...tokenParam, model: fetchModel }),
        });`;

const origFetch = `        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: \`Bearer \${LOVABLE_API_KEY}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...basePayload, ...tokenParam, model }),
        });`;

content = content.replace(origFetch, fetchReplacement);

fs.writeFileSync(file, content);
console.log('Fixed wa-inbox-webhook');
