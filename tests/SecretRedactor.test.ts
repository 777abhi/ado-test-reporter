import { SecretRedactor } from "../src/utils/SecretRedactor";

describe("SecretRedactor", () => {
  const testCases = [
    {
      name: "GitHub Token",
      input: "My token is ghp_123456789012345678901234567890123456.",
      expected: "My token is ***REDACTED***.",
    },
    {
      name: "Bearer Token",
      input: "Authorization: Bearer abcdef123456",
      expected: "Authorization: ***REDACTED***",
    },
    {
      name: "Generic Password with =",
      input: 'password = "supersecret"',
      expected: 'password="***REDACTED***"',
    },
    {
      name: "Generic Secret with :",
      input: "client_secret: mysecretvalue",
      expected: "client_secret:***REDACTED***",
    },
    {
      name: "Generic API Key",
      input: "api_key='12345'",
      expected: "api_key='***REDACTED***'",
    },
    {
      name: "No Secrets",
      input: "This is a safe string.",
      expected: "This is a safe string.",
    },
    {
      name: "False Positive Check (token)",
      input: "Unexpected token found.",
      expected: "Unexpected token found.",
    },
    {
      name: "False Positive Check (key)",
      input: "The key feature is missing.",
      expected: "The key feature is missing.",
    },
    {
      name: "AWS Key",
      input: "Key: AKIAABCDEFGHIJKLMNOP",
      expected: "Key: ***REDACTED***",
    },
  ];

  testCases.forEach((tc) => {
    it(`should correctly handle ${tc.name}`, () => {
      expect(SecretRedactor.redact(tc.input)).toBe(tc.expected);
    });
  });
});
