import { describe, it, expect } from 'vitest';
import { canonicalize } from '../src/canonical';

describe('canonicalize', () => {
  it('sorts keys and emits no whitespace', () => {
    expect(canonicalize({ b: 1, a: 'x' })).toBe('{"a":"x","b":1}');
  });
  it('is stable regardless of input key order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });
});
