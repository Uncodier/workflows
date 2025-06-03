/**
 * Supabase Service
 * Centralized service for all Supabase database operations
 */
export interface DatabaseConfig {
    url: string;
    key: string;
}
export declare class SupabaseService {
    private client;
    private isConnected;
    private connectionTested;
    constructor(config?: DatabaseConfig);
    private testConnection;
    getConnectionStatus(): Promise<boolean>;
    /**
     * Fetch all sites from the database
     */
    fetchSites(): Promise<any[]>;
    /**
     * Fetch settings for specific site IDs
     */
    fetchSettings(siteIds: string[]): Promise<any[]>;
    /**
     * Fetch sites that have email sync enabled (channels.email.enabled = true)
     */
    fetchSitesWithEmailEnabled(): Promise<any[]>;
    /**
     * Fetch cron status records for specific activity and site IDs
     */
    fetchCronStatus(activityName: string, siteIds: string[]): Promise<any[]>;
    /**
     * Update or insert cron status record
     */
    upsertCronStatus(cronStatusRecord: any): Promise<void>;
    /**
     * Batch update multiple cron status records
     */
    batchUpsertCronStatus(records: any[]): Promise<void>;
    /**
     * Create agents in the database
     */
    createAgents(agents: any[]): Promise<any[]>;
    /**
     * Create a single agent in the database
     */
    createAgent(agentData: any): Promise<any>;
}
export declare function getSupabaseService(config?: DatabaseConfig): SupabaseService;
