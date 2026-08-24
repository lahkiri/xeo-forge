import { describe, it, expect } from 'vitest';
import { assertSafeUrl } from '../lib/agent/tools';

/* ------------------------------------------------------------------ */
/*  SSRF pre-flight checks on http_request.                            */
/*                                                                     */
/*  This file is the regression lock that was missing when the bug      */
/*  shipped: assertSafeUrl mapped over the raw String.match result,     */
/*  whose index 0 is the whole match, so ipv4Parts was                  */
/*  [NaN, 127, 0, 0, 1] and EVERY private-range check below it was      */
/*  dead code. The function looked thorough and blocked nothing         */
/*  numeric.                                                            */
/*                                                                     */
/*  Blocking is asserted by address FORM as well as by range, because   */
/*  the OS resolver accepts inet_aton spellings (octal, hex, packed     */
/*  decimal, short forms) that a naive dotted-quad regex never sees.    */
/* ------------------------------------------------------------------ */

const BLOCKED: [string, string][] = [
  // Loopback, in every spelling inet_aton accepts.
  ['http://127.0.0.1/', 'dotted loopback'],
  ['http://127.0.0.1:8080/x', 'loopback with port and path'],
  ['http://0177.0.0.1/', 'octal first octet'],
  ['http://0177.0000.0000.0001/', 'fully octal'],
  ['http://0x7f.0x0.0x0.0x1/', 'hex octets'],
  ['http://0x7f000001/', 'single hex word'],
  ['http://2130706433/', 'packed decimal'],
  ['http://127.1/', 'short form — last part absorbs the low bytes'],
  ['http://127.0.1/', 'three-part short form'],
  ['https://127.255.255.254/', 'rest of 127/8'],

  // IPv6 loopback and the IPv4-mapped form.
  ['http://[::1]/', 'IPv6 loopback'],
  ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
  ['http://[::]/', 'IPv6 unspecified'],
  ['http://[fe80::1]/', 'IPv6 link-local'],
  ['http://[fd00::1]/', 'IPv6 unique-local'],
  ['http://[fc00::1]/', 'IPv6 unique-local lower bound'],

  // Cloud metadata — the highest-value SSRF target.
  ['http://169.254.169.254/latest/meta-data/', 'AWS/GCP metadata IP'],
  ['http://metadata.google.internal/', 'GCP metadata name'],
  ['http://metadata/', 'bare metadata name'],
  ['http://instance-data/', 'AWS instance-data name'],
  ['http://169.254.170.2/v2/credentials', 'ECS task metadata'],

  // RFC1918 private ranges.
  ['http://10.0.0.1/', '10/8'],
  ['http://10.255.255.255/', '10/8 upper bound'],
  ['http://172.16.0.1/', '172.16/12 lower bound'],
  ['http://172.31.255.255/', '172.16/12 upper bound'],
  ['http://192.168.1.1/', '192.168/16'],

  // Other non-routable space.
  ['http://0.0.0.0/', 'unspecified'],
  ['http://100.64.0.1/', 'carrier-grade NAT lower bound'],
  ['http://100.127.255.255/', 'carrier-grade NAT upper bound'],

  // Localhost aliases, exact and by suffix.
  ['http://localhost/', 'localhost'],
  ['http://LOCALHOST/', 'localhost is case-insensitive'],
  ['http://foo.localhost/', '.localhost suffix'],
  ['http://printer.local/', '.local suffix (mDNS)'],
  ['http://db.internal/', '.internal suffix'],
  ['http://broadcasthost/', 'broadcasthost'],
];

const ALLOWED: [string, string][] = [
  ['https://example.com/', 'ordinary public name'],
  ['https://api.github.com/repos/x/y', 'public name with path'],
  ['http://8.8.8.8/', 'public address'],
  ['http://172.32.0.1/', 'just above 172.16/12'],
  ['http://172.15.255.255/', 'just below 172.16/12'],
  ['http://11.0.0.1/', 'just above 10/8'],
  ['http://9.255.255.255/', 'just below 10/8'],
  ['http://192.167.1.1/', 'just below 192.168/16'],
  ['http://192.169.1.1/', 'just above 192.168/16'],
  ['http://100.63.255.255/', 'just below CGNAT'],
  ['http://100.128.0.1/', 'just above CGNAT'],
  ['http://126.255.255.255/', 'just below 127/8'],
  ['http://128.0.0.1/', 'just above 127/8'],
  ['https://localhost.example.com/', 'localhost as a label, not a suffix'],
  ['https://mylocal/', 'substring of a blocked name is not a match'],
  ['https://[2001:4860:4860::8888]/', 'public IPv6'],
];

describe('assertSafeUrl blocks internal network destinations', () => {
  for (const [url, why] of BLOCKED) {
    it(`blocks ${url} (${why})`, () => {
      expect(() => assertSafeUrl(url)).toThrow();
    });
  }
});

describe('assertSafeUrl allows public destinations', () => {
  for (const [url, why] of ALLOWED) {
    it(`allows ${url} (${why})`, () => {
      expect(() => assertSafeUrl(url)).not.toThrow();
    });
  }
});

describe('assertSafeUrl rejects malformed input', () => {
  it('rejects a non-URL', () => {
    expect(() => assertSafeUrl('not a url')).toThrow(/invalid URL/);
  });

  it('rejects an out-of-range octet rather than truncating it', () => {
    // 999.1.1.1 is not a valid address; the old dotted-quad regex admitted it
    // because \d{1,3} does not bound the value.
    expect(() => assertSafeUrl('http://999.1.1.1/')).toThrow();
  });
});
