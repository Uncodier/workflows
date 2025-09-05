"use strict";
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
exports.isValidEmailFormat = isValidEmailFormat;
exports.extractDomain = extractDomain;
exports.isDisposableEmail = isDisposableEmail;
exports.isLikelyNonEmailDomain = isLikelyNonEmailDomain;
exports.withDNSTimeout = withDNSTimeout;
exports.createSocketWithTimeout = createSocketWithTimeout;
exports.readSMTPResponse = readSMTPResponse;
exports.sendSMTPCommand = sendSMTPCommand;
const net = __importStar(require("net"));
/**
 * Validates email format using regex
 */
function isValidEmailFormat(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
/**
 * Extracts domain from email address
 */
function extractDomain(email) {
    return email.split('@')[1];
}
/**
 * Checks if domain is a known disposable email provider
 */
function isDisposableEmail(domain) {
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
function isLikelyNonEmailDomain(domain) {
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
function withDNSTimeout(operation, timeout = 5000) {
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
function createSocketWithTimeout(host, port, timeout = 8000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let isResolved = false;
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                socket.destroy();
                resolve({
                    success: false,
                    error: `Connection timeout to ${host}:${port} after ${timeout}ms`,
                    errorCode: 'TIMEOUT'
                });
            }
        }, timeout);
        socket.connect(port, host, () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                resolve({
                    success: true,
                    socket
                });
            }
        });
        socket.on('error', (error) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeoutId);
                resolve({
                    success: false,
                    error: error.message || 'Connection error',
                    errorCode: error.code || 'CONNECTION_ERROR'
                });
            }
        });
    });
}
/**
 * Reads SMTP response from socket with controlled timeout (no exceptions)
 */
function readSMTPResponse(socket) {
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
                }
                catch {
                    resolve({
                        success: false,
                        error: 'Failed to parse SMTP response',
                        errorCode: 'PARSE_ERROR'
                    });
                }
            }
        });
        socket.once('error', (error) => {
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
async function sendSMTPCommand(socket, command) {
    try {
        socket.write(command + '\r\n');
        return await readSMTPResponse(socket);
    }
    catch (error) {
        return {
            success: false,
            error: error.message || 'Failed to send SMTP command',
            errorCode: 'SEND_ERROR'
        };
    }
}
