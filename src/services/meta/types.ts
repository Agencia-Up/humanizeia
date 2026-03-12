// ============================================================
// Meta Ads API Types — used by the secure metaAdsService proxy
// ============================================================

export type MetaObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_APP_PROMOTION';

export type MetaOptimizationGoal =
  | 'NONE'
  | 'APP_INSTALLS'
  | 'BRAND_AWARENESS'
  | 'CLICKS'
  | 'ENGAGED_USERS'
  | 'IMPRESSIONS'
  | 'LANDING_PAGE_VIEWS'
  | 'LEAD_GENERATION'
  | 'LINK_CLICKS'
  | 'OFFSITE_CONVERSIONS'
  | 'PAGE_LIKES'
  | 'POST_ENGAGEMENT'
  | 'REACH'
  | 'VIDEO_VIEWS';

export type MetaCTA =
  | 'BOOK_TRAVEL'
  | 'CONTACT_US'
  | 'DOWNLOAD'
  | 'GET_OFFER'
  | 'GET_QUOTE'
  | 'LEARN_MORE'
  | 'LISTEN_NOW'
  | 'MESSAGE_PAGE'
  | 'ORDER_NOW'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'SUBSCRIBE'
  | 'WATCH_MORE'
  | 'WHATSAPP_MESSAGE';

export type MetaStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

export type MetaBillingEvent = 'IMPRESSIONS' | 'LINK_CLICKS' | 'POST_ENGAGEMENT';

export type MetaBidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP';

// ---------- Targeting ----------

export interface MetaGeoLocations {
  countries?: string[];
  regions?: { key: string }[];
  cities?: { key: string; radius?: number; distance_unit?: string }[];
}

export interface MetaTargeting {
  geo_locations?: MetaGeoLocations;
  age_min?: number;
  age_max?: number;
  genders?: number[]; // 1 = male, 2 = female
  interests?: { id: string; name?: string }[];
  behaviors?: { id: string; name?: string }[];
  custom_audiences?: { id: string }[];
  excluded_custom_audiences?: { id: string }[];
  locales?: number[];
  publisher_platforms?: ('facebook' | 'instagram' | 'audience_network' | 'messenger')[];
  facebook_positions?: string[];
  instagram_positions?: string[];
}

// ---------- Campaign ----------

export interface CreateCampaignPayload {
  name: string;
  objective: MetaObjective;
  status?: MetaStatus;
  special_ad_categories?: string[];
  daily_budget?: number;    // in cents
  lifetime_budget?: number; // in cents
}

export interface MetaCampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time: string;
  updated_time: string;
}

// ---------- Ad Set ----------

export interface CreateAdSetPayload {
  campaign_id: string;
  name: string;
  status?: MetaStatus;
  daily_budget?: number;
  lifetime_budget?: number;
  start_time?: string;
  end_time?: string;
  targeting: MetaTargeting;
  optimization_goal: MetaOptimizationGoal;
  billing_event?: MetaBillingEvent;
  bid_strategy?: MetaBidStrategy;
  bid_amount?: number;
}

export interface MetaAdSetRow {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  targeting: MetaTargeting;
  optimization_goal: string;
}

// ---------- Creative / Ad ----------

export interface MetaObjectStorySpec {
  page_id: string;
  link_data?: {
    message: string;
    link: string;
    name?: string;
    description?: string;
    caption?: string;
    call_to_action?: { type: MetaCTA; value?: { link: string } };
    image_hash?: string;
    image_url?: string;
  };
  video_data?: {
    video_id: string;
    message: string;
    title?: string;
    call_to_action?: { type: MetaCTA; value?: { link: string } };
  };
}

export interface CreateCreativePayload {
  name?: string;
  object_story_spec: MetaObjectStorySpec;
}

export interface CreateAdPayload {
  adset_id: string;
  name: string;
  status?: MetaStatus;
  creative: CreateCreativePayload;
}

// ---------- Insights ----------

export interface MetaInsights {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions?: number;
  cost_per_conversion?: number;
  roas?: number;
}

export interface MetaDateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

// ---------- Misc ----------

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

export interface MetaInterest {
  id: string;
  name: string;
  audience_size_lower_bound?: number;
  audience_size_upper_bound?: number;
  path?: string[];
}

export interface MetaCustomAudience {
  id: string;
  name: string;
  subtype: string;
  approximate_count: number;
}

/** Map internal objectives to Meta API objectives */
export const OBJECTIVE_MAP: Record<string, MetaObjective> = {
  vendas: 'OUTCOME_SALES',
  leads: 'OUTCOME_LEADS',
  trafego: 'OUTCOME_TRAFFIC',
  awareness: 'OUTCOME_AWARENESS',
};

/** Map internal objectives to default optimization goals */
export const OPTIMIZATION_MAP: Record<string, MetaOptimizationGoal> = {
  vendas: 'OFFSITE_CONVERSIONS',
  leads: 'LEAD_GENERATION',
  trafego: 'LANDING_PAGE_VIEWS',
  awareness: 'REACH',
};
