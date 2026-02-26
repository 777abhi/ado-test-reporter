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
    // Matches: password = "value", secret: value, etc.
    // Be careful not to match too broadly (e.g. "key feature").
    // We look for key followed by optional whitespace, then = or :, then optional whitespace, then non-whitespace/comma/semicolon value.
    // Updated to be more specific to avoid false positives on "token" or "key".
    private static readonly GENERIC_PATTERN = /\b(password|pwd|secret|access_token|api_token|auth_token|access_key|api_key|client_secret)\s*[:=]\s*(?:["']?)([^"'\s,;]+)(?:["']?)/gi;

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
        redacted = redacted.replace(this.GENERIC_PATTERN, (match, key, value) => {
            // key is captured group 1
            // value is captured group 2
            return `${key}=***REDACTED***`;
        });

        return redacted;
    }
}
