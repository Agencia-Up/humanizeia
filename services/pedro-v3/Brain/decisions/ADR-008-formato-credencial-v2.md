# ADR-008 — Formato real de `api_key_encrypted` do Pedro v2 (read-side)

- Status: **aceito** (2026-06-28, F2.5.4A)
- Autor: Claude (executor) · Auditor final: Codex
- Contexto: F2.5.4A exigia criar o decryptor concreto de `platform_integrations.api_key_encrypted`
  **somente se o formato vivo fosse comprovado**, e **não inventar decryptor** caso contrário.

## Achado factual (comprovado por código vivo, read-only)

Apesar do nome `api_key_encrypted`, **a coluna NÃO é criptografada**. O Pedro v2 a lê como **plaintext**:

1. `supabase/functions/_shared/pedro-v2/stockSearch_20260525_photo_flow.ts::parseCredentials`
   faz `JSON.parse(raw)` e devolve o objeto; se não for JSON, usa o **raw como `api_token`**.
   Não há `crypto`, AES, chave ou decifragem — apenas parse.
2. `mediaContext_20260524.ts:336`: `const token = instance.api_key_encrypted || instance.api_key;`
   — usa o valor **direto como token**.
3. `metaSender.ts:29`: `instance.meta_config?.access_token_encrypted || instance.api_key_encrypted || ""`
   — idem, uso direto.

Conteúdo típico (estoque): JSON com `feed_url` (RevendaMais) ou `api_token` (BNDV), OU um token escalar.

## Decisão

1. **Não existe formato criptográfico a comprovar → não se inventa decryptor.** Nenhuma cifra,
   nenhuma chave de ambiente, nenhum AES é assumido (seria invenção).
2. Implementar um **leitor de plaintext** que honra o contrato `SecretDecryptor`
   (`Agent/src/adapters/read/v2-api-key-reader.ts`, classe `V2PlaintextApiKeyReader`):
   - RevendaMais → `feed_url`/`url` (exige URL; sem URL → `null`);
   - BNDV → `api_token`/`token` (JSON) ou o raw escalar;
   - **fail-closed** (payload vazio/sem o campo do provider/provider desconhecido → `null`);
   - **nunca** registra ciphertext, plaintext, chave ou token.
3. O nome do contrato segue `SecretDecryptor`/`decryptApiKey` (já existente, F2.5.3), mas a
   implementação é **explicitamente um parser de plaintext**, documentado como tal.

## Risco / recomendação ao dono (fora do escopo offline)

- **Segredos de integração estão em repouso como PLAINTEXT** no `platform_integrations` do v2.
  Recomenda-se, em fase futura (não offline), migrar para criptografia real em repouso
  (e então um decryptor de verdade substituiria o leitor de plaintext, atrás do mesmo contrato).
- A `service_role` exposta no scratch antigo continua **pendente de rotação/revogação** antes de
  qualquer canary remoto (mantida por decisão do dono até o fim das fases offline).

## Consequências

- O `V2DatabaseCredentialProvider` (F2.5.3) funciona com `V2PlaintextApiKeyReader` sem mudança de contrato.
- Se o formato mudar (criptografia real), basta trocar o adapter `SecretDecryptor` — o resto do
  stack (gateway, credential provider, sources) não muda.
