
/**
 * Sanitizes a value to prevent CSV/Formula Injection.
 * If the value starts with =, +, or @, it prepends a single quote.
 *
 * It also handles the hyphen (-) prefix to prevent formula injection,
 * but allows it if followed by a space (e.g., "- Item") to preserve bullet points.
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

  if (firstChar === '-') {
    // Check if the next character is a space (likely a bullet point)
    // If NOT a space (or end of string), sanitize it to prevent formula injection (e.g. -1+1, -cmd...)
    const secondChar = value.charAt(1);
    if (secondChar !== ' ') {
      return `'${value}`;
    }
  }

  return value;
}
