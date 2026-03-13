

## Diagnóstico: Biblioteca de Criativos sem fotos

### Problema encontrado

Dois problemas combinados:

1. **Contas Meta inativas**: Ambas as contas na tabela `ad_accounts` estão com `is_active: false`. Quando isso acontece, `useMetaConnection` retorna `connectedAccount: null`, e a página mostra a tela "Conecte seu Meta Ads" em vez dos dados em cache.

2. **Cache sem URLs de imagem de alta resolução**: O cache (`ads_creatives`) tem 50 anúncios armazenados, porém os dados do criativo só contêm `thumbnail_url` (formato p64x64, baixa resolução). Os campos `full_picture`, `image_url` e `effective_image_url` vieram como `null` da API do Meta. A função `getHighResThumbnail` tenta transformar p64x64 para p960x960, mas essa manipulação de URL nem sempre funciona no CDN da Meta.

### Plano de correção

**Arquivo: `src/pages/CreativeLibrary.tsx`**

1. Exibir dados do cache mesmo quando a conta está desconectada, com um banner de aviso pedindo reconexão para dados atualizados. Atualmente a tela "Conecte seu Meta Ads" bloqueia completamente o acesso ao cache existente.

2. Alterar a lógica do `enabled` no `useMetaCachedQuery` para sempre ler o cache (mesmo sem conta ativa), mas só tentar buscar dados frescos quando conectado.

**Arquivo: `src/hooks/useMetaCachedQuery.ts`**

3. Separar a leitura do cache (sempre habilitada) da busca de dados frescos (só quando `enabled: true`). Isso garante que dados em cache sejam exibidos instantaneamente mesmo sem conexão ativa.

**Arquivo: `src/pages/CreativeLibrary.tsx` (imagens)**

4. Adicionar fallback robusto para URLs de imagem: tentar carregar via `thumbnail_url` transformada, e se falhar (evento `onError` no `<img>`), voltar à URL original p64x64. Também solicitar o campo `object_story_spec` da API, que contém URLs de imagem mais confiáveis.

### Detalhes técnicos

A chave do cache `ads_creatives` tem 50 itens salvos às 15:27 de hoje. Os dados estão lá, mas a UI não os mostra porque a verificação `isConnected` bloqueia tudo antes de chegar ao `useMetaCachedQuery`.

Fluxo corrigido:
```text
Página carrega
  ├─ Lê cache (sempre) → mostra dados salvos imediatamente
  ├─ Conta ativa? 
  │   ├─ Sim → busca dados frescos em background
  │   └─ Não → mostra banner "Reconecte para atualizar"
  └─ Imagem com fallback: effective_image_url → image_url → full_picture → thumbnail (p960) → thumbnail (original)
```

