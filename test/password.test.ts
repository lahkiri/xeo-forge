import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('verifies a correct password roundtrip', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('s3cret-pass');
    expect(await verifyPassword('wrong-pass', stored)).toBe(false);
  });

  it('rejects a malformed stored string', async () => {
    expect(await verifyPassword('whatever', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('whatever', '')).toBe(false);
    expect(await verifyPassword('whatever', 'bcrypt$abc$def')).toBe(false);
  });

  it('produces a distinct hash each time (random salt)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('uses the scrypt$salt$hash format', async () => {
    const stored = await hashPassword('x');
    const parts = stored.split('$');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });
});
