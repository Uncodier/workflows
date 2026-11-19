import { ApplicationFailure } from '@temporalio/activity';

/** Constraint/permission/explicit SQL denials are not transport ambiguity.
 * Deadlocks, lock timeouts and connection failures can retry the same receipt. */
export function icpReceiptFailure(operation: string, error: { code?: string; message?: string }): Error {
  const code = error.code || '';
  const message = `${operation}: ${error.message || 'unknown database error'}`;
  if (code === 'P0001' || code === '42501' || /^(22|23|28)/.test(code) || /^PGRST30[0-3]$/.test(code)) {
    return ApplicationFailure.nonRetryable(message, 'ICP_RECEIPT_DENIED');
  }
  return new Error(message);
}

export function invalidIcpReceipt(message: string) {
  return ApplicationFailure.nonRetryable(message, 'ICP_RECEIPT_INVALID');
}