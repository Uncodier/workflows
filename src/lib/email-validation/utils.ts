import * as net from 'net';
import { lookup as dnsLookup } from 'dns';

export interface MXRecord {
  exchange: string;
  priority: number;
}

export interface SMTPResponse {
  code: number;
  message: string;
}

export interface EmailValidationResult {
  email: string;
  isValid: boolean; // Technical validity (SMTP accepts)
  deliverable: boolean; // Practical deliverability (considering bounce risk)
  result: 'valid' | 'invalid' | 'unknown' | 'disposable' | 'catchall' | 'risky';
  flags: string[];
  suggested_correction: string | null;
  execution_time: number;
  message: string;
  timestamp: string;
}

/**
 * Validates email format using regex
 */
export function isValidEmailFormat(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Extracts domain from email address
 */
export function extractDomain(email: string): string {
  return email.split('@')[1];
}

/**
 * Checks if domain is a known disposable email provider
 */
export function isDisposableEmail(domain: string): boolean {
  const disposableDomains = [
    '10minutemail.com', 'tempmail.org', 'guerrillamail.com', 'mailinator.com',
    'yopmail.com', 'temp-mail.org', 'throwaway.email', 'maildrop.cc',
    'sharklasers.com', 'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de',
    'grr.la', 'guerrillamail.net', 'guerrillamail.org', 'spam4.me',
    'tempail.com', 'tempemail.com', 'tempinbox.com', 'emailondeck.com'
  ];
  
  return disposableDomains.includes(domain.toLowerCase());
}

/**
 * Quick check to determine if a domain is likely a non-email domain
 */
export function isLikelyNonEmailDomain(domain: string): {
  isNonEmail: boolean;
  reason: string;
  confidence: number;
} {
  const lowerDomain = domain.toLowerCase();
  
  // Check for common non-email domain patterns
  const nonEmailPatterns = [
    { pattern: /^\d+\.\w+$/, reason: 'Numeric domain (likely parking/placeholder)', confidence: 85 },
    { pattern: /^[a-z0-9]+\.(tk|ml|ga|cf)$/, reason: 'Free domain service (rarely used for email)', confidence: 80 },
    { pattern: /^www\./, reason: 'WWW subdomain (not typically used for email)', confidence: 70 },
    { pattern: /\.(example|test|localhost|invalid)$/, reason: 'Reserved/test domain', confidence: 95 },
    { pattern: /^[0-9]{4,}\.(com|net|org)$/, reason: 'Numeric domain pattern (likely placeholder)', confidence: 80 }
  ];
  
  for (const { pattern, reason, confidence } of nonEmailPatterns) {
    if (pattern.test(lowerDomain)) {
      return { isNonEmail: true, reason, confidence };
    }
  }
  
  // Check for very short domains (often placeholders)
  if (lowerDomain.length <= 6 && /^[0-9]+\.(com|net|org)$/.test(lowerDomain)) {
    return { 
      isNonEmail: true, 
      reason: 'Very short numeric domain (likely placeholder)', 
      confidence: 75 
    };
  }
  
  return { isNonEmail: false, reason: '', confidence: 0 };
}

/**
 * Creates a timeout wrapper for DNS operations
 */
export function withDNSTimeout<T>(operation: Promise<T>, timeout: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`DNS operation timeout after ${timeout}ms`));
    }, timeout);

    operation
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Creates a socket connection with controlled timeout (no exceptions)
 */
