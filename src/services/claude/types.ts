export interface AgentInstruction {
  id: string;
  platform: 'meta' | 'google' | 'tiktok';
  action: string;
  params: Record<string, unknown>;
  priority: number;
  dependsOn?: string[];
  reason?: string;
}

export interface CampaignContext {
  product: string;
  productDescription?: string;
  price?: number;
  landingPageUrl?: string;
  objective: 'vendas' | 'leads' | 'trafego' | 'awareness';
  targetAudience: string;
  ageRange?: { min: number; max: number };
  locations?: string[];
  interests?: string[];
  budget: number;
  budgetType: 'daily' | 'lifetime';
  duration?: number;
  platforms: ('meta' | 'google' | 'tiktok')[];
  niche?: string;
  tone?: 'formal' | 'casual' | 'urgente' | 'inspirador';
  draftCopies?: string[];
  historicalData?: {
    avgCTR: number;
    avgCPC: number;
    avgROAS: number;
  };
}

export interface StrategyResponse {
  strategy: {
    summary: string;
    approach: string;
    expectedResults: {
      impressions: string;
      clicks: string;
      conversions: string;
      estimatedCPA: string;
      estimatedROAS: string;
    };
  };
  platforms: {
    meta?: unknown;
    google?: unknown;
    tiktok?: unknown;
  };
  copies: {
    headlines: string[];
    descriptions: string[];
    primaryTexts: string[];
    ctas: string[];
  };
  targeting: {
    primaryAudience: {
      name: string;
      description: string;
      demographics: unknown;
      interests: string[];
    };
    secondaryAudiences: unknown[];
  };
  optimization: {
    bidStrategy: string;
    budgetAllocation: Record<string, number>;
    testingPlan: string[];
  };
  agentInstructions: AgentInstruction[];
}

export interface ValidationIssue {
  severity: 'high' | 'medium' | 'low';
  message: string;
  fix?: string;
}

export interface ValidationResponse {
  isValid: boolean;
  score: number;
  issues: ValidationIssue[];
  suggestions: string[];
  estimatedPerformance: {
    ctrRange: string;
    cpaRange: string;
    roasRange: string;
  };
}

export interface Insight {
  type: 'opportunity' | 'warning' | 'info';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

export interface OptimizationAction {
  id: string;
  platform: 'meta' | 'google' | 'tiktok';
  action: string;
  params: Record<string, unknown>;
  priority: number;
  reason: string;
}

export interface AnalysisResponse {
  analysis: string;
  insights: Insight[];
  actions: OptimizationAction[];
}
