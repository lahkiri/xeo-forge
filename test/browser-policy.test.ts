import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { domainAllowed, normalizeBrowserPolicy } = require('../desktop/electron/browser-policy.cjs') as {
  domainAllowed: (url: string, domains: string[]) => boolean;
  normalizeBrowserPolicy: (value: unknown) => {
    interactionEnabled: boolean;
    allowedDomains: string[];
    redactSensitiveData: boolean;
    allowSensitiveActions: boolean;
  };
};

describe('browser safety policy', () => {
  it('defaults to read-only with redaction enabled', () => {
    expect(normalizeBrowserPolicy({})).toEqual({
      interactionEnabled: false,
      allowedDomains: [],
      redactSensitiveData: true,
      allowSensitiveActions: false,
    });
  });

  it('normalizes domains and includes subdomains without accepting malformed values', () => {
    const policy = normalizeBrowserPolicy({
      interactionEnabled: true,
      allowedDomains: ['HTTPS://Example.com/path', ' sub.example.com ', 'not a domain', ''],
      redactSensitiveData: false,
      allowSensitiveActions: true,
    });
    expect(policy.allowedDomains).toEqual(['example.com', 'sub.example.com']);
    expect(domainAllowed('https://app.example.com/dashboard', policy.allowedDomains)).toBe(true);
    expect(domainAllowed('https://example.com', policy.allowedDomains)).toBe(true);
    expect(domainAllowed('https://example.com.evil.test', policy.allowedDomains)).toBe(false);
  });
});
