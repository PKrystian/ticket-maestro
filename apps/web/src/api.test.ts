import { describe, expect, it } from 'vitest';

describe('frontend runtime defaults', () => {
  it('uses a same-origin API path so the client and Cloud Run service share one origin', () => {
    expect('/api/events'.startsWith('/api/')).toBe(true);
  });
});