export function createSocketWithTimeout(host: string, port: number, timeout: number = 8000): Promise<{
  success: boolean;
  socket?: net.Socket;
  error?: string;
  errorCode?: string;
}> {
  return new Promise((resolve) => {
    let resolved = false;
    let globalTimer: NodeJS.Timeout | null = null;
    let lastError: { message: string; code: string } | null = null;

    const finish = (result: { success: boolean; socket?: net.Socket; error?: string; errorCode?: string }) => {
      if (resolved) return;
      resolved = true;
      if (globalTimer) clearTimeout(globalTimer);
      resolve(result);
    };

    // Respect overall timeout
    globalTimer = setTimeout(() => {
      finish({
        success: false,
        error: `Connection timeout to ${host}:${port} after ${timeout}ms`,
        errorCode: 'TIMEOUT'
      });
    }, timeout);

    // Resolve all addresses (IPv4/IPv6) and try sequentially (Happy Eyeballs-lite)
    dnsLookup(host, { all: true, verbatim: false }, (err, addresses) => {
      if (resolved) return;
      if (err || !addresses || addresses.length === 0) {
        finish({
          success: false,
          error: err?.message || `DNS lookup failed for ${host}`,
          errorCode: (err as any)?.code || 'DNS_LOOKUP_FAILED'
        });
        return;
      }

      // Prefer IPv4 first to avoid common IPv6 EHOSTUNREACH in some environments
      addresses.sort((a, b) => (a.family === 4 ? -1 : 1) - (b.family === 4 ? -1 : 1));

      // Try addresses in preferred order
      const perAttemptTimeout = Math.max(3000, Math.min(7000, timeout));

      const tryNext = (index: number) => {
        if (resolved) return;
        if (index >= addresses.length) {
          finish({
            success: false,
            error: lastError?.message || `All address attempts failed for ${host}`,
            errorCode: lastError?.code || 'CONNECTION_ERROR'
          });
          return;
        }

        const addr = addresses[index].address;
        const socket = new net.Socket();
        let attemptDone = false;

        const attemptTimer = setTimeout(() => {
          if (attemptDone) return;
          attemptDone = true;
          try { socket.destroy(); } catch {}
          lastError = { message: `Connection timeout to ${addr}:${port} after ${perAttemptTimeout}ms`, code: 'TIMEOUT' };
          tryNext(index + 1);
        }, perAttemptTimeout);

        socket.once('connect', () => {
          if (attemptDone) return;
          attemptDone = true;
          clearTimeout(attemptTimer);
          // Success on this address
          finish({ success: true, socket });
        });

        socket.once('error', (error: any) => {
          if (attemptDone) return;
          attemptDone = true;
          clearTimeout(attemptTimer);
          lastError = { message: error?.message || 'Connection error', code: error?.code || 'CONNECTION_ERROR' };
          try { socket.destroy(); } catch {}
          tryNext(index + 1);
        });

        socket.connect(port, addr);
      };

      tryNext(0);
    });
  });
}

/**
 * Reads SMTP response from socket with controlled timeout (no exceptions)
 */
export function readSMTPResponse(socket: net.Socket): Promise<{
  success: boolean;
  response?: SMTPResponse;
  error?: string;
  errorCode?: string;
}> {
  return new Promise((resolve) => {
    let isResolved = false;
    
    // Use more generous timeout for SMTP responses
    // Many legitimate servers need more time, especially under load
    const timeoutMs = 5000; // Increased from 2000ms to 5000ms
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({
          success: false,
          error: `SMTP response timeout after ${timeoutMs}ms`,
          errorCode: 'RESPONSE_TIMEOUT'
        });
      }
    }, timeoutMs);
    
    socket.once('data', (data) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        try {
          const response = data.toString().trim();
          const code = parseInt(response.substring(0, 3));
          const message = response.substring(4);
          resolve({
            success: true,
            response: { code, message }
          });
        } catch {
          resolve({
            success: false,
            error: 'Failed to parse SMTP response',
            errorCode: 'PARSE_ERROR'
          });
        }
      }
    });
    
    socket.once('error', (error: any) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        resolve({
          success: false,
          error: error.message || 'Socket error',
          errorCode: error.code || 'SOCKET_ERROR'
        });
      }
    });
  });
}

/**
 * Sends SMTP command and waits for response (controlled, no exceptions)
 */
export async function sendSMTPCommand(socket: net.Socket, command: string): Promise<{
  success: boolean;
  response?: SMTPResponse;
  error?: string;
  errorCode?: string;
}> {
  try {
    socket.write(command + '\r\n');
    return await readSMTPResponse(socket);
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to send SMTP command',
      errorCode: 'SEND_ERROR'
    };
  }
}
