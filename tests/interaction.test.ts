import { describe, expect, it } from 'vitest';
import { pairedInteraction, splitInteraction, withInteraction } from '../src/lib/interaction';

describe('interaction prefixes', () => {
  it('splits a typed prefix from the rest', () => {
    expect(splitInteraction('source#hug')).toEqual({ interaction: 'source', body: 'hug' });
    expect(splitInteraction(' Mutual # holding')).toEqual({ interaction: 'mutual', body: 'holding' });
    expect(splitInteraction('hug')).toEqual({ interaction: null, body: 'hug' });
  });

  it('adds or replaces the prefix', () => {
    expect(withInteraction('hug', 'target')).toBe('target#hug');
    expect(withInteraction('source#hug', 'target')).toBe('target#hug');
    expect(withInteraction('source#hug', null)).toBe('source#hug');
  });

  it('returns the tag the other character needs', () => {
    expect(pairedInteraction('source#hug')).toBe('target#hug');
    expect(pairedInteraction('target#hug')).toBe('source#hug');
    expect(pairedInteraction('mutual#holding hands')).toBe('mutual#holding hands');
    expect(pairedInteraction('hug')).toBeNull();
    expect(pairedInteraction('source#')).toBeNull();
  });
});
