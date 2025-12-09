"use strict";
/**
 * Supabase Service
 * Centralized service for all Supabase database operations
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseService = void 0;
exports.getSupabaseService = getSupabaseService;
const supabase_js_1 = require("@supabase/supabase-js");
// Import implementations
const SitesImpl = __importStar(require("./supabase-impl/sites"));
const SettingsImpl = __importStar(require("./supabase-impl/settings"));
const ContentImpl = __importStar(require("./supabase-impl/content"));
const CronImpl = __importStar(require("./supabase-impl/cron"));
const LeadsImpl = __importStar(require("./supabase-impl/leads"));
const CompaniesImpl = __importStar(require("./supabase-impl/companies"));
const AgentsImpl = __importStar(require("./supabase-impl/agents"));
const SegmentsImpl = __importStar(require("./supabase-impl/segments"));
class SupabaseService {
    client;
    isConnected = false;
    connectionTested = false;
    constructor(config) {
        // Try different environment variable names
        const supabaseUrl = config?.url ||
            process.env.NEXT_PUBLIC_SUPABASE_URL ||
            process.env.SUPABASE_URL ||
            'https://your-project.supabase.co';
        const supabaseKey = config?.key ||
            process.env.SUPABASE_SERVICE_ROLE_KEY || // Service role key can bypass RLS
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
        this.client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    async testConnection() {
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
            }
            else {
                console.log('✅ Supabase connection established successfully');
                console.log(`   - Test query returned ${data?.length || 0} records`);
                this.isConnected = true;
            }
        }
        catch (error) {
            console.warn('⚠️  Supabase connection test failed with exception:', error);
            this.isConnected = false;
        }
        this.connectionTested = true;
        return this.isConnected;
    }
    async getConnectionStatus() {
        return await this.testConnection();
    }
    /**
     * Ensure database is connected before proceeding
     */
    async ensureConnection() {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
    }
    // --- SITES ---
    async fetchSites() {
        await this.ensureConnection();
        return SitesImpl.fetchSites(this.client);
    }
    async fetchSitesWithEmailEnabled() {
        await this.ensureConnection();
        return SitesImpl.fetchSitesWithEmailEnabled(this.client);
    }
    // --- SETTINGS ---
    async fetchSettings(siteIds) {
        await this.ensureConnection();
        return SettingsImpl.fetchSettings(this.client, siteIds);
    }
    async fetchCompleteSettings(siteIds) {
        await this.ensureConnection();
        return SettingsImpl.fetchCompleteSettings(this.client, siteIds);
    }
    async updateSiteSettings(siteId, updateData) {
        await this.ensureConnection();
        return SettingsImpl.updateSiteSettings(this.client, siteId, updateData);
    }
    // --- CONTENT & ANALYSIS ---
    async fetchDraftContent(siteId) {
        await this.ensureConnection();
        return ContentImpl.fetchDraftContent(this.client, siteId);
    }
    async fetchSiteAnalysis(siteId) {
        await this.ensureConnection();
        return ContentImpl.fetchSiteAnalysis(this.client, siteId);
    }
    async hasSiteAnalysis(siteId) {
        await this.ensureConnection();
        // hasSiteAnalysis handles its own error catching, but we still check connection
        // although fetchSiteAnalysis inside it checks connection, redundant check is fine.
        // However, the original code had connection check inside fetchSiteAnalysis but hasSiteAnalysis called it.
        // Let's keep consistency.
        return ContentImpl.hasSiteAnalysis(this.client, siteId);
    }
    // --- CRON ---
    async fetchCronStatus(activityName, siteIds) {
        await this.ensureConnection();
        return CronImpl.fetchCronStatus(this.client, activityName, siteIds);
    }
    async upsertCronStatus(cronStatusRecord) {
        await this.ensureConnection();
        return CronImpl.upsertCronStatus(this.client, cronStatusRecord);
    }
    async batchUpsertCronStatus(records) {
        await this.ensureConnection();
        // batchUpsert calls upsertCronStatus which checks connection, but let's check here too or let it propagate
        // The implementation receives client.
        return CronImpl.batchUpsertCronStatus(this.client, records);
    }
    async fetchStuckCronStatus(hoursThreshold = 2) {
        await this.ensureConnection();
        return CronImpl.fetchStuckCronStatus(this.client, hoursThreshold);
    }
    async fetchAllRunningCronStatus() {
        await this.ensureConnection();
        return CronImpl.fetchAllRunningCronStatus(this.client);
    }
    async resetCronStatusToFailed(recordId, errorMessage) {
        await this.ensureConnection();
        return CronImpl.resetCronStatusToFailed(this.client, recordId, errorMessage);
    }
    async fetchRecentCronStatus(limit = 10) {
        await this.ensureConnection();
        return CronImpl.fetchRecentCronStatus(this.client, limit);
    }
    // --- LEADS ---
    async fetchLead(leadId) {
        await this.ensureConnection();
        return LeadsImpl.fetchLead(this.client, leadId);
    }
    async updateLead(leadId, updateData) {
        await this.ensureConnection();
        return LeadsImpl.updateLead(this.client, leadId, updateData);
    }
    async fetchLeadsBySegmentsAndStatus(siteId, segmentIds, status, limit) {
        await this.ensureConnection();
        return LeadsImpl.fetchLeadsBySegmentsAndStatus(this.client, siteId, segmentIds, status, limit);
    }
    // --- COMPANIES ---
    async fetchCompany(companyId) {
        await this.ensureConnection();
        return CompaniesImpl.fetchCompany(this.client, companyId);
    }
    async upsertCompany(companyData) {
        await this.ensureConnection();
        return CompaniesImpl.upsertCompany(this.client, companyData);
    }
    // --- AGENTS ---
    async createAgents(agents) {
        await this.ensureConnection();
        return AgentsImpl.createAgents(this.client, agents);
    }
    async createAgent(agentData) {
        await this.ensureConnection();
        return AgentsImpl.createAgent(this.client, agentData);
    }
    // --- SEGMENTS ---
    async fetchSegments(siteId) {
        await this.ensureConnection();
        return SegmentsImpl.fetchSegments(this.client, siteId);
    }
}
exports.SupabaseService = SupabaseService;
// Singleton instance
let supabaseServiceInstance = null;
function getSupabaseService(config) {
    if (!supabaseServiceInstance) {
        supabaseServiceInstance = new SupabaseService(config);
    }
    return supabaseServiceInstance;
}
