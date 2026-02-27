/**
 * Utility to redact sensitive information (secrets) from text.
 * This helps prevent accidental leakage of tokens, keys, and passwords in logs or error messages.
 */
export class SecretRedactor {
    private static readonly TOKEN_PATTERNS: RegExp[] = [
        // Bearer tokens (common in HTTP headers)
        /Bearer\s+[a-zA-Z0-9\-\._~+/]+=*/gi,

        // GitHub Personal Access Tokens (classic and fine-grained)
        /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/g,

        // GitLab Personal Access Tokens
        /glpat-[a-zA-Z0-9\-]{20}/g,

        // AWS Access Key ID
        /AKIA[0-9A-Z]{16}/g,

        // Slack Tokens
        /xox[baprs]-([0-9a-zA-Z]{10,48})/g,

        // Private Keys (RSA, PEM headers)
        /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
    ];

    // Generic Key/Value assignment for "password", "secret", "token", "key"
    // Matches: password = "value", secret: "value with spaces", etc.
    // Group 1: Key (e.g. password, secret) - optionally quoted
    // Group 2: Double quoted value (without quotes)
    // Group 3: Single quoted value (without quotes)
    // Group 4: Unquoted value (stops at whitespace/comma/semicolon)
    // Updated: Key can be quoted (e.g. "access_token": "value") and 'token' added back.
    private static readonly GENERIC_PATTERN = /(?:["']?)\b(password|pwd|secret|access_token|api_token|auth_token|access_key|api_key|client_secret|token)(?:["']?)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^"'\s,;]+))/gi;

    /**
     * Redacts known secret patterns from the input text.
     * @param text The text to sanitize.
     * @returns The sanitized text with secrets replaced by ***REDACTED***.
     */
    public static redact(text: string | undefined | null): string {
        if (!text) return "";
        let redacted = text;

        // 1. Redact specific token formats
        for (const pattern of this.TOKEN_PATTERNS) {
            redacted = redacted.replace(pattern, '***REDACTED***');
        }

        // 2. Redact generic key-value pairs (preserving the key)
        redacted = redacted.replace(this.GENERIC_PATTERN, (match, key, g2, g3, g4) => {
            // key is captured group 1

            // Reconstruct partially to preserve JSON/format style if possible,
            // but primarily ensure redaction.

            // Check if key was quoted in match
            // The match string includes the quote if it was matched by `(?:["']?)`.
            // But `key` group is just the word.

            // Simple approach:
            // If the match starts with " or ', assume key needs quotes.
            const firstChar = match.trim().charAt(0);
            const isKeyQuoted = firstChar === '"' || firstChar === "'";

            // The separator is usually preserved in structure but we might change spacing.
            // Let's try to just build a safe replacement string.

            const separator = match.includes(':') ? ':' : '=';

            // Determine if value was quoted
            const isValueDoubleQuoted = g2 !== undefined;
            const isValueSingleQuoted = g3 !== undefined;

            let newValue = "***REDACTED***";
            if (isValueDoubleQuoted) newValue = '"***REDACTED***"';
            else if (isValueSingleQuoted) newValue = "'***REDACTED***'";

            let newKey = key;
            if (isKeyQuoted) {
                 // Use the same quote style as start
                 newKey = `${firstChar}${key}${firstChar}`;
            }

            // If it was JSON like "key": "val", we want "key": "***REDACTED***"
            // If it was key="val", we want key="***REDACTED***"

            // Note: Our regex allows spaces around separator.
            // We lose that spacing information unless we capture it or guess.
            // For logs, canonicalizing to `key: value` or `key=value` is fine.

            // Special case for JSON: JSON requires double quotes and usually colon.
            if (isKeyQuoted && separator === ':') {
                 return `${newKey}: ${newValue}`;
            }

            // Default fallback
            // Ensure we handle the "Single quotes with spaces" case: client_secret: '...'
            // If separator is :, we return key: '***REDACTED***'
            return `${newKey}${separator}${newValue}`;
        });

        return redacted;
    }
}
