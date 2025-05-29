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

export class MockDataService {
  /**
   * Generate mock sites data with various email configurations
   */
  static generateMockSites(): Site[] {
    return [
      {
        id: 'site-1',
        name: 'E-commerce Store',
        url: 'https://store.example.com',
        user_id: 'user-1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        email: {
          email: 'store@example.com',
          enabled: true,
          password: 'secure_password_123',
          incomingPort: '993',
          outgoingPort: '587',
          incomingServer: 'imap.gmail.com',
          outgoingServer: 'smtp.gmail.com'
        }
      },
      {
        id: 'site-2', 
        name: 'Marketing Agency',
        url: 'https://agency.example.com',
        user_id: 'user-2',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        email: {
          email: 'contact@agency.example.com',
          enabled: false, // Disabled
          password: 'agency_pass_456',
          incomingPort: '993',
          outgoingPort: '587',
          incomingServer: 'imap.gmail.com',
          outgoingServer: 'smtp.gmail.com'
        }
      },
      {
        id: 'site-3',
        name: 'SaaS Platform',
        url: 'https://saas.example.com', 
        user_id: 'user-3',
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
        email: {
          email: 'support@saas.example.com',
          enabled: true,
          password: 'saas_secure_789',
          incomingPort: '993',
          outgoingPort: '587',
          incomingServer: 'imap.outlook.com',
          outgoingServer: 'smtp.outlook.com'
        }
      },
      {
        id: 'site-4',
        name: 'Blog Platform',
        url: 'https://blog.example.com',
        user_id: 'user-4', 
        created_at: '2024-01-04T00:00:00Z',
        updated_at: '2024-01-04T00:00:00Z',
        email: {
          email: '', // Missing email
          enabled: true,
          password: 'blog_pass_101',
          incomingPort: '993',
          outgoingPort: '587',
          incomingServer: 'imap.gmail.com',
          outgoingServer: 'smtp.gmail.com'
        }
      },
      {
        id: 'site-5',
        name: 'Corporate Website',
        url: 'https://corp.example.com',
        user_id: 'user-5',
        created_at: '2024-01-05T00:00:00Z',
        updated_at: '2024-01-05T00:00:00Z'
        // No email configuration at all
      }
    ];
  }

  /**
   * Generate mock cron status data with various states
   */
  static generateMockCronStatuses(): CronStatus[] {
    return [
      {
        id: 'cron-1',
        site_id: 'site-1',
        workflow_id: 'sync-emails-site-1',
        schedule_id: 'email-sync-site-1',
        activity_name: 'syncEmailsWorkflow',
        status: 'COMPLETED',
        last_run: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        next_run: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour from now
        error_message: null,
        retry_count: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'cron-2',
        site_id: 'site-2',
        workflow_id: 'sync-emails-site-2',
        schedule_id: 'email-sync-site-2', 
        activity_name: 'syncEmailsWorkflow',
        status: 'FAILED',
        last_run: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
        next_run: null,
        error_message: 'Connection timeout to email provider',
        retry_count: 3,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'cron-3',
        site_id: 'site-3',
        workflow_id: 'sync-emails-site-3',
        schedule_id: 'email-sync-site-3',
        activity_name: 'syncEmailsWorkflow', 
        status: 'RUNNING',
        last_run: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
        next_run: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes from now
        error_message: null,
        retry_count: 0,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString()
      }
    ];
  }

  /**
   * Generate mock settings data with email configurations
   */
  static generateMockSettings(): any[] {
    return [
      {
        site_id: 'site-1',
        channels: {
          email: {
            email: 'store@example.com',
            enabled: true,
            password: 'secure_password_123',
            incomingPort: '993',
            outgoingPort: '587',
            incomingServer: 'imap.gmail.com',
            outgoingServer: 'smtp.gmail.com'
          }
        }
      },
      {
        site_id: 'site-2',
        channels: {
          email: {
            email: 'contact@agency.example.com',
            enabled: false,
            password: 'agency_pass_456',
            incomingPort: '993',
            outgoingPort: '587',
            incomingServer: 'imap.gmail.com',
            outgoingServer: 'smtp.gmail.com'
          }
        }
      },
      {
        site_id: 'site-3',
        channels: {
          email: {
            email: 'support@saas.example.com',
            enabled: true,
            password: 'saas_secure_789',
            incomingPort: '993',
            outgoingPort: '587',
            incomingServer: 'imap.outlook.com',
            outgoingServer: 'smtp.outlook.com'
          }
        }
      },
      {
        site_id: 'site-4',
        channels: {
          email: {
            email: '',
            enabled: true,
            password: 'blog_pass_101',
            incomingPort: '993',
            outgoingPort: '587',
            incomingServer: 'imap.gmail.com',
            outgoingServer: 'smtp.gmail.com'
          }
        }
      }
      // site-5 has no settings record (no email configuration)
    ];
  }

  /**
   * Generate a complete mock dataset for testing
   */
  static generateCompleteDataset(): {
    sites: Site[];
    cronStatuses: CronStatus[];
    settings: any[];
  } {
    return {
      sites: this.generateMockSites(),
      cronStatuses: this.generateMockCronStatuses(),
      settings: this.generateMockSettings()
    };
  }

  /**
   * Generate mock site with specific configuration
   */
  static generateMockSite(overrides: Partial<Site> = {}): Site {
    const defaultSite: Site = {
      id: `site-${Date.now()}`,
      name: 'Test Site',
      url: 'https://test.example.com',
      user_id: 'test-user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return { ...defaultSite, ...overrides };
  }

  /**
   * Generate mock cron status with specific configuration
   */
  static generateMockCronStatus(overrides: Partial<CronStatus> = {}): CronStatus {
    const defaultCronStatus: CronStatus = {
      id: `cron-${Date.now()}`,
      site_id: 'test-site',
      workflow_id: 'test-workflow',
      schedule_id: 'test-schedule',
      activity_name: 'syncEmailsWorkflow',
      status: 'COMPLETED',
      last_run: new Date().toISOString(),
      next_run: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      error_message: null,
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return { ...defaultCronStatus, ...overrides };
  }
} 