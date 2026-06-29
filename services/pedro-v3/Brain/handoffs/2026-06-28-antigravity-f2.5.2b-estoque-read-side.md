# Handoff: Conclusão da Fase F2.5.2B - Read-Side de Estoque Seguro

Data: 27 de Junho de 2026  
Autor: Antigravity (Advanced Agentic Coding Team)  
Fase: F2.5.2B  
Status: **Aprovado em Auditoria Técnica**

---

## 1. Escopo Entregue

A Fase F2.5.2B foi implementada de ponta a ponta no Pedro v3 seguindo as especificações rigorosas de segurança, fail-closed e estabilidade de identidade:

1. **Identidade Estável de Veículos**:
   - Geração de `vehicleKey` baseada em `source + ":" + (externalVehicleId | fingerprint)`.
   - Mapeamento robusto dos IDs estáveis:
     - **RevendaMais**: `vehicle_id` (inteiro imutável).
     - **BNDV**: `vehicleExternalKey` (UUID estável).
   - Fallback para **fingerprint determinístico** baseado em atributos não voláteis (`marca`, `modelo`, `versão`, `ano`, `cor`, `combustível`, `câmbio`) caso o ID externo falhe.
   - Detecção ativa de **veículos ambíguos** (colisões de fingerprint) marcando `ambiguous = true` e proibindo fotos cruzadas ou envios de fotos automáticos para proteger a experiência comercial do cliente.

2. **Classificador de Carrocerias/Categoria**:
   - Um classificador principiado de carrocerias (`classifyVehicleType`) com dois níveis:
     1. Busca direta nos campos de origem (`body_type` ou `subCategoryName`) com proveniência `"source_field"` e confiança `1.0`.
     2. Classificador por modelo/versão com pesos e termos típicos, proveniência `"derived"` e confiança `0.9`.
     - Fallback seguro para `"unknown"` com proveniência `"unknown"` e confiança `0.0`.
   - Garantia de que `"unknown"` nunca casa com SUV/Sedan/Hatch em buscas rígidas.

3. **HTTP Client Seguro (Anti-SSRF)**:
   - HTTPS obrigatório.
   - Allowlist de domínios estrita: `app.revendamais.com.br` e `api-estoque.azurewebsites.net`.
   - Resolução DNS ativa barrando IPs privados, link-local, loopback e metadados de nuvem em tempo real (anti-SSRF).
   - Controle manual e re-validado de redirecionamentos (máximo de 3 redirects).
   - Proteção contra DoS via limite de bytes consumidos (máximo 15MB por feed).
   - Sanitização total de exceções para impedir vazamento de tokens e credenciais.

4. **Cache LRU e Isolamento**:
   - Cache em memória `ReadCache` tenant-scoped e provider-scoped.
   - Clock injetável e TTL estrito.
   - Mecanismo **single-flight** integrado para aglutinar requisições simultâneas ao feed de estoque do mesmo tenant.
   - Capacidade LRU com despejo automático e flag de ativação.

5. **Contratos e Fontes**:
   - Criação de `StockSource`, `VehicleDetailSource`, `VehiclePhotoSource` e mapeadores normativos.
   - Injeção dinâmica de `V2ReadGateway` para obter de forma fail-closed as configurações e credenciais ativas do tenant via `stockSecretRef`.

---

## 2. Gates e Cobertura de Testes

- **Compilação**: `npx tsc --noEmit` limpa e com tipagem estrita de TypeScript.
- **Suíte de Testes (run-read-side.ts)**: Ampliada de 54 para **75 testes**, cobrindo cenários de:
  - SSRF, teto de bytes e timeouts.
  - Bloqueio de hosts perigosos e HTTP comum.
  - Decodificação de veículos com preço/ano nulo ou menor/igual a zero (filtrados).
  - Casamento estrito (tokens de versão) e busca ampla (`broad = true`) preservando teto de preço e carroceria.
  - Resolvedor de fotos baseado em hash de pathname (ignora chaves de re-assinatura dinâmicas).
  - Veículos duplicados sem ID (ambiguidade).
- **Mapeamento de Gates Locais**:
  - `npm run test:all` -> **289 OK | 0 FALHA**
    - 67 Kernel
    - 92 Fase 2 (Outbox, Reconciler e Gates)
    - 34 SQL Postgres Patches
    - 21 Postgres Adapters
    - 75 Read-Side F2.5.2A + F2.5.2B

---

## 3. Decisões de Design Importantes

1. **Preço e Ano Ausentes**:
   - Conforme especificação, veículos sem preço ou ano não entram como fatos de oferta firme. No decoder e mapeador, se `year === null` ou `saleValue === null` ou `<= 0`, o veículo é filtrado e descartado do pool de busca do SDR.
2. **Re-assinatura de URLs**:
   - Para resolver fotos expiráveis, as URLs brutas são indexadas por hashes de pathname. Quando o lead pede as URLs reais das fotos, o resolvedor reconstrói a lista a partir do feed atualizado e bate as chaves de pathname, devolvendo a URL ativa com a assinatura vigente do momento.
3. **Isolamento de Fotos**:
   - Se o veículo for considerado ambíguo por colisão de fingerprint (unidades idênticas sem ID), nenhuma foto é exposta, evitando confusão ou cruzamento de imagens de veículos diferentes.

---

## 4. Próximos Passos (Fase 2.5.2C)

A próxima etapa é a integração do CRM Read-only seguro, obtendo informações do lead e do histórico sem efeitos colaterais de escrita e sem banco real de escrita ativo.
