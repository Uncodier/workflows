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

export class EmailConfigService {
  /**
   * Validate email configuration for a site
   */
  static validateEmailConfig(emailConfig?: EmailConfig): EmailValidationResult {
    const errors: string[] = [];

    if (!emailConfig) {
      return { 
        isValid: false, 
        reason: 'No email configuration found',
        errors: ['Email configuration is missing']
      };
    }

    if (!emailConfig.enabled) {
      return { 
        isValid: false, 
        reason: 'Email sync is disabled',
        errors: ['Email sync is disabled in configuration']
      };
    }

    // Validate email address
    if (!emailConfig.email || !emailConfig.email.trim()) {
      errors.push('Email address is missing');
    } else if (!this.isValidEmailAddress(emailConfig.email)) {
      errors.push('Email address format is invalid');
    }

    // Validate password
    if (!emailConfig.password || !emailConfig.password.trim()) {
      errors.push('Email password is missing');
    }

    // Validate servers
    if (!emailConfig.incomingServer || !emailConfig.incomingServer.trim()) {
      errors.push('Incoming server is missing');
    } else if (!this.isValidServerAddress(emailConfig.incomingServer)) {
      errors.push('Incoming server format is invalid');
    }

    if (!emailConfig.outgoingServer || !emailConfig.outgoingServer.trim()) {
      errors.push('Outgoing server is missing');
    } else if (!this.isValidServerAddress(emailConfig.outgoingServer)) {
      errors.push('Outgoing server format is invalid');
    }

    // Validate ports
    if (!emailConfig.incomingPort || !emailConfig.incomingPort.trim()) {
      errors.push('Incoming port is missing');
    } else if (!this.isValidPort(emailConfig.incomingPort)) {
      errors.push('Incoming port is invalid');
    }

    if (!emailConfig.outgoingPort || !emailConfig.outgoingPort.trim()) {
      errors.push('Outgoing port is missing');
    } else if (!this.isValidPort(emailConfig.outgoingPort)) {
      errors.push('Outgoing port is invalid');
    }

    const isValid = errors.length === 0;
    const reason = isValid 
      ? 'Email configuration is valid' 
      : errors.join(', ');

    return { isValid, reason, errors };
  }

  /**
   * Extract email configuration from settings data
   * Looks for settings.channels.email structure
   */
  static extractEmailConfigFromSettings(settings: any): EmailConfig | null {
    try {
      // Check if settings has channels.email structure
      if (!settings?.channels?.email) {
        return null;
      }

      const emailChannel = settings.channels.email;

      // Check if email is enabled
      if (!emailChannel.enabled) {
        return null;
      }

      // Validate required email configuration fields
      if (!emailChannel.email) {
        return null;
      }

      const emailConfig: EmailConfig = {
        email: emailChannel.email,
        enabled: emailChannel.enabled,
        password: emailChannel.password || '',
        incomingServer: emailChannel.incomingServer || '',
        outgoingServer: emailChannel.outgoingServer || '',
        incomingPort: emailChannel.incomingPort || '993',
        outgoingPort: emailChannel.outgoingPort || '587',
      };

      console.log(`📧 Extracted email config for ${emailConfig.email}:`, {
        email: emailConfig.email,
        enabled: emailConfig.enabled,
        incomingServer: emailConfig.incomingServer,
        incomingPort: emailConfig.incomingPort,
        outgoingServer: emailConfig.outgoingServer,
        outgoingPort: emailConfig.outgoingPort,
        hasPassword: !!emailConfig.password
      });

      return emailConfig;
    } catch (error) {
      console.warn('⚠️  Error extracting email config from settings:', error);
      return null;
    }
  }

  /**
   * Get email provider type based on server configuration
   */
  static getEmailProvider(emailConfig: EmailConfig): string {
    const incomingServer = emailConfig.incomingServer.toLowerCase();
    const outgoingServer = emailConfig.outgoingServer.toLowerCase();

    if (incomingServer.includes('gmail') || outgoingServer.includes('gmail')) {
      return 'gmail';
    } else if (incomingServer.includes('outlook') || outgoingServer.includes('outlook')) {
      return 'outlook';
    } else if (incomingServer.includes('yahoo') || outgoingServer.includes('yahoo')) {
      return 'yahoo';
    } else {
      return 'imap';
    }
  }

  /**
   * Get default configuration for common email providers
   */
  static getDefaultConfigForProvider(provider: string): Partial<EmailConfig> {
    const configs = {
      gmail: {
        incomingServer: 'imap.gmail.com',
        outgoingServer: 'smtp.gmail.com',
        incomingPort: '993',
        outgoingPort: '587'
      },
      outlook: {
        incomingServer: 'imap.outlook.com',
        outgoingServer: 'smtp.outlook.com',
        incomingPort: '993',
        outgoingPort: '587'
      },
      yahoo: {
        incomingServer: 'imap.mail.yahoo.com',
        outgoingServer: 'smtp.mail.yahoo.com',
        incomingPort: '993',
        outgoingPort: '587'
      }
    };

    return configs[provider as keyof typeof configs] || {};
  }

  /**
   * Validate email address format
   */
  private static isValidEmailAddress(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate server address format
   */
  private static isValidServerAddress(server: string): boolean {
    // Basic validation for server address (domain or IP)
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    
    return domainRegex.test(server) || ipRegex.test(server);
  }

  /**
   * Validate port number
   */
  private static isValidPort(port: string): boolean {
    const portNumber = parseInt(port, 10);
    return !isNaN(portNumber) && portNumber > 0 && portNumber <= 65535;
  }

  /**
   * Mask sensitive information in email config for logging
   */
  static maskSensitiveInfo(emailConfig: EmailConfig): Partial<EmailConfig> {
    return {
      email: emailConfig.email,
      enabled: emailConfig.enabled,
      password: emailConfig.password ? '***masked***' : '',
      incomingPort: emailConfig.incomingPort,
      outgoingPort: emailConfig.outgoingPort,
      incomingServer: emailConfig.incomingServer,
      outgoingServer: emailConfig.outgoingServer
    };
  }
} 