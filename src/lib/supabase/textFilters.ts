/** Serialize literal text values for PostgREST's IN grammar, not URL encoding.
 * The installed postgrest-js IN builder quotes reserved characters but does
 * not escape embedded quotes/backslashes in our JSON-based scoped identities.
 * Pass this to .filter(column, 'in', ...) so the SDK does not quote it again.
 */
export function postgrestTextIn(values: readonly string[]): string {
  return `(${[...new Set(values)].map(value => JSON.stringify(value)).join(',')})`;
}