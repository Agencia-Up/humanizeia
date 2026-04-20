-- ============================================================
-- Segmento Automotivo para o Agente José
-- Adaptado para a estrutura real da tabela jose_segment_profiles
-- ============================================================

-- Adiciona colunas que podem não existir ainda
ALTER TABLE public.jose_segment_profiles
  ADD COLUMN IF NOT EXISTS seasonal_insights JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Insert ou Update do segmento automotivo
INSERT INTO public.jose_segment_profiles (slug, name, icon, description, benchmarks, rules, seasonal_insights, knowledge_base)
VALUES (
  'automotivo',
  'Automotivo',
  '🚗',
  'Segmento para concessionárias, revendas e lojas de veículos. Estratégia focada em geração de conversas via WhatsApp com objetivo de engajamento. Modelo de captação ampla com conversão manual no atendimento.',

  '{
    "cpl_otimo": 5,
    "cpl_bom": 8,
    "cpl_critico": 12,
    "ctr_fraco": 0.8,
    "ctr_bom": 1.5,
    "ctr_excelente": 2.5,
    "cpc_bom": 1.50,
    "cpc_otimo": 0.80,
    "frequencia_alerta": 3.5,
    "conversao_meta": "Conversa iniciada no WhatsApp",
    "objetivo_campanha": "MESSAGES (Engajamento para WhatsApp)"
  }'::jsonb,

  '[
    "OBJETIVO DE CAMPANHA: Sempre usar objetivo de Engajamento direcionado para mensagens no WhatsApp. Nunca usar objetivo de conversão direta no anúncio.",
    "CPL ALVO: Manter custo por conversa entre R$5 e R$8. Pausar imediatamente qualquer anúncio com custo acima de R$8.",
    "ESCALA: Duplicar anúncios com custo abaixo de R$5 para escalar o que está funcionando. Nunca editar campanhas que já performam bem.",
    "ORÇAMENTO: Escalar sempre via duplicação de campanhas e aumento gradual de orçamento. Nunca fazer grandes saltos de budget de uma vez.",
    "CONJUNTOS DE ANÚNCIOS: Organizar por categoria de veículos. Conjunto 1: veículos de entrada (baixo valor). Conjunto 2: sedans. Conjunto 3: SUVs. Conjunto 4: veículos até determinado valor. Não misturar categorias no mesmo conjunto.",
    "VOLUME POR CONJUNTO: Cada conjunto deve conter entre 7 a 8 opções de veículos diferentes para diluir custo e aumentar probabilidade de interação.",
    "CRIATIVOS: Cada anúncio deve deixar claro qual é o veículo. Estrutura obrigatória: (1) Título com nome do carro e principal atrativo; (2) Subtítulo com ano, versão ou condição; (3) CTA direto incentivando contato. Evitar criativos genéricos sem clareza de oferta.",
    "FADIGA CRIATIVA: Monitorar frequência — alertar se ultrapassar 3.5x. Rotacionar criativos para evitar saturação do público.",
    "QUALIFICAÇÃO DE LEAD: Incluir filtros leves nos criativos para reduzir curiosos: informação de entrada, faixa de parcela ou condição específica da oferta.",
    "SEGMENTAÇÃO GEOGRÁFICA: NUNCA anunciar para todo o Brasil. Segmentação deve ser regional — cidade, raio ou estado onde a loja atua. Expandir apenas com aprovação explícita.",
    "PÚBLICO: Segmentação ampla ou baseada em interesses relacionados a carros. Faixa etária recomendada: 25-55 anos.",
    "MODELO DE NEGÓCIO: Não buscar venda direta no anúncio. O objetivo é gerar interesse para iniciar conversa. A qualificação e fechamento são feitos manualmente pelo time de atendimento no WhatsApp.",
    "WHATSAPP: Orientar sobre abertura com mensagem direcionada — perguntar qual veículo chamou mais atenção e oferecer opções similares. Isso acelera a conversa e melhora a conversão."
  ]'::jsonb,

  '[
    {"period": "dec", "insight": "Dezembro: mercado automotivo aquecido. Aumentar budget e explorar ofertas de fim de ano e IPVA."},
    {"period": "jan-feb", "insight": "Jan-Fev: pico de IPVA gera intenção de troca. Explorar mensagens sobre troca de veículo e financiamento facilitado."},
    {"period": "mar", "insight": "Março: Salão do Automóvel e lançamentos de novos modelos. Bom período para criativos com novidades."},
    {"period": "jun-jul", "insight": "Férias de julho: público com tempo livre, maior engajamento. Bom para campanhas de SUVs e modelos família."},
    {"period": "oct-nov", "insight": "Out-Nov: Black Friday automotiva. Criar urgência com condições especiais e promoções de fim de ano."}
  ]'::jsonb,

  '{
    "cpl_min": 3,
    "cpl_max": 8,
    "cpl_optimal": 5,
    "cpa_min": 0,
    "cpa_max": 500,
    "cpa_optimal": 200,
    "budget_daily_min": 50,
    "budget_daily_max": 1000,
    "geo_type": "cities",
    "geo_cities": [],
    "geo_states": [],
    "geo_radius_km": 50,
    "geo_center_city": "",
    "geo_exclude_cities": [],
    "age_min": 25,
    "age_max": 55,
    "gender": "all",
    "interests": ["Automóveis", "Carros", "Compra de veículos", "Financiamento de veículos", "Concessionárias"],
    "behaviors": ["Intenção de compra de veículo", "Compradores de carros usados", "Compradores de carros novos"],
    "creative_rotation_days": 21,
    "max_frequency": 3.5,
    "custom_rules": [
      "Pausar anúncios com CPL > R$8",
      "Duplicar anúncios com CPL < R$5",
      "Organizar conjuntos por categoria: entrada, sedan, SUV, faixa de preço",
      "Cada conjunto: 7 a 8 veículos diferentes",
      "Nunca editar campanha que está performando bem — duplicar para escalar",
      "Incluir filtros leves: entrada, parcela ou condição especial no criativo"
    ]
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name              = EXCLUDED.name,
  icon              = EXCLUDED.icon,
  description       = EXCLUDED.description,
  benchmarks        = EXCLUDED.benchmarks,
  rules             = EXCLUDED.rules,
  seasonal_insights = EXCLUDED.seasonal_insights;
