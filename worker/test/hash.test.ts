import { describe, it, expect } from 'vitest';
import { normalizeDomain } from '../src/domain';
import { sha256Hex } from '../src/hash';

describe('normalizeDomain', () => {
  it('strips protocol, trailing slash, lowercases, trims', () => {
    expect(normalizeDomain('  HTTPS://Chat.Empresa.com.br/ ')).toBe('chat.empresa.com.br');
  });
});

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
