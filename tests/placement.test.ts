import { describe, expect, it } from 'vitest';
import { choosePlacement } from '../src/lib/placement';

const base = { boundsTop: 50, boundsBottom: 750, gap: 4, desired: 288 };

describe('choosePlacement', () => {
  it('下に収まるなら下に出す', () => {
    expect(choosePlacement({ ...base, anchorTop: 100, anchorBottom: 140 })).toEqual({ placement: 'below', maxHeight: 288 });
  });

  it('下に収まらず上のほうが広ければ上に出す', () => {
    expect(choosePlacement({ ...base, anchorTop: 600, anchorBottom: 640 })).toEqual({ placement: 'above', maxHeight: 288 });
  });

  it('どちらにも収まらなければ広いほうに出し、空きに合わせて高さを詰める', () => {
    const r = choosePlacement({ ...base, boundsBottom: 400, anchorTop: 250, anchorBottom: 290 });
    expect(r).toEqual({ placement: 'above', maxHeight: 196 });
  });

  it('上下が同じ広さなら下に出す', () => {
    const r = choosePlacement({ ...base, boundsTop: 0, boundsBottom: 300, anchorTop: 130, anchorBottom: 170 });
    expect(r.placement).toBe('below');
    expect(r.maxHeight).toBe(126);
  });
});
