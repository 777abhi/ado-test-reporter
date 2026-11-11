import { SecretRedactor } from "../src/utils/SecretRedactor";

describe("SecretRedactor Dynamic Registration", () => {
    beforeEach(() => {
        SecretRedactor.clearDynamicSecrets();
    });

    afterEach(() => {
        SecretRedactor.clearDynamicSecrets();
    });

    it("should dynamically register and redact a custom secret", () => {
        const customToken = "super-secret-variable-xyz123";
        SecretRedactor.registerSecret(customToken);

        const input = `Configuring client with credential ${customToken} and proceeding.`;
        const result = SecretRedactor.redact(input);

        expect(result).toBe("Configuring client with credential ***REDACTED*** and proceeding.");
    });

    it("should ignore registration of secrets shorter than 4 characters", () => {
        SecretRedactor.registerSecret("abc");
        const input = "The alphabet has abc in it.";
        expect(SecretRedactor.redact(input)).toBe("The alphabet has abc in it.");
    });

    it("should sort registered secrets by length so substrings don't break longer secrets", () => {
        SecretRedactor.registerSecret("custom_key");
        SecretRedactor.registerSecret("custom_key_extended_secret");

        const input = "Credential payload: custom_key_extended_secret";
        const result = SecretRedactor.redact(input);

        expect(result).toBe("Credential payload: ***REDACTED***");
    });

    it("should escape regex special characters in dynamic secrets", () => {
        const specialSecret = "p@$$w0rd(special)[regex].*+";
        SecretRedactor.registerSecret(specialSecret);

        const input = `User password is ${specialSecret}.`;
        const result = SecretRedactor.redact(input);

        expect(result).toBe("User password is ***REDACTED***.");
    });

    it("should clear registered dynamic secrets when clearDynamicSecrets is called", () => {
        SecretRedactor.registerSecret("temp_secret_123");
        expect(SecretRedactor.redact("temp_secret_123")).toBe("***REDACTED***");

        SecretRedactor.clearDynamicSecrets();
        expect(SecretRedactor.redact("temp_secret_123")).toBe("temp_secret_123");
    });
});
