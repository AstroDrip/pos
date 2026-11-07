import { describe, expect, it } from 'vitest';
import { MIN_NAME_CHARS } from './search-normalize';

describe('MIN_NAME_CHARS', () => {
  it('suggests names from the first character, Latin and Arabic', () => {
    expect(MIN_NAME_CHARS).toBe(1);
  });
});
