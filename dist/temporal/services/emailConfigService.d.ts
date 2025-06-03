/**
 * Email Configuration Service
 * Service for handling email configuration validation and processing
 */
export interface EmailConfig {
    email: string;
    enabled: boolean;
    password: string;
    incomingPort: string;
    outgoingPort: string;
    incomingServer: string;
    outgoingServer: string;
}
export interface EmailValidationResult {
    isValid: boolean;
    reason: string;
    errors: string[];
}
export declare class EmailConfigService {
    /**
     * Validate email configuration for a site
     */
    static validateEmailConfig(emailConfig?: EmailConfig): EmailValidationResult;
    /**
     * Extract email configuration from settings data
     * Looks for settings.channels.email structure
     */
    static extractEmailConfigFromSettings(settings: any): EmailConfig | null;
    /**
     * Get email provider type based on server configuration
     */
    static getEmailProvider(emailConfig: EmailConfig): string;
    /**
     * Get default configuration for common email providers
     */
    static getDefaultConfigForProvider(provider: string): Partial<EmailConfig>;
    /**
     * Validate email address format
     */
    private static isValidEmailAddress;
    /**
     * Validate server address format
     */
    private static isValidServerAddress;
    /**
     * Validate port number
     */
    private static isValidPort;
    /**
     * Mask sensitive information in email config for logging
     */
    static maskSensitiveInfo(emailConfig: EmailConfig): Partial<EmailConfig>;
}
