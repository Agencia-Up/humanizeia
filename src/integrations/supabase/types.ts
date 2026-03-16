export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ab_test_variants: {
        Row: {
          audience_config: Json | null
          clicks: number | null
          confidence_interval_lower: number | null
          confidence_interval_upper: number | null
          conversion_rate: number | null
          conversions: number | null
          copy_id: string | null
          cpa: number | null
          created_at: string | null
          creative_id: string | null
          ctr: number | null
          description: string | null
          id: string
          impressions: number | null
          is_control: boolean | null
          meta_ad_id: string | null
          name: string
          roas: number | null
          spend: number | null
          test_id: string
        }
        Insert: {
          audience_config?: Json | null
          clicks?: number | null
          confidence_interval_lower?: number | null
          confidence_interval_upper?: number | null
          conversion_rate?: number | null
          conversions?: number | null
          copy_id?: string | null
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          description?: string | null
          id?: string
          impressions?: number | null
          is_control?: boolean | null
          meta_ad_id?: string | null
          name: string
          roas?: number | null
          spend?: number | null
          test_id: string
        }
        Update: {
          audience_config?: Json | null
          clicks?: number | null
          confidence_interval_lower?: number | null
          confidence_interval_upper?: number | null
          conversion_rate?: number | null
          conversions?: number | null
          copy_id?: string | null
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          description?: string | null
          id?: string
          impressions?: number | null
          is_control?: boolean | null
          meta_ad_id?: string | null
          name?: string
          roas?: number | null
          spend?: number | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ab_test_variants_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "copies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_test_variants_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_test_variants_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_tests: {
        Row: {
          campaign_id: string | null
          confidence_level: number | null
          created_at: string | null
          end_date: string | null
          hypothesis: string | null
          id: string
          insights: string[] | null
          learnings: string | null
          lift_percentage: number | null
          min_sample_size: number | null
          name: string
          start_date: string | null
          statistical_significance: number | null
          status: Database["public"]["Enums"]["test_status"] | null
          test_type: string | null
          updated_at: string | null
          user_id: string
          winner_variant_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          confidence_level?: number | null
          created_at?: string | null
          end_date?: string | null
          hypothesis?: string | null
          id?: string
          insights?: string[] | null
          learnings?: string | null
          lift_percentage?: number | null
          min_sample_size?: number | null
          name: string
          start_date?: string | null
          statistical_significance?: number | null
          status?: Database["public"]["Enums"]["test_status"] | null
          test_type?: string | null
          updated_at?: string | null
          user_id: string
          winner_variant_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          confidence_level?: number | null
          created_at?: string | null
          end_date?: string | null
          hypothesis?: string | null
          id?: string
          insights?: string[] | null
          learnings?: string | null
          lift_percentage?: number | null
          min_sample_size?: number | null
          name?: string
          start_date?: string | null
          statistical_significance?: number | null
          status?: Database["public"]["Enums"]["test_status"] | null
          test_type?: string | null
          updated_at?: string | null
          user_id?: string
          winner_variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ab_tests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      ad_accounts: {
        Row: {
          access_token_encrypted: string | null
          account_id: string
          account_name: string
          created_at: string | null
          currency: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          platform: Database["public"]["Enums"]["platform_type"]
          timezone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          account_id: string
          account_name: string
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          platform: Database["public"]["Enums"]["platform_type"]
          timezone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          account_id?: string
          account_name?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          platform?: Database["public"]["Enums"]["platform_type"]
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          action_date: string | null
          action_result: string | null
          action_taken: boolean | null
          campaign_id: string | null
          category: Database["public"]["Enums"]["insight_category"]
          confidence_score: number | null
          copy_id: string | null
          created_at: string | null
          creative_id: string | null
          description: string
          detailed_analysis: string | null
          id: string
          impact_metric: string | null
          impact_value: string | null
          is_dismissed: boolean | null
          is_pinned: boolean | null
          is_read: boolean | null
          priority: number | null
          recommended_action: string | null
          title: string
          type: Database["public"]["Enums"]["insight_type"]
          user_id: string
          valid_until: string | null
        }
        Insert: {
          action_date?: string | null
          action_result?: string | null
          action_taken?: boolean | null
          campaign_id?: string | null
          category: Database["public"]["Enums"]["insight_category"]
          confidence_score?: number | null
          copy_id?: string | null
          created_at?: string | null
          creative_id?: string | null
          description: string
          detailed_analysis?: string | null
          id?: string
          impact_metric?: string | null
          impact_value?: string | null
          is_dismissed?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          priority?: number | null
          recommended_action?: string | null
          title: string
          type: Database["public"]["Enums"]["insight_type"]
          user_id: string
          valid_until?: string | null
        }
        Update: {
          action_date?: string | null
          action_result?: string | null
          action_taken?: boolean | null
          campaign_id?: string | null
          category?: Database["public"]["Enums"]["insight_category"]
          confidence_score?: number | null
          copy_id?: string | null
          created_at?: string | null
          creative_id?: string | null
          description?: string
          detailed_analysis?: string | null
          id?: string
          impact_metric?: string | null
          impact_value?: string | null
          is_dismissed?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          priority?: number | null
          recommended_action?: string | null
          title?: string
          type?: Database["public"]["Enums"]["insight_type"]
          user_id?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "copies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_insights_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_learnings: {
        Row: {
          applicable_to: Json | null
          campaigns_analyzed: number | null
          category: string
          confidence_score: number | null
          created_at: string | null
          data_points: number | null
          date_range_end: string | null
          date_range_start: string | null
          evidence: Json | null
          id: string
          is_active: boolean | null
          is_validated: boolean | null
          learning: string
          subcategory: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          applicable_to?: Json | null
          campaigns_analyzed?: number | null
          category: string
          confidence_score?: number | null
          created_at?: string | null
          data_points?: number | null
          date_range_end?: string | null
          date_range_start?: string | null
          evidence?: Json | null
          id?: string
          is_active?: boolean | null
          is_validated?: boolean | null
          learning: string
          subcategory?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          applicable_to?: Json | null
          campaigns_analyzed?: number | null
          category?: string
          confidence_score?: number | null
          created_at?: string | null
          data_points?: number | null
          date_range_end?: string | null
          date_range_start?: string | null
          evidence?: Json | null
          id?: string
          is_active?: boolean | null
          is_validated?: boolean | null
          learning?: string
          subcategory?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      audiences: {
        Row: {
          ai_insights: string[] | null
          ai_score: number | null
          audience_type: string | null
          avg_cpa: number | null
          avg_ctr: number | null
          avg_roas: number | null
          created_at: string | null
          description: string | null
          external_id: string | null
          id: string
          is_active: boolean | null
          last_used_at: string | null
          name: string
          platform: Database["public"]["Enums"]["platform_type"] | null
          size_estimate: number | null
          source: string | null
          targeting_config: Json | null
          total_conversions: number | null
          total_spend: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_insights?: string[] | null
          ai_score?: number | null
          audience_type?: string | null
          avg_cpa?: number | null
          avg_ctr?: number | null
          avg_roas?: number | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          name: string
          platform?: Database["public"]["Enums"]["platform_type"] | null
          size_estimate?: number | null
          source?: string | null
          targeting_config?: Json | null
          total_conversions?: number | null
          total_spend?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_insights?: string[] | null
          ai_score?: number | null
          audience_type?: string | null
          avg_cpa?: number | null
          avg_ctr?: number | null
          avg_roas?: number | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          name?: string
          platform?: Database["public"]["Enums"]["platform_type"] | null
          size_estimate?: number | null
          source?: string | null
          targeting_config?: Json | null
          total_conversions?: number | null
          total_spend?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          action_config: Json | null
          action_type: Database["public"]["Enums"]["rule_action_type"]
          apply_to_campaigns: string[] | null
          apply_to_platforms:
            | Database["public"]["Enums"]["platform_type"][]
            | null
          check_frequency: string | null
          condition_logic: string | null
          conditions: Json
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          notification_channels: string[] | null
          notify_on_trigger: boolean | null
          trigger_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action_config?: Json | null
          action_type: Database["public"]["Enums"]["rule_action_type"]
          apply_to_campaigns?: string[] | null
          apply_to_platforms?:
            | Database["public"]["Enums"]["platform_type"][]
            | null
          check_frequency?: string | null
          condition_logic?: string | null
          conditions: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          notification_channels?: string[] | null
          notify_on_trigger?: boolean | null
          trigger_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action_config?: Json | null
          action_type?: Database["public"]["Enums"]["rule_action_type"]
          apply_to_campaigns?: string[] | null
          apply_to_platforms?:
            | Database["public"]["Enums"]["platform_type"][]
            | null
          check_frequency?: string | null
          condition_logic?: string | null
          conditions?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          notification_channels?: string[] | null
          notify_on_trigger?: boolean | null
          trigger_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      campaign_metrics: {
        Row: {
          campaign_id: string
          clicks: number | null
          comments: number | null
          conversion_value: number | null
          conversions: number | null
          cpa: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          ctr: number | null
          date: string
          frequency: number | null
          hourly_data: Json | null
          id: string
          impressions: number | null
          likes: number | null
          reach: number | null
          roas: number | null
          saves: number | null
          shares: number | null
          spend: number | null
          video_views: number | null
          video_views_100: number | null
          video_views_25: number | null
          video_views_50: number | null
          video_views_75: number | null
        }
        Insert: {
          campaign_id: string
          clicks?: number | null
          comments?: number | null
          conversion_value?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          date: string
          frequency?: number | null
          hourly_data?: Json | null
          id?: string
          impressions?: number | null
          likes?: number | null
          reach?: number | null
          roas?: number | null
          saves?: number | null
          shares?: number | null
          spend?: number | null
          video_views?: number | null
          video_views_100?: number | null
          video_views_25?: number | null
          video_views_50?: number | null
          video_views_75?: number | null
        }
        Update: {
          campaign_id?: string
          clicks?: number | null
          comments?: number | null
          conversion_value?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          date?: string
          frequency?: number | null
          hourly_data?: Json | null
          id?: string
          impressions?: number | null
          likes?: number | null
          reach?: number | null
          roas?: number | null
          saves?: number | null
          shares?: number | null
          spend?: number | null
          video_views?: number | null
          video_views_100?: number | null
          video_views_25?: number | null
          video_views_50?: number | null
          video_views_75?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_metrics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ad_account_id: string | null
          ai_optimized: boolean | null
          ai_score: number | null
          category: string | null
          created_at: string | null
          daily_budget: number | null
          end_date: string | null
          external_id: string | null
          id: string
          lifetime_budget: number | null
          name: string
          notes: string | null
          objective: string | null
          placements: Json | null
          platform: Database["public"]["Enums"]["platform_type"]
          start_date: string | null
          status: Database["public"]["Enums"]["campaign_status"] | null
          tags: string[] | null
          target_audience: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          ai_optimized?: boolean | null
          ai_score?: number | null
          category?: string | null
          created_at?: string | null
          daily_budget?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          lifetime_budget?: number | null
          name: string
          notes?: string | null
          objective?: string | null
          placements?: Json | null
          platform: Database["public"]["Enums"]["platform_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
          tags?: string[] | null
          target_audience?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          ai_optimized?: boolean | null
          ai_score?: number | null
          category?: string | null
          created_at?: string | null
          daily_budget?: number | null
          end_date?: string | null
          external_id?: string | null
          id?: string
          lifetime_budget?: number | null
          name?: string
          notes?: string | null
          objective?: string | null
          placements?: Json | null
          platform?: Database["public"]["Enums"]["platform_type"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
          tags?: string[] | null
          target_audience?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_ads: {
        Row: {
          ai_analysis: Json | null
          captured_at: string | null
          competitor_name: string | null
          created_at: string | null
          cta: string | null
          description: string | null
          headline: string | null
          id: string
          image_url: string | null
          inspiration_notes: string | null
          is_favorite: boolean | null
          landing_page_url: string | null
          notes: string | null
          platform: Database["public"]["Enums"]["platform_type"] | null
          tags: string[] | null
          user_id: string
          video_url: string | null
        }
        Insert: {
          ai_analysis?: Json | null
          captured_at?: string | null
          competitor_name?: string | null
          created_at?: string | null
          cta?: string | null
          description?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          inspiration_notes?: string | null
          is_favorite?: boolean | null
          landing_page_url?: string | null
          notes?: string | null
          platform?: Database["public"]["Enums"]["platform_type"] | null
          tags?: string[] | null
          user_id: string
          video_url?: string | null
        }
        Update: {
          ai_analysis?: Json | null
          captured_at?: string | null
          competitor_name?: string | null
          created_at?: string | null
          cta?: string | null
          description?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          inspiration_notes?: string | null
          is_favorite?: boolean | null
          landing_page_url?: string | null
          notes?: string | null
          platform?: Database["public"]["Enums"]["platform_type"] | null
          tags?: string[] | null
          user_id?: string
          video_url?: string | null
        }
        Relationships: []
      }
      copies: {
        Row: {
          ai_feedback: string | null
          ai_score: number | null
          character_count: number | null
          content: string
          created_at: string | null
          cta: string | null
          description: string | null
          formula: string | null
          headline: string | null
          id: string
          is_favorite: boolean | null
          is_template: boolean | null
          objective: string | null
          platform: Database["public"]["Enums"]["platform_type"] | null
          power_words: string[] | null
          product_category: string | null
          product_name: string | null
          readability_score: number | null
          sentiment_score: number | null
          tags: string[] | null
          target_audience: string | null
          tone: string | null
          type: Database["public"]["Enums"]["copy_type"]
          updated_at: string | null
          user_id: string
          word_count: number | null
        }
        Insert: {
          ai_feedback?: string | null
          ai_score?: number | null
          character_count?: number | null
          content: string
          created_at?: string | null
          cta?: string | null
          description?: string | null
          formula?: string | null
          headline?: string | null
          id?: string
          is_favorite?: boolean | null
          is_template?: boolean | null
          objective?: string | null
          platform?: Database["public"]["Enums"]["platform_type"] | null
          power_words?: string[] | null
          product_category?: string | null
          product_name?: string | null
          readability_score?: number | null
          sentiment_score?: number | null
          tags?: string[] | null
          target_audience?: string | null
          tone?: string | null
          type: Database["public"]["Enums"]["copy_type"]
          updated_at?: string | null
          user_id: string
          word_count?: number | null
        }
        Update: {
          ai_feedback?: string | null
          ai_score?: number | null
          character_count?: number | null
          content?: string
          created_at?: string | null
          cta?: string | null
          description?: string | null
          formula?: string | null
          headline?: string | null
          id?: string
          is_favorite?: boolean | null
          is_template?: boolean | null
          objective?: string | null
          platform?: Database["public"]["Enums"]["platform_type"] | null
          power_words?: string[] | null
          product_category?: string | null
          product_name?: string | null
          readability_score?: number | null
          sentiment_score?: number | null
          tags?: string[] | null
          target_audience?: string | null
          tone?: string | null
          type?: Database["public"]["Enums"]["copy_type"]
          updated_at?: string | null
          user_id?: string
          word_count?: number | null
        }
        Relationships: []
      }
      copy_formulas: {
        Row: {
          created_at: string
          description: string
          example: string
          full_name: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          example: string
          full_name: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          example?: string
          full_name?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      copy_performance: {
        Row: {
          campaign_id: string | null
          clicks: number | null
          conversions: number | null
          copy_id: string
          cpa: number | null
          created_at: string | null
          creative_id: string | null
          ctr: number | null
          date: string
          id: string
          impressions: number | null
        }
        Insert: {
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          copy_id: string
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
        }
        Update: {
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          copy_id?: string
          cpa?: number | null
          created_at?: string | null
          creative_id?: string | null
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "copy_performance_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_performance_copy_id_fkey"
            columns: ["copy_id"]
            isOneToOne: false
            referencedRelation: "copies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_performance: {
        Row: {
          campaign_id: string | null
          clicks: number | null
          conversions: number | null
          cpa: number | null
          created_at: string | null
          creative_id: string
          ctr: number | null
          date: string
          engagement_rate: number | null
          hook_rate: number | null
          id: string
          impressions: number | null
          roas: number | null
          spend: number | null
          thumb_stop_rate: number | null
        }
        Insert: {
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_id: string
          ctr?: number | null
          date: string
          engagement_rate?: number | null
          hook_rate?: number | null
          id?: string
          impressions?: number | null
          roas?: number | null
          spend?: number | null
          thumb_stop_rate?: number | null
        }
        Update: {
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          creative_id?: string
          ctr?: number | null
          date?: string
          engagement_rate?: number | null
          hook_rate?: number | null
          id?: string
          impressions?: number | null
          roas?: number | null
          spend?: number | null
          thumb_stop_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_performance_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_performance_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          ai_analysis: Json | null
          ai_score: number | null
          ai_suggestions: string[] | null
          category: string | null
          created_at: string | null
          cta_text: string | null
          description: string | null
          dimensions: string | null
          duration_seconds: number | null
          file_size_bytes: number | null
          file_url: string
          headline: string | null
          id: string
          is_active: boolean | null
          is_template: boolean | null
          name: string
          platform: Database["public"]["Enums"]["platform_type"] | null
          primary_text: string | null
          style: string | null
          tags: string[] | null
          thumbnail_url: string | null
          type: Database["public"]["Enums"]["creative_type"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_analysis?: Json | null
          ai_score?: number | null
          ai_suggestions?: string[] | null
          category?: string | null
          created_at?: string | null
          cta_text?: string | null
          description?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_url: string
          headline?: string | null
          id?: string
          is_active?: boolean | null
          is_template?: boolean | null
          name: string
          platform?: Database["public"]["Enums"]["platform_type"] | null
          primary_text?: string | null
          style?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          type: Database["public"]["Enums"]["creative_type"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_analysis?: Json | null
          ai_score?: number | null
          ai_suggestions?: string[] | null
          category?: string | null
          created_at?: string | null
          cta_text?: string | null
          description?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_url?: string
          headline?: string | null
          id?: string
          is_active?: boolean | null
          is_template?: boolean | null
          name?: string
          platform?: Database["public"]["Enums"]["platform_type"] | null
          primary_text?: string | null
          style?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          type?: Database["public"]["Enums"]["creative_type"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      historico_reports: {
        Row: {
          canal: string
          created_at: string
          detalhes: Json | null
          id: string
          mensagem: string | null
          status: string
          template_id: string | null
          user_id: string
        }
        Insert: {
          canal?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          mensagem?: string | null
          status?: string
          template_id?: string | null
          user_id: string
        }
        Update: {
          canal?: string
          created_at?: string
          detalhes?: Json | null
          id?: string
          mensagem?: string | null
          status?: string
          template_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_cache: {
        Row: {
          cache_key: string
          created_at: string
          data: Json
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          data?: Json
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          data?: Json
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_label: string | null
          action_url: string | null
          created_at: string | null
          id: string
          is_archived: boolean | null
          is_read: boolean | null
          message: string
          reference_id: string | null
          reference_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          is_read?: boolean | null
          message: string
          reference_id?: string | null
          reference_type?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          created_at?: string | null
          id?: string
          is_archived?: boolean | null
          is_read?: boolean | null
          message?: string
          reference_id?: string | null
          reference_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      organization_invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          organization_id: string
          status: Database["public"]["Enums"]["invite_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          organization_id: string
          status?: Database["public"]["Enums"]["invite_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["invite_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_integrations: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          metadata: Json | null
          platform: string
          store_url: string | null
          sync_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          metadata?: Json | null
          platform: string
          store_url?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          metadata?: Json | null
          platform?: string
          store_url?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string | null
          experience_level: string | null
          full_name: string | null
          id: string
          industry: string | null
          monthly_ad_spend_range: string | null
          onboarding_completed: boolean | null
          organization_id: string | null
          preferred_language: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string | null
          experience_level?: string | null
          full_name?: string | null
          id: string
          industry?: string | null
          monthly_ad_spend_range?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          preferred_language?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string | null
          experience_level?: string | null
          full_name?: string | null
          id?: string
          industry?: string | null
          monthly_ad_spend_range?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          preferred_language?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_template_destinatarios: {
        Row: {
          destinatario_id: string
          id: string
          template_id: string
        }
        Insert: {
          destinatario_id: string
          id?: string
          template_id: string
        }
        Update: {
          destinatario_id?: string
          id?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_template_destinatarios_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_destinatarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_template_destinatarios_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          agendamento_ativo: boolean
          ativo: boolean
          canais: string[]
          created_at: string
          descricao: string | null
          dias_envio: number[]
          discord_webhook_url: string | null
          footer_template: string
          header_template: string
          horario_envio: string
          id: string
          metricas: Json
          nome: string
          ordem: number
          updated_at: string
          user_id: string
        }
        Insert: {
          agendamento_ativo?: boolean
          ativo?: boolean
          canais?: string[]
          created_at?: string
          descricao?: string | null
          dias_envio?: number[]
          discord_webhook_url?: string | null
          footer_template?: string
          header_template?: string
          horario_envio?: string
          id?: string
          metricas?: Json
          nome: string
          ordem?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          agendamento_ativo?: boolean
          ativo?: boolean
          canais?: string[]
          created_at?: string
          descricao?: string | null
          dias_envio?: number[]
          discord_webhook_url?: string | null
          footer_template?: string
          header_template?: string
          horario_envio?: string
          id?: string
          metricas?: Json
          nome?: string
          ordem?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rule_execution_log: {
        Row: {
          action_result: string | null
          action_taken: string
          campaign_id: string | null
          conditions_met: Json
          error_message: string | null
          id: string
          metrics_snapshot: Json | null
          rule_id: string
          success: boolean | null
          triggered_at: string | null
        }
        Insert: {
          action_result?: string | null
          action_taken: string
          campaign_id?: string | null
          conditions_met: Json
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          rule_id: string
          success?: boolean | null
          triggered_at?: string | null
        }
        Update: {
          action_result?: string | null
          action_taken?: string
          campaign_id?: string | null
          conditions_met?: Json
          error_message?: string | null
          id?: string
          metrics_snapshot?: Json | null
          rule_id?: string
          success?: boolean | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rule_execution_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_execution_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          config: Json
          created_at: string | null
          description: string | null
          id: string
          is_scheduled: boolean | null
          last_generated_at: string | null
          name: string
          recipients: string[] | null
          report_type: string | null
          schedule_day: number | null
          schedule_frequency: string | null
          schedule_time: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          config: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_scheduled?: boolean | null
          last_generated_at?: string | null
          name: string
          recipients?: string[] | null
          report_type?: string | null
          schedule_day?: number | null
          schedule_frequency?: string | null
          schedule_time?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string | null
          description?: string | null
          id?: string
          is_scheduled?: boolean | null
          last_generated_at?: string | null
          name?: string
          recipients?: string[] | null
          report_type?: string | null
          schedule_day?: number | null
          schedule_frequency?: string | null
          schedule_time?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_daily_metrics: {
        Row: {
          avg_order_value: number | null
          created_at: string
          date: string
          id: string
          new_customers: number | null
          returning_customers: number | null
          total_items_sold: number | null
          total_orders: number | null
          total_revenue: number | null
          user_id: string
        }
        Insert: {
          avg_order_value?: number | null
          created_at?: string
          date: string
          id?: string
          new_customers?: number | null
          returning_customers?: number | null
          total_items_sold?: number | null
          total_orders?: number | null
          total_revenue?: number | null
          user_id: string
        }
        Update: {
          avg_order_value?: number | null
          created_at?: string
          date?: string
          id?: string
          new_customers?: number | null
          returning_customers?: number | null
          total_items_sold?: number | null
          total_orders?: number | null
          total_revenue?: number | null
          user_id?: string
        }
        Relationships: []
      }
      shopify_orders: {
        Row: {
          created_at: string
          currency: string | null
          customer_email: string | null
          customer_name: string | null
          financial_status: string | null
          fulfillment_status: string | null
          id: string
          line_items: Json | null
          order_date: string | null
          order_number: string | null
          shopify_order_id: string
          subtotal_price: number | null
          total_discounts: number | null
          total_price: number | null
          total_shipping: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          financial_status?: string | null
          fulfillment_status?: string | null
          id?: string
          line_items?: Json | null
          order_date?: string | null
          order_number?: string | null
          shopify_order_id: string
          subtotal_price?: number | null
          total_discounts?: number | null
          total_price?: number | null
          total_shipping?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          customer_email?: string | null
          customer_name?: string | null
          financial_status?: string | null
          fulfillment_status?: string | null
          id?: string
          line_items?: Json | null
          order_date?: string | null
          order_number?: string | null
          shopify_order_id?: string
          subtotal_price?: number | null
          total_discounts?: number | null
          total_price?: number | null
          total_shipping?: number | null
          user_id?: string
        }
        Relationships: []
      }
      swipe_files: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          is_favorite: boolean | null
          notes: string | null
          platform: string | null
          source: string
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: string
          is_favorite?: boolean | null
          notes?: string | null
          platform?: string | null
          source?: string
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          is_favorite?: boolean | null
          notes?: string | null
          platform?: string | null
          source?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_ai_agents: {
        Row: {
          blocked_categories: string[] | null
          business_hours_end: string | null
          business_hours_only: boolean
          business_hours_start: string | null
          created_at: string
          id: string
          instance_id: string | null
          instance_ids: string[] | null
          is_active: boolean
          max_tokens: number
          model: string
          name: string
          reply_delay_ms: number
          system_prompt: string
          temperature: number
          total_replies: number
          updated_at: string
          user_id: string
        }
        Insert: {
          blocked_categories?: string[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean
          business_hours_start?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_ids?: string[] | null
          is_active?: boolean
          max_tokens?: number
          model?: string
          name?: string
          reply_delay_ms?: number
          system_prompt: string
          temperature?: number
          total_replies?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          blocked_categories?: string[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean
          business_hours_start?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          instance_ids?: string[] | null
          is_active?: boolean
          max_tokens?: number
          model?: string
          name?: string
          reply_delay_ms?: number
          system_prompt?: string
          temperature?: number
          total_replies?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_ai_agents_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_audit_logs: {
        Row: {
          contact_id: string | null
          created_at: string
          details: Json | null
          event_type: string
          id: string
          instance_id: string | null
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          instance_id?: string | null
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          instance_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wa_automations: {
        Row: {
          action_config: Json | null
          action_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          trigger_count: number | null
          trigger_event: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action_config?: Json | null
          action_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          trigger_count?: number | null
          trigger_event: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          trigger_count?: number | null
          trigger_event?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wa_campaigns: {
        Row: {
          completed_at: string | null
          created_at: string
          delivered_count: number
          end_time: string | null
          failed_count: number
          id: string
          include_optout_buttons: boolean
          instance_id: string | null
          list_ids: string[] | null
          listas_alvo: string[] | null
          max_delay_seconds: number
          media_type: string | null
          media_url: string | null
          message_template: string
          min_delay_seconds: number
          name: string
          organization_id: string | null
          prompt_base: string | null
          regras_aquecimento: Json | null
          regras_delay: Json | null
          regras_rodizio: Json | null
          reply_auto_message: string | null
          reply_auto_tag: string | null
          rotation_messages_per_instance: number
          scheduled_at: string | null
          sent_count: number
          start_time: string | null
          started_at: string | null
          status: string
          tags: string[] | null
          total_contacts: number
          updated_at: string
          user_id: string
          variation_level: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          delivered_count?: number
          end_time?: string | null
          failed_count?: number
          id?: string
          include_optout_buttons?: boolean
          instance_id?: string | null
          list_ids?: string[] | null
          listas_alvo?: string[] | null
          max_delay_seconds?: number
          media_type?: string | null
          media_url?: string | null
          message_template: string
          min_delay_seconds?: number
          name: string
          organization_id?: string | null
          prompt_base?: string | null
          regras_aquecimento?: Json | null
          regras_delay?: Json | null
          regras_rodizio?: Json | null
          reply_auto_message?: string | null
          reply_auto_tag?: string | null
          rotation_messages_per_instance?: number
          scheduled_at?: string | null
          sent_count?: number
          start_time?: string | null
          started_at?: string | null
          status?: string
          tags?: string[] | null
          total_contacts?: number
          updated_at?: string
          user_id: string
          variation_level?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          delivered_count?: number
          end_time?: string | null
          failed_count?: number
          id?: string
          include_optout_buttons?: boolean
          instance_id?: string | null
          list_ids?: string[] | null
          listas_alvo?: string[] | null
          max_delay_seconds?: number
          media_type?: string | null
          media_url?: string | null
          message_template?: string
          min_delay_seconds?: number
          name?: string
          organization_id?: string | null
          prompt_base?: string | null
          regras_aquecimento?: Json | null
          regras_delay?: Json | null
          regras_rodizio?: Json | null
          reply_auto_message?: string | null
          reply_auto_tag?: string | null
          rotation_messages_per_instance?: number
          scheduled_at?: string | null
          sent_count?: number
          start_time?: string | null
          started_at?: string | null
          status?: string
          tags?: string[] | null
          total_contacts?: number
          updated_at?: string
          user_id?: string
          variation_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_campaigns_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contact_lists: {
        Row: {
          contact_count: number
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string | null
          source: string
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id?: string | null
          source?: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_count?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          source?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contact_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contacts: {
        Row: {
          created_at: string
          current_instance_id: string | null
          group_name: string | null
          id: string
          is_valid: boolean | null
          last_message_at: string | null
          list_id: string | null
          metadata: Json | null
          name: string | null
          phone: string
          source: string
          tags: string[] | null
          user_id: string
        }
        Insert: {
          created_at?: string
          current_instance_id?: string | null
          group_name?: string | null
          id?: string
          is_valid?: boolean | null
          last_message_at?: string | null
          list_id?: string | null
          metadata?: Json | null
          name?: string | null
          phone: string
          source?: string
          tags?: string[] | null
          user_id: string
        }
        Update: {
          created_at?: string
          current_instance_id?: string | null
          group_name?: string | null
          id?: string
          is_valid?: boolean | null
          last_message_at?: string | null
          list_id?: string | null
          metadata?: Json | null
          name?: string | null
          phone?: string
          source?: string
          tags?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_inbox: {
        Row: {
          ai_category: string | null
          ai_sentiment: string | null
          campaign_id: string | null
          contact_id: string | null
          contact_name: string | null
          content: string | null
          created_at: string
          direction: string
          id: string
          instance_id: string | null
          is_archived: boolean
          is_read: boolean
          media_url: string | null
          message_type: string
          phone: string
          remote_message_id: string | null
          user_id: string
        }
        Insert: {
          ai_category?: string | null
          ai_sentiment?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          instance_id?: string | null
          is_archived?: boolean
          is_read?: boolean
          media_url?: string | null
          message_type?: string
          phone: string
          remote_message_id?: string | null
          user_id: string
        }
        Update: {
          ai_category?: string | null
          ai_sentiment?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          instance_id?: string | null
          is_archived?: boolean
          is_read?: boolean
          media_url?: string | null
          message_type?: string
          phone?: string
          remote_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_inbox_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "wa_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_inbox_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_inbox_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_instances: {
        Row: {
          api_key_encrypted: string
          api_url: string
          consecutive_undelivered: number | null
          created_at: string
          failover_status: string | null
          friendly_name: string
          health_score: number
          id: string
          instance_name: string
          is_active: boolean
          last_connected_at: string | null
          last_message_at: string | null
          last_used_at: string | null
          messages_sent_today: number
          meta_config: Json | null
          organization_id: string | null
          phone_number: string | null
          provider: string
          shadow_ban_suspect: boolean | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted: string
          api_url: string
          consecutive_undelivered?: number | null
          created_at?: string
          failover_status?: string | null
          friendly_name: string
          health_score?: number
          id?: string
          instance_name: string
          is_active?: boolean
          last_connected_at?: string | null
          last_message_at?: string | null
          last_used_at?: string | null
          messages_sent_today?: number
          meta_config?: Json | null
          organization_id?: string | null
          phone_number?: string | null
          provider?: string
          shadow_ban_suspect?: boolean | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string
          api_url?: string
          consecutive_undelivered?: number | null
          created_at?: string
          failover_status?: string | null
          friendly_name?: string
          health_score?: number
          id?: string
          instance_name?: string
          is_active?: boolean
          last_connected_at?: string | null
          last_message_at?: string | null
          last_used_at?: string | null
          messages_sent_today?: number
          meta_config?: Json | null
          organization_id?: string | null
          phone_number?: string | null
          provider?: string
          shadow_ban_suspect?: boolean | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_queue: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          contact_metadata: Json | null
          contact_name: string | null
          created_at: string
          delivered_at: string | null
          delivery_confirmed_at: string | null
          error_message: string | null
          id: string
          instance_id: string | null
          media_type: string | null
          media_url: string | null
          message: string
          message_hash: string | null
          phone: string
          read_at: string | null
          retry_count: number
          scheduled_for: string | null
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          contact_metadata?: Json | null
          contact_name?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_confirmed_at?: string | null
          error_message?: string | null
          id?: string
          instance_id?: string | null
          media_type?: string | null
          media_url?: string | null
          message: string
          message_hash?: string | null
          phone: string
          read_at?: string | null
          retry_count?: number
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          contact_metadata?: Json | null
          contact_name?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_confirmed_at?: string | null
          error_message?: string | null
          id?: string
          instance_id?: string | null
          media_type?: string | null
          media_url?: string | null
          message?: string
          message_hash?: string | null
          phone?: string
          read_at?: string | null
          retry_count?: number
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_queue_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "wa_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_queue_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_config: {
        Row: {
          api_key: string
          api_url: string
          created_at: string
          id: string
          instance_name: string
          is_active: boolean
          phone_number: string | null
          report_time: string | null
          send_daily_report: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          instance_name?: string
          is_active?: boolean
          phone_number?: string | null
          report_time?: string | null
          send_daily_report?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          instance_name?: string
          is_active?: boolean
          phone_number?: string | null
          report_time?: string | null
          send_daily_report?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_destinatarios: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          numero: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          numero: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          numero?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization_with_owner: {
        Args: { org_name: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decrement_instance_health: {
        Args: { decrement_value?: number; instance_id: string }
        Returns: undefined
      }
      get_user_email: { Args: { _user_id: string }; Returns: string }
      increment_campaign_delivered: {
        Args: { cid: string }
        Returns: undefined
      }
      increment_campaign_sent: { Args: { cid: string }; Returns: undefined }
      increment_consecutive_undelivered: {
        Args: { iid: string }
        Returns: undefined
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_owner: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      campaign_status: "active" | "paused" | "ended" | "draft"
      copy_type: "headline" | "description" | "cta" | "full_ad"
      creative_type: "image" | "video" | "carousel" | "stories" | "reels"
      insight_category:
        | "performance"
        | "budget"
        | "audience"
        | "creative"
        | "copy"
        | "timing"
      insight_type: "warning" | "opportunity" | "success" | "critical" | "info"
      invite_status: "pending" | "accepted" | "declined" | "expired"
      org_role: "owner" | "admin" | "member"
      platform_type: "meta" | "google" | "tiktok" | "linkedin"
      rule_action_type:
        | "pause"
        | "activate"
        | "increase_budget"
        | "decrease_budget"
        | "notify"
        | "change_bid"
      test_status: "running" | "paused" | "completed" | "winner_selected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      campaign_status: ["active", "paused", "ended", "draft"],
      copy_type: ["headline", "description", "cta", "full_ad"],
      creative_type: ["image", "video", "carousel", "stories", "reels"],
      insight_category: [
        "performance",
        "budget",
        "audience",
        "creative",
        "copy",
        "timing",
      ],
      insight_type: ["warning", "opportunity", "success", "critical", "info"],
      invite_status: ["pending", "accepted", "declined", "expired"],
      org_role: ["owner", "admin", "member"],
      platform_type: ["meta", "google", "tiktok", "linkedin"],
      rule_action_type: [
        "pause",
        "activate",
        "increase_budget",
        "decrease_budget",
        "notify",
        "change_bid",
      ],
      test_status: ["running", "paused", "completed", "winner_selected"],
    },
  },
} as const
