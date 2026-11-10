import { SecretRedactor } from "../src/utils/SecretRedactor";

describe("SecretRedactor Complex Tests", () => {
  const testCases = [
    {
      name: "Double quotes with spaces",
      input: 'password = "super secret value"',
      expected: 'password="***REDACTED***"',
    },
    {
      name: "Single quotes with spaces",
      input: "client_secret: 'my secret key'",
      expected: "client_secret:'***REDACTED***'",
    },
    {
      name: "Unquoted simple value",
      input: "api_key=12345",
      expected: "api_key=***REDACTED***",
    },
    {
      name: "JSON style",
      input: '"access_token": "abc 123 xyz"',
      expected: '"access_token": "***REDACTED***"',
    },
    {
      name: "Multiple pairs",
      input: 'id=123 password="secure" token=\'secret\'',
      expected: 'id=123 password="***REDACTED***" token=\'***REDACTED***\'',
    },
    {
      name: "Sentence looking like key value",
      input: "The secret is not here.",
      expected: "The secret is not here.",
    },
  ];

  testCases.forEach((tc) => {
    it(`should correctly handle ${tc.name}`, () => {
      expect(SecretRedactor.redact(tc.input)).toBe(tc.expected);
    });
  });
});
