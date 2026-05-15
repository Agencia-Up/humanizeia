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
      ai_crm_leads: {
        Row: {
          agent_id: string | null
          assigned_to_member_id: string | null
          created_at: string
          id: string
          instance_id: string | null
          last_interaction_at: string | null
          lead_name: string | null
          message_count: number
          origem: string | null
          origem_outros: string | null
          remote_jid: string
          sentiment: string | null
          status: string
          summary: string | null
          transfer_reason: string | null
          transferred_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          assigned_to_member_id?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          last_interaction_at?: string | null
          lead_name?: string | null
          message_count?: number
          origem?: string | null
          origem_outros?: string | null
          remote_jid: string
          sentiment?: string | null
          status?: string
          summary?: string | null
          transfer_reason?: string | null
          transferred_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          assigned_to_member_id?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          last_interaction_at?: string | null
          lead_name?: string | null
          message_count?: number
          origem?: string | null
          origem_outros?: string | null
          remote_jid?: string
          sentiment?: string | null
          status?: string
          summary?: string | null
          transfer_reason?: string | null
          transferred_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_crm_leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "wa_ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_crm_leads_assigned_to_member_id_fkey"
            columns: ["assigned_to_member_id"]
            isOneToOne: false
            referencedRelation: "ai_team_members"
            referencedColumns: ["id"]
          },
        ]
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
      ai_lead_transfers: {
        Row: {
          created_at: string
          from_agent_id: string | null
          id: string
          lead_id: string
          notes: string | null
          to_member_id: string
          transfer_reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          from_agent_id?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          to_member_id: string
          transfer_reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          from_agent_id?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          to_member_id?: string
          transfer_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_lead_transfers_from_agent_id_fkey"
            columns: ["from_agent_id"]
            isOneToOne: false
            referencedRelation: "wa_ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lead_transfers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "ai_crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lead_transfers_to_member_id_fkey"
            columns: ["to_member_id"]
            isOneToOne: false
            referencedRelation: "ai_team_members"
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
      ai_team_members: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          is_active: boolean
          last_lead_received_at: string | null
          name: string
          total_leads_received: number
          updated_at: string
          user_id: string
          whatsapp_number: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_lead_received_at?: string | null
          name: string
          total_leads_received?: number
          updated_at?: string
          user_id: string
          whatsapp_number: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_lead_received_at?: string | null
          name?: string
          total_leads_received?: number
          updated_at?: string
          user_id?: string
          whatsapp_number?: string
        }
        Relationships: []
      }
      apollo_action_log: {
        Row: {
          action_details: Json | null
          action_type: string
          after_state: Json | null
          before_state: Json | null
          campaign_id: string | null
          error_message: string | null
          executed_at: string
          executed_by: string | null
          id: string
          recommendation_id: string | null
          success: boolean | null
          user_id: string
        }
        Insert: {
          action_details?: Json | null
          action_type: string
          after_state?: Json | null
          before_state?: Json | null
          campaign_id?: string | null
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          recommendation_id?: string | null
          success?: boolean | null
          user_id: string
        }
        Update: {
          action_details?: Json | null
          action_type?: string
          after_state?: Json | null
          before_state?: Json | null
          campaign_id?: string | null
          error_message?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          recommendation_id?: string | null
          success?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_action_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apollo_action_log_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "apollo_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_alerts: {
        Row: {
          actions: string[] | null
          benchmark_value: string | null
          campaign_id: string | null
          created_at: string
          current_value: string | null
          description: string
          deviation: string | null
          diagnostic_id: string | null
          id: string
          is_dismissed: boolean | null
          is_read: boolean | null
          level: string
          metric: string | null
          title: string
          user_id: string
        }
        Insert: {
          actions?: string[] | null
          benchmark_value?: string | null
          campaign_id?: string | null
          created_at?: string
          current_value?: string | null
          description: string
          deviation?: string | null
          diagnostic_id?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          level?: string
          metric?: string | null
          title: string
          user_id: string
        }
        Update: {
          actions?: string[] | null
          benchmark_value?: string | null
          campaign_id?: string | null
          created_at?: string
          current_value?: string | null
          description?: string
          deviation?: string | null
          diagnostic_id?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          level?: string
          metric?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_alerts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apollo_alerts_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "apollo_diagnostics"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_benchmarks: {
        Row: {
          benchmark_value: number
          created_at: string
          id: string
          industry: string | null
          metric_name: string
          platform: string | null
          source: string | null
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          benchmark_value: number
          created_at?: string
          id?: string
          industry?: string | null
          metric_name: string
          platform?: string | null
          source?: string | null
          stage: string
          updated_at?: string
          user_id: string
        }
        Update: {
          benchmark_value?: number
          created_at?: string
          id?: string
          industry?: string | null
          metric_name?: string
          platform?: string | null
          source?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      apollo_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      apollo_diagnostics: {
        Row: {
          campaign_id: string | null
          category: string | null
          cause: string
          created_at: string
          diagnosis: string
          evidence: Json | null
          health_score_id: string | null
          id: string
          is_resolved: boolean | null
          problem: string
          resolved_at: string | null
          severity: string
          stage: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          category?: string | null
          cause: string
          created_at?: string
          diagnosis: string
          evidence?: Json | null
          health_score_id?: string | null
          id?: string
          is_resolved?: boolean | null
          problem: string
          resolved_at?: string | null
          severity?: string
          stage: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          category?: string | null
          cause?: string
          created_at?: string
          diagnosis?: string
          evidence?: Json | null
          health_score_id?: string | null
          id?: string
          is_resolved?: boolean | null
          problem?: string
          resolved_at?: string | null
          severity?: string
          stage?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_diagnostics_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apollo_diagnostics_health_score_id_fkey"
            columns: ["health_score_id"]
            isOneToOne: false
            referencedRelation: "apollo_health_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_health_scores: {
        Row: {
          calculated_at: string
          campaign_id: string | null
          created_at: string
          id: string
          metrics: Json | null
          previous_score: number | null
          score: number
          stage: string
          trend: string | null
          user_id: string
        }
        Insert: {
          calculated_at?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          metrics?: Json | null
          previous_score?: number | null
          score?: number
          stage: string
          trend?: string | null
          user_id: string
        }
        Update: {
          calculated_at?: string
          campaign_id?: string | null
          created_at?: string
          id?: string
          metrics?: Json | null
          previous_score?: number | null
          score?: number
          stage?: string
          trend?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_health_scores_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_learning: {
        Row: {
          category: string
          confidence: number | null
          created_at: string
          evidence: Json | null
          id: string
          insight: string
          is_active: boolean | null
          source_campaigns: string[] | null
          times_validated: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          insight: string
          is_active?: boolean | null
          source_campaigns?: string[] | null
          times_validated?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number | null
          created_at?: string
          evidence?: Json | null
          id?: string
          insight?: string
          is_active?: boolean | null
          source_campaigns?: string[] | null
          times_validated?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      apollo_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          data: Json | null
          id: string
          message_type: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          data?: Json | null
          id?: string
          message_type?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          data?: Json | null
          id?: string
          message_type?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "apollo_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      apollo_recommendations: {
        Row: {
          action_config: Json | null
          action_type: string
          campaign_id: string | null
          created_at: string
          description: string
          diagnostic_id: string | null
          executed_at: string | null
          id: string
          impact_estimate: string | null
          priority: number | null
          result: string | null
          status: string | null
          title: string
          user_id: string
        }
        Insert: {
          action_config?: Json | null
          action_type: string
          campaign_id?: string | null
          created_at?: string
          description: string
          diagnostic_id?: string | null
          executed_at?: string | null
          id?: string
          impact_estimate?: string | null
          priority?: number | null
          result?: string | null
          status?: string | null
          title: string
          user_id: string
        }
        Update: {
          action_config?: Json | null
          action_type?: string
          campaign_id?: string | null
          created_at?: string
          description?: string
          diagnostic_id?: string | null
          executed_at?: string | null
          id?: string
          impact_estimate?: string | null
          priority?: number | null
          result?: string | null
          status?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apollo_recommendations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apollo_recommendations_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "apollo_diagnostics"
            referencedColumns: ["id"]
          },
        ]
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
      capture_form_submissions: {
        Row: {
          created_at: string | null
          custom_data: Json | null
          email: string | null
          error_message: string | null
          fbclid: string | null
          form_id: string
          id: string
          ip_address: string | null
          name: string | null
          phone: string | null
          processed_at: string | null
          status: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          error_message?: string | null
          fbclid?: string | null
          form_id: string
          id?: string
          ip_address?: string | null
          name?: string | null
          phone?: string | null
          processed_at?: string | null
          status?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string | null
          custom_data?: Json | null
          email?: string | null
          error_message?: string | null
          fbclid?: string | null
          form_id?: string
          id?: string
          ip_address?: string | null
          name?: string | null
          phone?: string | null
          processed_at?: string | null
          status?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capture_form_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "capture_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      capture_forms: {
        Row: {
          auto_add_to_crm: boolean | null
          auto_create_contact: boolean | null
          auto_fire_capi: boolean | null
          auto_send_whatsapp: boolean | null
          created_at: string | null
          custom_fields: Json | null
          description: string | null
          id: string
          instance_id: string | null
          is_active: boolean | null
          name: string
          redirect_url: string | null
          submission_count: number | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
          welcome_message: string | null
        }
        Insert: {
          auto_add_to_crm?: boolean | null
          auto_create_contact?: boolean | null
          auto_fire_capi?: boolean | null
          auto_send_whatsapp?: boolean | null
          created_at?: string | null
          custom_fields?: Json | null
          description?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          name: string
          redirect_url?: string | null
          submission_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
          user_id: string
          welcome_message?: string | null
        }
        Update: {
          auto_add_to_crm?: boolean | null
          auto_create_contact?: boolean | null
          auto_fire_capi?: boolean | null
          auto_send_whatsapp?: boolean | null
          created_at?: string | null
          custom_fields?: Json | null
          description?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean | null
          name?: string
          redirect_url?: string | null
          submission_count?: number | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capture_forms_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
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
      creative_uploads: {
        Row: {
          ai_analysis: Json | null
          ai_recommendations: string[] | null
          ai_score: number | null
          category: string | null
          created_at: string
          description: string | null
          dimensions: string | null
          duration_seconds: number | null
          file_size_bytes: number | null
          file_type: string
          file_url: string
          id: string
          is_favorite: boolean | null
          last_used_at: string | null
          mime_type: string | null
          name: string
          organization_id: string | null
          style: string | null
          tags: string[] | null
          thumbnail_url: string | null
          updated_at: string
          used_in_campaigns: number | null
          user_id: string
        }
        Insert: {
          ai_analysis?: Json | null
          ai_recommendations?: string[] | null
          ai_score?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_type?: string
          file_url: string
          id?: string
          is_favorite?: boolean | null
          last_used_at?: string | null
          mime_type?: string | null
          name: string
          organization_id?: string | null
          style?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          used_in_campaigns?: number | null
          user_id: string
        }
        Update: {
          ai_analysis?: Json | null
          ai_recommendations?: string[] | null
          ai_score?: number | null
          category?: string | null
          created_at?: string
          description?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          file_type?: string
          file_url?: string
          id?: string
          is_favorite?: boolean | null
          last_used_at?: string | null
          mime_type?: string | null
          name?: string
          organization_id?: string | null
          style?: string | null
          tags?: string[] | null
          thumbnail_url?: string | null
          updated_at?: string
          used_in_campaigns?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_uploads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      crm_activities: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          lead_id: string
          metadata: Json | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id: string
          metadata?: Json | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id?: string
          metadata?: Json | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          assigned_to: string | null
          company: string | null
          created_at: string | null
          currency: string | null
          custom_fields: Json | null
          email: string | null
          expected_close_date: string | null
          id: string
          lost_at: string | null
          lost_reason: string | null
          name: string
          notes: string | null
          phone: string | null
          position: number
          priority: string | null
          source: string | null
          stage_id: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
          value: number | null
          won_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          company?: string | null
          created_at?: string | null
          currency?: string | null
          custom_fields?: Json | null
          email?: string | null
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          position?: number
          priority?: string | null
          source?: string | null
          stage_id?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id: string
          value?: number | null
          won_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          company?: string | null
          created_at?: string | null
          currency?: string | null
          custom_fields?: Json | null
          email?: string | null
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          position?: number
          priority?: string | null
          source?: string | null
          stage_id?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
          value?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          id: string
          is_default: boolean | null
          name: string
          pipeline_id: string | null
          position: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          pipeline_id?: string | null
          position?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          pipeline_id?: string | null
          position?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      datastore_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          datastore_id: string
          embedding: string | null
          id: string
          metadata: Json | null
          search_vector: unknown
          source_id: string
          tokens_count: number
          user_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          datastore_id: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          search_vector?: unknown
          source_id: string
          tokens_count?: number
          user_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          datastore_id?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          search_vector?: unknown
          source_id?: string
          tokens_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "datastore_chunks_datastore_id_fkey"
            columns: ["datastore_id"]
            isOneToOne: false
            referencedRelation: "datastores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datastore_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "datastore_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      datastore_sources: {
        Row: {
          chunks_count: number
          content: string | null
          created_at: string
          datastore_id: string
          error_message: string | null
          file_path: string | null
          id: string
          name: string
          source_type: string
          status: string
          tokens_count: number
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          chunks_count?: number
          content?: string | null
          created_at?: string
          datastore_id: string
          error_message?: string | null
          file_path?: string | null
          id?: string
          name: string
          source_type?: string
          status?: string
          tokens_count?: number
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          chunks_count?: number
          content?: string | null
          created_at?: string
          datastore_id?: string
          error_message?: string | null
          file_path?: string | null
          id?: string
          name?: string
          source_type?: string
          status?: string
          tokens_count?: number
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "datastore_sources_datastore_id_fkey"
            columns: ["datastore_id"]
            isOneToOne: false
            referencedRelation: "datastores"
            referencedColumns: ["id"]
          },
        ]
      }
      datastores: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          total_chunks: number
          total_documents: number
          total_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          total_chunks?: number
          total_documents?: number
          total_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          total_chunks?: number
          total_documents?: number
          total_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      external_webhooks: {
        Row: {
          auto_tags: string[] | null
          created_at: string | null
          description: string | null
          field_mapping: Json | null
          id: string
          is_active: boolean | null
          last_received_at: string | null
          name: string
          organization_id: string | null
          platform: string | null
          send_whatsapp: boolean | null
          slug: string
          total_errors: number | null
          total_processed: number | null
          total_received: number | null
          updated_at: string | null
          user_id: string
          wa_delay_seconds: number | null
          wa_instance_id: string | null
          wa_message_template: string | null
        }
        Insert: {
          auto_tags?: string[] | null
          created_at?: string | null
          description?: string | null
          field_mapping?: Json | null
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          name: string
          organization_id?: string | null
          platform?: string | null
          send_whatsapp?: boolean | null
          slug: string
          total_errors?: number | null
          total_processed?: number | null
          total_received?: number | null
          updated_at?: string | null
          user_id: string
          wa_delay_seconds?: number | null
          wa_instance_id?: string | null
          wa_message_template?: string | null
        }
        Update: {
          auto_tags?: string[] | null
          created_at?: string | null
          description?: string | null
          field_mapping?: Json | null
          id?: string
          is_active?: boolean | null
          last_received_at?: string | null
          name?: string
          organization_id?: string | null
          platform?: string | null
          send_whatsapp?: boolean | null
          slug?: string
          total_errors?: number | null
          total_processed?: number | null
          total_received?: number | null
          updated_at?: string | null
          user_id?: string
          wa_delay_seconds?: number | null
          wa_instance_id?: string | null
          wa_message_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_webhooks_wa_instance_id_fkey"
            columns: ["wa_instance_id"]
            isOneToOne: false
            referencedRelation: "wa_instances"
            referencedColumns: ["id"]
          },
        ]
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
      meta_capi_batches: {
        Row: {
          batch_size: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          events_count: number | null
          events_failed: number
          events_sent: number
          id: string
          meta_response: Json | null
          pixel_id: string
          response_body: Json | null
          sent_at: string | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          events_count?: number | null
          events_failed?: number
          events_sent?: number
          id?: string
          meta_response?: Json | null
          pixel_id: string
          response_body?: Json | null
          sent_at?: string | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          events_count?: number | null
          events_failed?: number
          events_sent?: number
          id?: string
          meta_response?: Json | null
          pixel_id?: string
          response_body?: Json | null
          sent_at?: string | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_capi_batches_pixel_id_fkey"
            columns: ["pixel_id"]
            isOneToOne: false
            referencedRelation: "meta_pixels"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_capi_events: {
        Row: {
          action_source: string
          batch_id: string | null
          content_category: string | null
          content_ids: string[] | null
          content_name: string | null
          content_type: string | null
          created_at: string
          currency: string | null
          custom_data: Json | null
          error_message: string | null
          event_id: string | null
          event_name: string
          event_source_url: string | null
          event_time: string
          id: string
          meta_response: Json | null
          num_items: number | null
          order_id: string | null
          pixel_id: string
          predicted_ltv: number | null
          response_body: Json | null
          response_code: number | null
          sent_at: string | null
          status: string
          user_city: string | null
          user_country: string | null
          user_data: Json | null
          user_email_hash: string | null
          user_external_id: string | null
          user_fbc: string | null
          user_fbp: string | null
          user_id: string
          user_ip: string | null
          user_phone_hash: string | null
          user_user_agent: string | null
          value: number | null
        }
        Insert: {
          action_source?: string
          batch_id?: string | null
          content_category?: string | null
          content_ids?: string[] | null
          content_name?: string | null
          content_type?: string | null
          created_at?: string
          currency?: string | null
          custom_data?: Json | null
          error_message?: string | null
          event_id?: string | null
          event_name: string
          event_source_url?: string | null
          event_time?: string
          id?: string
          meta_response?: Json | null
          num_items?: number | null
          order_id?: string | null
          pixel_id: string
          predicted_ltv?: number | null
          response_body?: Json | null
          response_code?: number | null
          sent_at?: string | null
          status?: string
          user_city?: string | null
          user_country?: string | null
          user_data?: Json | null
          user_email_hash?: string | null
          user_external_id?: string | null
          user_fbc?: string | null
          user_fbp?: string | null
          user_id: string
          user_ip?: string | null
          user_phone_hash?: string | null
          user_user_agent?: string | null
          value?: number | null
        }
        Update: {
          action_source?: string
          batch_id?: string | null
          content_category?: string | null
          content_ids?: string[] | null
          content_name?: string | null
          content_type?: string | null
          created_at?: string
          currency?: string | null
          custom_data?: Json | null
          error_message?: string | null
          event_id?: string | null
          event_name?: string
          event_source_url?: string | null
          event_time?: string
          id?: string
          meta_response?: Json | null
          num_items?: number | null
          order_id?: string | null
          pixel_id?: string
          predicted_ltv?: number | null
          response_body?: Json | null
          response_code?: number | null
          sent_at?: string | null
          status?: string
          user_city?: string | null
          user_country?: string | null
          user_data?: Json | null
          user_email_hash?: string | null
          user_external_id?: string | null
          user_fbc?: string | null
          user_fbp?: string | null
          user_id?: string
          user_ip?: string | null
          user_phone_hash?: string | null
          user_user_agent?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_capi_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "meta_capi_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_capi_events_pixel_id_fkey"
            columns: ["pixel_id"]
            isOneToOne: false
            referencedRelation: "meta_pixels"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_pixels: {
        Row: {
          access_token_encrypted: string | null
          created_at: string
          domain: string | null
          events_today: number | null
          events_total: number | null
          id: string
          is_active: boolean
          last_event_at: string | null
          pixel_id: string
          pixel_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          created_at?: string
          domain?: string | null
          events_today?: number | null
          events_total?: number | null
          id?: string
          is_active?: boolean
          last_event_at?: string | null
          pixel_id: string
          pixel_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          created_at?: string
          domain?: string | null
          events_today?: number | null
          events_total?: number | null
          id?: string
          is_active?: boolean
          last_event_at?: string | null
          pixel_id?: string
          pixel_name?: string
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
          quiz_completed: boolean | null
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
          quiz_completed?: boolean | null
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
          quiz_completed?: boolean | null
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
      user_quiz_responses: {
        Row: {
          created_at: string
          id: string
          nicho_identificado: string
          respostas_completas: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nicho_identificado: string
          respostas_completas: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nicho_identificado?: string
          respostas_completas?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_ai_agents: {
        Row: {
          address: string | null
          agent_type: string
          blocked_categories: string[] | null
          business_hours_end: string | null
          business_hours_only: boolean
          business_hours_start: string | null
          company_name: string | null
          created_at: string
          human_whatsapp: string | null
          id: string
          instance_id: string | null
          instance_ids: string[] | null
          is_active: boolean
          max_tokens: number
          model: string
          n8n_webhook_url: string | null
          name: string
          reply_delay_ms: number
          services: string | null
          system_prompt: string
          temperature: number
          total_replies: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          agent_type?: string
          blocked_categories?: string[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean
          business_hours_start?: string | null
          company_name?: string | null
          created_at?: string
          human_whatsapp?: string | null
          id?: string
          instance_id?: string | null
          instance_ids?: string[] | null
          is_active?: boolean
          max_tokens?: number
          model?: string
          n8n_webhook_url?: string | null
          name?: string
          reply_delay_ms?: number
          services?: string | null
          system_prompt: string
          temperature?: number
          total_replies?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          agent_type?: string
          blocked_categories?: string[] | null
          business_hours_end?: string | null
          business_hours_only?: boolean
          business_hours_start?: string | null
          company_name?: string | null
          created_at?: string
          human_whatsapp?: string | null
          id?: string
          instance_id?: string | null
          instance_ids?: string[] | null
          is_active?: boolean
          max_tokens?: number
          model?: string
          n8n_webhook_url?: string | null
          name?: string
          reply_delay_ms?: number
          services?: string | null
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
      wa_capi_funnel: {
        Row: {
          contact_id: string | null
          created_at: string
          currency: string | null
          custom_data: Json | null
          event_name: string
          event_sent: boolean | null
          fbclid: string | null
          funnel_stage: string
          id: string
          meta_response: Json | null
          phone: string
          pixel_id: string | null
          sent_at: string | null
          user_id: string
          utm_campaign: string | null
          utm_source: string | null
          value: number | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          custom_data?: Json | null
          event_name: string
          event_sent?: boolean | null
          fbclid?: string | null
          funnel_stage?: string
          id?: string
          meta_response?: Json | null
          phone: string
          pixel_id?: string | null
          sent_at?: string | null
          user_id: string
          utm_campaign?: string | null
          utm_source?: string | null
          value?: number | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          currency?: string | null
          custom_data?: Json | null
          event_name?: string
          event_sent?: boolean | null
          fbclid?: string | null
          funnel_stage?: string
          id?: string
          meta_response?: Json | null
          phone?: string
          pixel_id?: string | null
          sent_at?: string | null
          user_id?: string
          utm_campaign?: string | null
          utm_source?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_capi_funnel_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_capi_funnel_pixel_id_fkey"
            columns: ["pixel_id"]
            isOneToOne: false
            referencedRelation: "meta_pixels"
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
          capi_events_sent: Json | null
          created_at: string
          current_instance_id: string | null
          fbclid: string | null
          funnel_stage: string | null
          funnel_updated_at: string | null
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
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          capi_events_sent?: Json | null
          created_at?: string
          current_instance_id?: string | null
          fbclid?: string | null
          funnel_stage?: string | null
          funnel_updated_at?: string | null
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
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          capi_events_sent?: Json | null
          created_at?: string
          current_instance_id?: string | null
          fbclid?: string | null
          funnel_stage?: string | null
          funnel_updated_at?: string | null
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
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
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
      webhook_logs: {
        Row: {
          contact_id: string | null
          created_at: string | null
          error_message: string | null
          extracted_data: Json | null
          id: string
          ip_address: string | null
          processed_at: string | null
          raw_payload: Json
          status: string | null
          user_agent: string | null
          webhook_id: string
          whatsapp_sent: boolean | null
          whatsapp_sent_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          extracted_data?: Json | null
          id?: string
          ip_address?: string | null
          processed_at?: string | null
          raw_payload: Json
          status?: string | null
          user_agent?: string | null
          webhook_id: string
          whatsapp_sent?: boolean | null
          whatsapp_sent_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          extracted_data?: Json | null
          id?: string
          ip_address?: string | null
          processed_at?: string | null
          raw_payload?: Json
          status?: string | null
          user_agent?: string | null
          webhook_id?: string
          whatsapp_sent?: boolean | null
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_logs_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "external_webhooks"
            referencedColumns: ["id"]
          },
        ]
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
      hash_user_data: { Args: { input: string }; Returns: string }
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
      search_datastore_chunks: {
        Args: {
          p_datastore_id: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_name: string
        }[]
      }
      search_datastore_fulltext: {
        Args: {
          p_datastore_id: string
          p_match_count?: number
          p_query: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          source_name: string
        }[]
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
