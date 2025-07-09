"use strict";
/**
 * Supabase Service
 * Centralized service for all Supabase database operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseService = void 0;
exports.getSupabaseService = getSupabaseService;
const supabase_js_1 = require("@supabase/supabase-js");
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
     * Fetch all sites from the database
     */
    async fetchSites() {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log('🔍 Fetching sites from Supabase...');
        const { data, error } = await this.client
            .from('sites')
            .select('*');
        if (error) {
            console.error('❌ Error fetching sites:', error);
            throw new Error(`Failed to fetch sites: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} sites from database`);
        return data || [];
    }
    /**
     * Fetch settings for specific site IDs
     */
    async fetchSettings(siteIds) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching settings for ${siteIds.length} sites from Supabase...`);
        const { data, error } = await this.client
            .from('settings')
            .select('site_id, channels')
            .in('site_id', siteIds);
        if (error) {
            console.error('❌ Error fetching settings:', error);
            throw new Error(`Failed to fetch settings: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} settings from database`);
        return data || [];
    }
    /**
     * Fetch complete settings for specific site IDs including business_hours
     */
    async fetchCompleteSettings(siteIds) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching complete settings for ${siteIds.length} sites from Supabase...`);
        const { data, error } = await this.client
            .from('settings')
            .select('*')
            .in('site_id', siteIds);
        if (error) {
            console.error('❌ Error fetching complete settings:', error);
            throw new Error(`Failed to fetch complete settings: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} complete settings from database`);
        // Log which fields we actually got for debugging
        if (data && data.length > 0) {
            const availableFields = Object.keys(data[0]);
            console.log(`📊 Available settings fields:`, {
                about: availableFields.includes('about'),
                industry: availableFields.includes('industry'),
                company_size: availableFields.includes('company_size'),
                products: availableFields.includes('products'),
                services: availableFields.includes('services'),
                goals: availableFields.includes('goals'),
                competitors: availableFields.includes('competitors'),
                branding: availableFields.includes('branding'),
                team_members: availableFields.includes('team_members'),
                locations: availableFields.includes('locations'),
                business_hours: availableFields.includes('business_hours'),
                channels: availableFields.includes('channels'),
                social_media: availableFields.includes('social_media'),
                swot: availableFields.includes('swot'),
                marketing_channels: availableFields.includes('marketing_channels'),
                marketing_budget: availableFields.includes('marketing_budget'),
                team_roles: availableFields.includes('team_roles'),
                org_structure: availableFields.includes('org_structure')
            });
        }
        return data || [];
    }
    /**
     * Fetch sites that have email sync enabled (channels.email.enabled = true)
     */
    async fetchSitesWithEmailEnabled() {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log('🔍 Fetching sites with email sync enabled...');
        // First, get all settings that have email enabled
        const { data: settingsData, error: settingsError } = await this.client
            .from('settings')
            .select('site_id, channels')
            .not('channels->email->enabled', 'is', null);
        if (settingsError) {
            console.error('❌ Error fetching settings with email:', settingsError);
            throw new Error(`Failed to fetch settings: ${settingsError.message}`);
        }
        // Filter settings that have email.enabled = true
        const enabledEmailSettings = (settingsData || []).filter(setting => setting.channels?.email?.enabled === true);
        console.log(`✅ Found ${enabledEmailSettings.length} settings with email enabled`);
        if (enabledEmailSettings.length === 0) {
            return [];
        }
        // Get the corresponding sites
        const siteIds = enabledEmailSettings.map(setting => setting.site_id);
        console.log(`🔍 Fetching sites data for ${siteIds.length} site IDs...`);
        const { data: sitesData, error: sitesError } = await this.client
            .from('sites')
            .select('*')
            .in('id', siteIds);
        if (sitesError) {
            console.error('❌ Error fetching sites:', sitesError);
            throw new Error(`Failed to fetch sites: ${sitesError.message}`);
        }
        console.log(`✅ Successfully fetched ${sitesData?.length || 0} sites with email enabled`);
        // Combine sites with their email settings
        const sitesWithEmailConfig = (sitesData || []).map(site => {
            const siteSettings = enabledEmailSettings.find(setting => setting.site_id === site.id);
            return {
                ...site,
                emailSettings: siteSettings?.channels?.email || null
            };
        });
        return sitesWithEmailConfig;
    }
    /**
     * Fetch draft content for a specific site
     */
    async fetchDraftContent(siteId) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching draft content for site: ${siteId}`);
        const { data, error } = await this.client
            .from('content')
            .select('*')
            .eq('site_id', siteId)
            .eq('status', 'draft');
        if (error) {
            console.error('❌ Error fetching draft content:', error);
            throw new Error(`Failed to fetch draft content: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} draft content records from database`);
        return data || [];
    }
    /**
     * Fetch cron status records for specific activity and site IDs
     */
    async fetchCronStatus(activityName, siteIds) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching cron status for activity '${activityName}' and ${siteIds.length} sites...`);
        const { data, error } = await this.client
            .from('cron_status')
            .select('*')
            .eq('activity_name', activityName)
            .in('site_id', siteIds);
        if (error) {
            console.error('❌ Error fetching cron status:', error);
            throw new Error(`Failed to fetch cron status: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} cron status records from database`);
        return data || [];
    }
    /**
     * Update or insert cron status record
     */
    async upsertCronStatus(cronStatusRecord) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Upserting cron status for site ${cronStatusRecord.site_id}...`);
        // Try to find existing record
        const { data: existingRecord, error: selectError } = await this.client
            .from('cron_status')
            .select('id')
            .eq('site_id', cronStatusRecord.site_id)
            .eq('activity_name', cronStatusRecord.activity_name)
            .single();
        if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error('❌ Error checking existing cron status:', selectError);
            throw new Error(`Failed to check existing cron status: ${selectError.message}`);
        }
        if (existingRecord) {
            // Update existing record
            console.log(`📝 Updating existing cron status record ${existingRecord.id}...`);
            const { error: updateError } = await this.client
                .from('cron_status')
                .update({
                ...cronStatusRecord,
                updated_at: new Date().toISOString()
            })
                .eq('id', existingRecord.id);
            if (updateError) {
                console.error('❌ Error updating cron status:', updateError);
                throw new Error(`Failed to update cron status: ${updateError.message}`);
            }
            console.log('✅ Successfully updated cron status record');
        }
        else {
            // Insert new record
            console.log('📝 Inserting new cron status record...');
            const { error: insertError } = await this.client
                .from('cron_status')
                .insert({
                ...cronStatusRecord,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
            if (insertError) {
                console.error('❌ Error inserting cron status:', insertError);
                throw new Error(`Failed to insert cron status: ${insertError.message}`);
            }
            console.log('✅ Successfully inserted new cron status record');
        }
    }
    /**
     * Batch update multiple cron status records
     */
    async batchUpsertCronStatus(records) {
        console.log(`📝 Batch upserting ${records.length} cron status records...`);
        for (const record of records) {
            await this.upsertCronStatus(record);
        }
        console.log(`✅ Successfully processed ${records.length} cron status records`);
    }
    /**
     * Fetch lead information by lead ID
     */
    async fetchLead(leadId) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching lead information for: ${leadId}`);
        const { data, error } = await this.client
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .single();
        if (error) {
            console.error(`❌ Error fetching lead ${leadId}:`, error);
            throw new Error(`Failed to fetch lead: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Lead ${leadId} not found`);
        }
        console.log(`✅ Successfully fetched lead information for ${leadId}`);
        return data;
    }
    /**
     * Update lead information by lead ID
     */
    async updateLead(leadId, updateData) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Updating lead information for: ${leadId}`);
        console.log(`📝 Update data:`, JSON.stringify(updateData, null, 2));
        const { data, error } = await this.client
            .from('leads')
            .update({
            ...updateData,
            updated_at: new Date().toISOString()
        })
            .eq('id', leadId)
            .select()
            .single();
        if (error) {
            console.error(`❌ Error updating lead ${leadId}:`, error);
            throw new Error(`Failed to update lead: ${error.message}`);
        }
        if (!data) {
            throw new Error(`Lead ${leadId} not found or update failed`);
        }
        console.log(`✅ Successfully updated lead information for ${leadId}`);
        return data;
    }
    /**
     * Fetch company by ID
     */
    async fetchCompany(companyId) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🏢 Fetching company: ${companyId}`);
        const { data, error } = await this.client
            .from('companies')
            .select('*')
            .eq('id', companyId)
            .single();
        if (error) {
            if (error.code === 'PGRST116') { // No rows returned
                console.log(`⚠️  Company ${companyId} not found`);
                return null;
            }
            console.error('❌ Error fetching company:', error);
            throw new Error(`Failed to fetch company: ${error.message}`);
        }
        console.log(`✅ Successfully fetched company: ${data.name}`);
        return data;
    }
    /**
     * Create or update company information
     */
    async upsertCompany(companyData) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🏢 Upserting company: ${companyData.name}`);
        console.log(`📝 Company data:`, JSON.stringify(companyData, null, 2));
        // If ID is provided, try to update first
        if (companyData.id) {
            const { data: updateData, error: updateError } = await this.client
                .from('companies')
                .update({
                ...companyData,
                updated_at: new Date().toISOString()
            })
                .eq('id', companyData.id)
                .select()
                .single();
            if (!updateError) {
                console.log(`✅ Successfully updated existing company: ${updateData.name}`);
                return updateData;
            }
            // If update failed and it's not a "not found" error, throw
            if (updateError.code !== 'PGRST116') {
                console.error('❌ Error updating company:', updateError);
                throw new Error(`Failed to update company: ${updateError.message}`);
            }
        }
        // If no ID provided or company not found, try to find by name first
        if (companyData.name) {
            const { data: existingCompany } = await this.client
                .from('companies')
                .select('*')
                .eq('name', companyData.name)
                .single();
            if (existingCompany) {
                // Update existing company found by name
                const { data: updateData, error: updateError } = await this.client
                    .from('companies')
                    .update({
                    ...companyData,
                    id: existingCompany.id,
                    updated_at: new Date().toISOString()
                })
                    .eq('id', existingCompany.id)
                    .select()
                    .single();
                if (updateError) {
                    console.error('❌ Error updating existing company by name:', updateError);
                    throw new Error(`Failed to update company: ${updateError.message}`);
                }
                console.log(`✅ Successfully updated existing company by name: ${updateData.name}`);
                return updateData;
            }
        }
        // Create new company
        const { data: insertData, error: insertError } = await this.client
            .from('companies')
            .insert({
            ...companyData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
            .select()
            .single();
        if (insertError) {
            console.error('❌ Error creating company:', insertError);
            throw new Error(`Failed to create company: ${insertError.message}`);
        }
        console.log(`✅ Successfully created new company: ${insertData.name}`);
        return insertData;
    }
    /**
     * Fetch segments for a specific site
     */
    async fetchSegments(siteId) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Fetching segments for site: ${siteId}`);
        const { data, error } = await this.client
            .from('segments')
            .select('*')
            .eq('site_id', siteId)
            .order('created_at', { ascending: false });
        if (error) {
            console.error('❌ Error fetching segments:', error);
            throw new Error(`Failed to fetch segments: ${error.message}`);
        }
        console.log(`✅ Successfully fetched ${data?.length || 0} segments from database`);
        return data || [];
    }
    /**
     * Create agents in the database
     */
    async createAgents(agents) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Creating ${agents.length} agents in Supabase...`);
        const { data, error } = await this.client
            .from('agents')
            .insert(agents)
            .select();
        if (error) {
            console.error('❌ Error creating agents:', error);
            throw new Error(`Failed to create agents: ${error.message}`);
        }
        console.log(`✅ Successfully created ${data?.length || 0} agents in database`);
        return data || [];
    }
    /**
     * Create a single agent in the database
     */
    async createAgent(agentData) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            throw new Error('Database not connected');
        }
        console.log(`🔍 Creating agent '${agentData.name}' in Supabase...`);
        const { data, error } = await this.client
            .from('agents')
            .insert([agentData])
            .select()
            .single();
        if (error) {
            console.error('❌ Error creating agent:', error);
            throw new Error(`Failed to create agent: ${error.message}`);
        }
        console.log(`✅ Successfully created agent '${agentData.name}' with ID: ${data.id}`);
        return data;
    }
    /**
     * Fetch leads by segments and status with optional filters
     * Business Rules:
     * - segmentIds: if empty array, no segment filter is applied
     * - status: if empty array, no status filter is applied
     * - Always orders by created_at DESC (newest first)
     * - Always filters for leads with email (NOT NULL and not empty)
     * - Respects limit (brings latest X leads if more than limit)
     */
    async fetchLeadsBySegmentsAndStatus(siteId, segmentIds, status, limit) {
        const isConnected = await this.getConnectionStatus();
        if (!isConnected) {
            return { data: null, error: { message: 'Database not connected' } };
        }
        // Log the query parameters for debugging
        const hasSegmentFilter = segmentIds.length > 0;
        const hasStatusFilter = status.length > 0;
        console.log(`🔍 Fetching leads for site: ${siteId}`);
        console.log(`   - Segment filter: ${hasSegmentFilter ? segmentIds.join(', ') : 'None (all segments)'}`);
        console.log(`   - Status filter: ${hasStatusFilter ? status.join(', ') : 'None (all statuses)'}`);
        console.log(`   - Limit: ${limit || 500}`);
        console.log(`   - Order: Latest created first (created_at DESC)`);
        // Build query starting with basic filters
        let query = this.client
            .from('leads')
            .select('*')
            .eq('site_id', siteId)
            .not('email', 'is', null) // Email is not null
            .neq('email', ''); // Email is not empty string
        // Apply segment filter only if segmentIds is not empty
        if (hasSegmentFilter) {
            query = query.in('segment_id', segmentIds);
            console.log(`   ✓ Applied segment filter for ${segmentIds.length} segments`);
        }
        // Apply status filter only if status is not empty
        if (hasStatusFilter) {
            query = query.in('status', status);
            console.log(`   ✓ Applied status filter for ${status.length} statuses`);
        }
        // Always order by created_at DESC to get latest leads first
        query = query.order('created_at', { ascending: false });
        // Apply limit
        if (limit) {
            query = query.limit(limit);
        }
        const { data, error } = await query;
        if (error) {
            console.error('❌ Error fetching leads:', error);
            return { data: null, error };
        }
        const resultCount = data?.length || 0;
        console.log(`✅ Successfully fetched ${resultCount} leads from database`);
        // Log filter results for transparency
        if (!hasSegmentFilter && !hasStatusFilter) {
            console.log(`   📋 Query result: All leads with email from site (newest first)`);
        }
        else if (!hasSegmentFilter) {
            console.log(`   📋 Query result: All segments + status filter + email required (newest first)`);
        }
        else if (!hasStatusFilter) {
            console.log(`   📋 Query result: Segment filter + all statuses + email required (newest first)`);
        }
        else {
            console.log(`   📋 Query result: Segment filter + status filter + email required (newest first)`);
        }
        return { data, error: null };
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
