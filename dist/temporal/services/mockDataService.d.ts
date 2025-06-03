/**
 * Mock Data Service
 * Service for generating mock data for testing and fallback scenarios
 */
import { EmailConfig } from './emailConfigService';
export interface Site {
    id: string;
    name: string;
    url: string;
    user_id: string;
    created_at: string;
    updated_at: string;
    email?: EmailConfig;
}
export interface CronStatus {
    id: string;
    site_id: string;
    workflow_id: string;
    schedule_id: string;
    activity_name: string;
    status: string;
    last_run: string | null;
    next_run: string | null;
    error_message: string | null;
    retry_count: number;
    created_at: string;
    updated_at: string;
}
export declare class MockDataService {
    /**
     * Generate mock sites data with various email configurations
     */
    static generateMockSites(): Site[];
    /**
     * Generate mock cron status data with various states
     */
    static generateMockCronStatuses(): CronStatus[];
    /**
     * Generate mock settings data with email configurations
     */
    static generateMockSettings(): any[];
    /**
     * Generate a complete mock dataset for testing
     */
    static generateCompleteDataset(): {
        sites: Site[];
        cronStatuses: CronStatus[];
        settings: any[];
    };
    /**
     * Generate mock site with specific configuration
     */
    static generateMockSite(overrides?: Partial<Site>): Site;
    /**
     * Generate mock cron status with specific configuration
     */
    static generateMockCronStatus(overrides?: Partial<CronStatus>): CronStatus;
}
