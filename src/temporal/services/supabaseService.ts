/**
 * Supabase Service
 * Centralized service for all Supabase database operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DatabaseConfig } from './supabase-impl/types';

// Import implementations
import * as SitesImpl from './supabase-impl/sites';
import * as SettingsImpl from './supabase-impl/settings';
import * as ContentImpl from './supabase-impl/content';
import * as CronImpl from './supabase-impl/cron';
import * as LeadsImpl from './supabase-impl/leads';
import * as CompaniesImpl from './supabase-impl/companies';
import * as AgentsImpl from './supabase-impl/agents';
import * as SegmentsImpl from './supabase-impl/segments';

export type { DatabaseConfig };

export class SupabaseService {
  private client: SupabaseClient;
  private isConnected: boolean = false;
  private connectionTested: boolean = false;

  constructor(config?: DatabaseConfig) {
    // Try different environment variable names
    const supabaseUrl = config?.url || 
      process.env.NEXT_PUBLIC_SUPABASE_URL || 
      process.env.SUPABASE_URL || 
      'https://your-project.supabase.co';
    
    const supabaseKey = config?.key || 
      process.env.SUPABASE_SERVICE_ROLE_KEY ||  // Service role key can bypass RLS
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY ||
      'your-anon-key';
    
    console.log('🔧 Supabase configuration:');
    console.log(`   - URL: ${supabaseUrl}`);
    console.log(`   - Key: ${supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'NOT_SET'}`);
    console.log(`   - Key type: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE (can bypass RLS)' : 'ANON (subject to RLS)'}`);
    console.log(`   - Environment variables available:`, {
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
      SUPABASE_KEY: !!process.env.SUPABASE_KEY
    });
    
    this.client = createClient(supabaseUrl, supabaseKey);
  }

  private async testConnection(): Promise<boolean> {
    if (this.connectionTested) {
      return this.isConnected;
    }

    try {
      console.log('🔍 Testing Supabase connection...');
      const { data, error } = await this.client.from('sites').select('id').limit(1);
      
      if (error) {
        console.warn('⚠️  Supabase connection test failed:', error.message);
        console.warn('   Error code:', error.code);
        console.warn('   Error details:', error.details);
        console.warn('   Error hint:', error.hint);
        this.isConnected = false;
      } else {
        console.log('✅ Supabase connection established successfully');
        console.log(`   - Test query returned ${data?.length || 0} records`);
        this.isConnected = true;
      }
    } catch (error) {
      console.warn('⚠️  Supabase connection test failed with exception:', error);
      this.isConnected = false;
    }

    this.connectionTested = true;
    return this.isConnected;
  }

  public async getConnectionStatus(): Promise<boolean> {
    return await this.testConnection();
  }

  /**
   * Ensure database is connected before proceeding
   */
  private async ensureConnection(): Promise<void> {
    const isConnected = await this.getConnectionStatus();
    if (!isConnected) {
      throw new Error('Database not connected');
    }
  }

  // --- SITES ---

  async fetchSites(): Promise<any[]> {
    await this.ensureConnection();
    return SitesImpl.fetchSites(this.client);
  }

  async fetchSitesWithEmailEnabled(): Promise<any[]> {
    await this.ensureConnection();
    return SitesImpl.fetchSitesWithEmailEnabled(this.client);
  }

  // --- SETTINGS ---

  async fetchSettings(siteIds: string[]): Promise<any[]> {
    await this.ensureConnection();
    return SettingsImpl.fetchSettings(this.client, siteIds);
  }

  async fetchCompleteSettings(siteIds: string[]): Promise<any[]> {
    await this.ensureConnection();
    return SettingsImpl.fetchCompleteSettings(this.client, siteIds);
  }

  async updateSiteSettings(siteId: string, updateData: any): Promise<any> {
    await this.ensureConnection();
    return SettingsImpl.updateSiteSettings(this.client, siteId, updateData);
  }

  // --- CONTENT & ANALYSIS ---

  async fetchDraftContent(siteId: string): Promise<any[]> {
    await this.ensureConnection();
    return ContentImpl.fetchDraftContent(this.client, siteId);
  }

  async fetchSiteAnalysis(siteId: string): Promise<any[]> {
    await this.ensureConnection();
    return ContentImpl.fetchSiteAnalysis(this.client, siteId);
  }

  async hasSiteAnalysis(siteId: string): Promise<{ hasAnalysis: boolean; lastAnalysis?: any; count: number }> {
    await this.ensureConnection();
    // hasSiteAnalysis handles its own error catching, but we still check connection
    // although fetchSiteAnalysis inside it checks connection, redundant check is fine.
    // However, the original code had connection check inside fetchSiteAnalysis but hasSiteAnalysis called it.
    // Let's keep consistency.
    return ContentImpl.hasSiteAnalysis(this.client, siteId);
  }

  // --- CRON ---

  async fetchCronStatus(activityName: string, siteIds: string[]): Promise<any[]> {
    await this.ensureConnection();
    return CronImpl.fetchCronStatus(this.client, activityName, siteIds);
  }

  async upsertCronStatus(cronStatusRecord: any): Promise<void> {
    await this.ensureConnection();
    return CronImpl.upsertCronStatus(this.client, cronStatusRecord);
  }

  async batchUpsertCronStatus(records: any[]): Promise<void> {
    await this.ensureConnection();
    // batchUpsert calls upsertCronStatus which checks connection, but let's check here too or let it propagate
    // The implementation receives client.
    return CronImpl.batchUpsertCronStatus(this.client, records);
  }

  async fetchStuckCronStatus(hoursThreshold: number = 2): Promise<any[]> {
    await this.ensureConnection();
    return CronImpl.fetchStuckCronStatus(this.client, hoursThreshold);
  }

  async fetchAllRunningCronStatus(): Promise<any[]> {
    await this.ensureConnection();
    return CronImpl.fetchAllRunningCronStatus(this.client);
  }

  async resetCronStatusToFailed(recordId: string, errorMessage: string): Promise<void> {
    await this.ensureConnection();
    return CronImpl.resetCronStatusToFailed(this.client, recordId, errorMessage);
  }

  async fetchRecentCronStatus(limit: number = 10): Promise<any[]> {
    await this.ensureConnection();
    return CronImpl.fetchRecentCronStatus(this.client, limit);
  }

  // --- LEADS ---

  async fetchLead(leadId: string): Promise<any> {
    await this.ensureConnection();
    return LeadsImpl.fetchLead(this.client, leadId);
  }

  async updateLead(leadId: string, updateData: any): Promise<any> {
    await this.ensureConnection();
    return LeadsImpl.updateLead(this.client, leadId, updateData);
  }

  async fetchLeadsBySegmentsAndStatus(
    siteId: string,
    segmentIds: string[],
    status: string[],
    limit?: number
  ): Promise<{ data: any[] | null; error: any }> {
    await this.ensureConnection();
    return LeadsImpl.fetchLeadsBySegmentsAndStatus(this.client, siteId, segmentIds, status, limit);
  }

  // --- COMPANIES ---

  async fetchCompany(companyId: string): Promise<any> {
    await this.ensureConnection();
    return CompaniesImpl.fetchCompany(this.client, companyId);
  }

  async upsertCompany(companyData: any): Promise<any> {
    await this.ensureConnection();
    return CompaniesImpl.upsertCompany(this.client, companyData);
  }

  // --- AGENTS ---

  async createAgents(agents: any[]): Promise<any[]> {
    await this.ensureConnection();
    return AgentsImpl.createAgents(this.client, agents);
  }

  async createAgent(agentData: any): Promise<any> {
    await this.ensureConnection();
    return AgentsImpl.createAgent(this.client, agentData);
  }

  // --- SEGMENTS ---

  async fetchSegments(siteId: string): Promise<any[]> {
    await this.ensureConnection();
    return SegmentsImpl.fetchSegments(this.client, siteId);
  }
}

// Singleton instance
let supabaseServiceInstance: SupabaseService | null = null;

export function getSupabaseService(config?: DatabaseConfig): SupabaseService {
  if (!supabaseServiceInstance) {
    supabaseServiceInstance = new SupabaseService(config);
  }
  return supabaseServiceInstance;
}
