import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildImageZip } from '../src/lib/imageZip';

describe('buildImageZip', () => {
  it('stores file bytes under the individual download names', () => {
    const first = new Uint8Array([1, 2, 3, 4, 5]);
    const second = new Uint8Array([9, 8, 7]);
    const zip = buildImageZip([
      { name: 'nai-tagdeck-20261122-120000-1.png', data: first },
      { name: 'nai-tagdeck-20261122-120001-2.png', data: second },
    ]);
    expect(zip[8]).toBe(0);
    expect(zip[9]).toBe(0);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      'nai-tagdeck-20261122-120000-1.png',
      'nai-tagdeck-20261122-120001-2.png',
    ]);
    expect(files['nai-tagdeck-20261122-120000-1.png']).toEqual(first);
    expect(files['nai-tagdeck-20261122-120001-2.png']).toEqual(second);
  });

  it('keeps the first name and suffixes later duplicates', () => {
    const zip = buildImageZip([
      { name: 'same.png', data: new Uint8Array([1]) },
      { name: 'same.png', data: new Uint8Array([2]) },
      { name: 'same.png', data: new Uint8Array([3]) },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['same.png', 'same-2.png', 'same-3.png']);
    expect(files['same.png']).toEqual(new Uint8Array([1]));
    expect(files['same-2.png']).toEqual(new Uint8Array([2]));
    expect(files['same-3.png']).toEqual(new Uint8Array([3]));
  });
});
