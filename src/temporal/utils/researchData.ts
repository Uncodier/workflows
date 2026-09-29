/** Database identities and lifecycle state are never model-editable profile data. */
export function isProtectedResearchField(key: string): boolean {
  return key === 'id' || /_ids?$/.test(key) || key.startsWith('_')
    || ['created_at', 'updated_at', 'deleted_at', 'status', 'origin', 'last_contact',
      'subscription', 'attribution', '__proto__', 'prototype', 'constructor'].includes(key);
}

export function withoutResearchIdentity(value: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isProtectedResearchField(key)));
}