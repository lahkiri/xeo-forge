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

/* ── P0 fix: policy unification across layers ────────────────── */

describe('browser policy is unified across layers (P0)', () => {
  const fs = require('node:fs');
  const path = require('node:path');

  it('the bridge enforces the SAME sensitive set as the agent layer', () => {
    const agentSrc = fs.readFileSync(path.resolve(__dirname, '../lib/agent/browser.ts'), 'utf8');
    const bridgeSrc = fs.readFileSync(path.resolve(__dirname, '../desktop/electron/browser-bridge.cjs'), 'utf8');
    const agentSet = agentSrc.match(/SENSITIVE_ACTIONS = new Set<BrowserAction>\(\[([^\]]+)\]/)?.[1];
    const bridgeSet = bridgeSrc.match(/SENSITIVE_ACTIONS = new Set\(\[([^\]]+)\]/)?.[1];
    expect(agentSet, 'agent layer set found').toBeDefined();
    expect(bridgeSet, 'bridge set found').toBeDefined();
    // Same members, order-insensitive.
    const norm = (s: string) => s.split(',').map((x) => x.trim().replace(/['"]/g, '')).sort().join(',');
    expect(norm(bridgeSet!), 'bridge must mirror agent layer exactly').toBe(norm(agentSet!));
  });

  it('navigate requires confirmation through BOTH layers', () => {
    const bridgeSrc = fs.readFileSync(path.resolve(__dirname, '../desktop/electron/browser-bridge.cjs'), 'utf8');
    expect(bridgeSrc).toMatch(/SENSITIVE_ACTIONS\.has\(action\)/);
    // The old bug: bridge set lacked navigate while agent layer had it.
    expect(bridgeSrc).toContain("'navigate', 'click', 'type'");
  });
});
