// Main validation functions
export { performSMTPValidation, detectCatchallDomain } from './smtp.js';
export { checkDomainExists, getMXRecords, attemptFallbackValidation, performBasicEmailValidation } from './dns.js';
export { checkDomainReputation } from './reputation.js';

// Utility functions
export {
  isValidEmailFormat,
  extractDomain,
  isDisposableEmail,
  isLikelyNonEmailDomain,
  withDNSTimeout,
  createSocketWithTimeout,
  readSMTPResponse,
  sendSMTPCommand,
  inferDeliverableFromSignals
} from './utils.js';

// Types
export type {
  MXRecord,
  SMTPResponse,
  EmailValidationResult
} from './utils.js';
