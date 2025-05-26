import { logLevel } from '../config/config';

interface LogMessage {
  message: string;
  [key: string]: unknown;
}

class Logger {
  private level: string;

  constructor(level: string) {
    this.level = level;
  }

  private formatMessage(message: string, data?: Record<string, unknown>): LogMessage {
    return {
      message,
      ...data,
    };
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.level === 'debug' || this.level === 'info') {
      console.log(JSON.stringify(this.formatMessage(message, data)));
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify(this.formatMessage(message, data)));
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.level === 'debug') {
      console.debug(JSON.stringify(this.formatMessage(message, data)));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.level === 'debug' || this.level === 'info' || this.level === 'warn') {
      console.warn(JSON.stringify(this.formatMessage(message, data)));
    }
  }
}

export const logger = new Logger(logLevel); 