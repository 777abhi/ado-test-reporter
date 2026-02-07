
/**
 * Sanitizes a value to prevent CSV/Formula Injection.
 * If the value starts with =, +, or @, it prepends a single quote.
 *
 * @param value The value to sanitize.
 * @returns The sanitized value.
 */
export function sanitizeForCsv(value: string): string {
  if (!value) return value;
  if (typeof value !== 'string') return value;

  const unsafePrefixes = ['=', '+', '@'];
  const firstChar = value.charAt(0);

  if (unsafePrefixes.includes(firstChar)) {
    return `'${value}`;
  }

  return value;
}
