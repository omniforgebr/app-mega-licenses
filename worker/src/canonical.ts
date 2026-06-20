// Flat manifest only: sort keys, JSON-encode each value, no whitespace.
export function canonicalize(obj: Record<string, unknown>): string {
  const parts = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k]));
  return '{' + parts.join(',') + '}';
}
