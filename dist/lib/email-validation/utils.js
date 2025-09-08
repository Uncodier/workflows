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
const dns_1 = require("dns");
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
        let resolved = false;
        let globalTimer = null;
        let lastError = null;
        const finish = (result) => {
            if (resolved)
                return;
            resolved = true;
            if (globalTimer)
                clearTimeout(globalTimer);
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
        (0, dns_1.lookup)(host, { all: true, verbatim: false }, (err, addresses) => {
            if (resolved)
                return;
            if (err || !addresses || addresses.length === 0) {
                finish({
                    success: false,
                    error: err?.message || `DNS lookup failed for ${host}`,
                    errorCode: err?.code || 'DNS_LOOKUP_FAILED'
                });
                return;
            }
            // Prefer IPv4 first to avoid common IPv6 EHOSTUNREACH in some environments
            addresses.sort((a, b) => (a.family === 4 ? -1 : 1) - (b.family === 4 ? -1 : 1));
            // Try addresses in preferred order
            const perAttemptTimeout = Math.max(3000, Math.min(7000, timeout));
            const tryNext = (index) => {
                if (resolved)
                    return;
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
                    if (attemptDone)
                        return;
                    attemptDone = true;
                    try {
                        socket.destroy();
                    }
                    catch { }
                    lastError = { message: `Connection timeout to ${addr}:${port} after ${perAttemptTimeout}ms`, code: 'TIMEOUT' };
                    tryNext(index + 1);
                }, perAttemptTimeout);
                socket.once('connect', () => {
                    if (attemptDone)
                        return;
                    attemptDone = true;
                    clearTimeout(attemptTimer);
                    // Success on this address
                    finish({ success: true, socket });
                });
                socket.once('error', (error) => {
                    if (attemptDone)
                        return;
                    attemptDone = true;
                    clearTimeout(attemptTimer);
                    lastError = { message: error?.message || 'Connection error', code: error?.code || 'CONNECTION_ERROR' };
                    try {
                        socket.destroy();
                    }
                    catch { }
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
