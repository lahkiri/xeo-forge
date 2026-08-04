import { describe, it, expect } from 'vitest';
import { toPgPlaceholders, translateForPg } from '@/lib/db/index';

describe('toPgPlaceholders', () => {
  it('converts sequential ? to $1, $2, ...', () => {
    expect(toPgPlaceholders('a=? AND b=?')).toBe('a=$1 AND b=$2');
  });

  it('preserves ? inside single-quoted literals', () => {
    expect(toPgPlaceholders("x=? AND y='What?'")).toBe("x=$1 AND y='What?'");
  });

  it('preserves ? inside double-quoted identifiers', () => {
    expect(toPgPlaceholders('"col?" = ?')).toBe('"col?" = $1');
  });

  it('returns sql unchanged when no placeholders', () => {
    expect(toPgPlaceholders('SELECT 1')).toBe('SELECT 1');
  });
});

describe('translateForPg', () => {
  it('rewrites INSERT OR IGNORE INTO to ON CONFLICT DO NOTHING', () => {
    const out = translateForPg('INSERT OR IGNORE INTO t (a) VALUES (?)');
    expect(out).toBe('INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING');
  });

  it('leaves plain INSERT untouched (other than placeholders)', () => {
    expect(translateForPg('INSERT INTO t (a) VALUES (?)')).toBe(
      'INSERT INTO t (a) VALUES ($1)'
    );
  });
});
