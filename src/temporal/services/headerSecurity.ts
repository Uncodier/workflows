const SENSITIVE_HEADER_NAME =
  /(^|[-_])(?:auth(?:entication|orization)?|credentials?|password|passwd|passphrase|signatures?|api[-_]?keys?|access[-_]?keys?|private[-_]?keys?|tokens?|secrets?|cookies?)([-_]|$)/i;
const WORKER_SECRET_PLACEHOLDER =
  '{{(?:SUPPORT_API_TOKEN|SERVICE_API_KEY|WEATHER_API_KEY)}}';
const STANDALONE_SECRET_PLACEHOLDER = new RegExp(`^${WORKER_SECRET_PLACEHOLDER}$`);
const AUTH_SECRET_PLACEHOLDER = new RegExp(
  `^(?:Bearer|Basic)\\s+${WORKER_SECRET_PLACEHOLDER}$`,
  'i'
);

export function isSensitiveHttpHeader(name: string): boolean {
  return SENSITIVE_HEADER_NAME.test(name);
}

export function redactSensitiveHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveHttpHeader(name) ? '[REDACTED]' : value,
    ])
  );
}

function isSafeSecretPlaceholder(headerName: string, value: string): boolean {
  if (/^(authorization|proxy-authorization)$/i.test(headerName)) {
    return (
      STANDALONE_SECRET_PLACEHOLDER.test(value) ||
      AUTH_SECRET_PLACEHOLDER.test(value)
    );
  }
  return STANDALONE_SECRET_PLACEHOLDER.test(value);
}

export function assertTemporalSafeHeaders(
  headers: Record<string, string>
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHttpHeader(name) && !isSafeSecretPlaceholder(name, value)) {
      throw new Error(
        `Sensitive header "${name}" must use an approved worker secret placeholder`
      );
    }
  }
}
