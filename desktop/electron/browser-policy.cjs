'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const DEFAULT_BROWSER_POLICY = Object.freeze({
  interactionEnabled: false,
  allowedDomains: [],
  redactSensitiveData: true,
  allowSensitiveActions: false,
});

function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  let domain = value.trim().toLowerCase();
  if (!domain) return null;
  try {
    if (domain.includes('://')) domain = new URL(domain).hostname;
    else domain = new URL(`https://${domain}`).hostname;
  } catch {
    return null;
  }
  if (!domain || domain.includes('..') || domain.length > 253) return null;
  return domain.replace(/^\.+|\.+$/g, '');
}

function normalizeBrowserPolicy(value) {
  const domains = Array.isArray(value?.allowedDomains)
    ? value.allowedDomains.map(normalizeDomain).filter(Boolean).slice(0, 100)
    : [];
  return {
    interactionEnabled: value?.interactionEnabled === true,
    allowedDomains: [...new Set(domains)],
    redactSensitiveData: value?.redactSensitiveData !== false,
    allowSensitiveActions: value?.allowSensitiveActions === true,
  };
}

function browserPolicyPath(userData) {
  return path.join(userData, 'browser-policy.json');
}

function loadBrowserPolicy(filePath, logger = console) {
  if (!filePath || !existsSync(filePath)) return normalizeBrowserPolicy(DEFAULT_BROWSER_POLICY);
  try {
    return normalizeBrowserPolicy(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    logger.error('[desktop] unable to read browser policy', error);
    return normalizeBrowserPolicy(DEFAULT_BROWSER_POLICY);
  }
}

function saveBrowserPolicy(filePath, value, logger = console) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const policy = normalizeBrowserPolicy(value);
    writeFileSync(filePath, JSON.stringify(policy, null, 2), { encoding: 'utf8', mode: 0o600 });
    return policy;
  } catch (error) {
    logger.error('[desktop] unable to persist browser policy', error);
    return null;
  }
}

function domainAllowed(urlValue, allowedDomains) {
  if (typeof urlValue !== 'string' || !urlValue.trim()) return false;
  let hostname;
  try {
    hostname = new URL(urlValue).hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  } catch {
    return false;
  }
  return normalizeBrowserPolicy({ allowedDomains }).allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

module.exports = {
  DEFAULT_BROWSER_POLICY,
  browserPolicyPath,
  domainAllowed,
  loadBrowserPolicy,
  normalizeBrowserPolicy,
  saveBrowserPolicy,
};
