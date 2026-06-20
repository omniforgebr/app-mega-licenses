const API = 'https://api.github.com';
const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'User-Agent': 'app-mega-license-worker',
  Accept: 'application/vnd.github+json',
});

async function getSha(repo: string, path: string, token: string): Promise<string | undefined> {
  const r = await fetch(`${API}/repos/${repo}/contents/${path}`, { headers: headers(token) });
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error('github get ' + r.status);
  return ((await r.json()) as { sha: string }).sha;
}

export async function putFile(repo: string, path: string, content: string, token: string): Promise<void> {
  const sha = await getSha(repo, path, token);
  const body = JSON.stringify({
    message: `license: update ${path}`,
    content: btoa(unescape(encodeURIComponent(content))),
    ...(sha ? { sha } : {}),
  });
  const r = await fetch(`${API}/repos/${repo}/contents/${path}`, { method: 'PUT', headers: headers(token), body });
  if (!r.ok) throw new Error('github put ' + r.status + ' ' + (await r.text()));
}

export async function purgeJsdelivr(repo: string, path: string): Promise<void> {
  try {
    await fetch(`https://purge.jsdelivr.net/gh/${repo}@main/${path}`);
  } catch {
    // purge is best-effort; raw.githubusercontent is the fresh source anyway
  }
}
