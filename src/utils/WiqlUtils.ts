
/**
 * Escapes a string for use in a WIQL (Work Item Query Language) literal.
 * Replaces single quotes with two single quotes.
 *
 * @param value The string to escape
 * @returns The escaped string
 */
export function escapeWiqlString(value: string): string {
  return value.replace(/'/g, "''");
}
