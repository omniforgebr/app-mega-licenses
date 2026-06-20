import { describe, it, expect, vi, afterEach } from 'vitest';
import { putFile } from '../src/github';

afterEach(() => vi.restoreAllMocks());

describe('putFile', () => {
  it('creates a new file (no prior sha) then PUTs base64 content', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string });
      if (!init?.method || init.method === 'GET') return new Response('not found', { status: 404 });
      return new Response('{}', { status: 201 });
    }));
    await putFile('omniforge/app-mega-licenses', 'licenses/abc.json', '{"x":1}', 'tok');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toContain('/repos/omniforge/app-mega-licenses/contents/licenses/abc.json');
    expect(JSON.parse(put.body!).content).toBe(btoa('{"x":1}'));
  });
});
