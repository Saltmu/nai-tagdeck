import { describe, expect, it } from 'vitest';
import { emptyWorkspace, normalizeWorkspace, workspaceReducer } from '../src/lib/workspace';
import { getKV, listEntries, putEntry, replaceAllEntries, setKV } from '../src/lib/db';

describe('workspaceReducer', () => {
  const add = (ws = emptyWorkspace(), tag = 'smile', weight?: number) =>
    workspaceReducer(ws, { type: 'add', category: 'appearance', tag, weight });

  it('追加・ON/OFF・重み・削除', () => {
    let ws = add(undefined, ' smile ', 1.2);
    const id = ws.appearance[0]!.id;
    expect(ws.appearance[0]).toMatchObject({ tag: 'smile', enabled: true, weight: 1.2 });

    ws = workspaceReducer(ws, { type: 'toggle', category: 'appearance', id });
    expect(ws.appearance[0]!.enabled).toBe(false);

    ws = workspaceReducer(ws, { type: 'setWeight', category: 'appearance', id, weight: 9 });
    expect(ws.appearance[0]!.weight).toBe(3);

    ws = workspaceReducer(ws, { type: 'remove', category: 'appearance', id });
    expect(ws.appearance).toEqual([]);
  });

  it('同じタグの追加は重複させず ON に戻す', () => {
    let ws = add();
    ws = workspaceReducer(ws, { type: 'toggle', category: 'appearance', id: ws.appearance[0]!.id });
    ws = add(ws, 'Smile');
    expect(ws.appearance).toHaveLength(1);
    expect(ws.appearance[0]!.enabled).toBe(true);
  });

  it('空のタグは無視する', () => {
    const ws = emptyWorkspace();
    expect(add(ws, '  ')).toBe(ws);
  });

  it('並べ替えと一括 ON/OFF', () => {
    let ws = add(add(undefined, 'a'), 'b');
    ws = workspaceReducer(ws, { type: 'move', category: 'appearance', id: ws.appearance[1]!.id, delta: -1 });
    expect(ws.appearance.map((t) => t.tag)).toEqual(['b', 'a']);
    ws = workspaceReducer(ws, { type: 'move', category: 'appearance', id: ws.appearance[0]!.id, delta: -1 });
    expect(ws.appearance.map((t) => t.tag)).toEqual(['b', 'a']);
    ws = workspaceReducer(ws, { type: 'setAll', category: 'appearance', enabled: false });
    expect(ws.appearance.every((t) => !t.enabled)).toBe(true);
  });

  it('他のカテゴリは変えない', () => {
    const before = emptyWorkspace();
    const after = add(before);
    expect(after.quality).toBe(before.quality);
  });
});

describe('normalizeWorkspace', () => {
  it('壊れた保存データを補正する', () => {
    const ws = normalizeWorkspace({
      quality: [{ tag: 'a', enabled: false, weight: 99 }, { tag: '' }, 'x', null],
      unknown: [{ tag: 'b' }],
      pose: 'not array',
    });
    expect(ws.quality).toHaveLength(1);
    expect(ws.quality[0]).toMatchObject({ tag: 'a', enabled: false, weight: 3 });
    expect(ws.pose).toEqual([]);
    expect('unknown' in ws).toBe(false);
    expect(normalizeWorkspace(null)).toEqual(emptyWorkspace());
  });
});

describe('db (IndexedDB)', () => {
  it('辞書と KV を保存・置き換えできる', async () => {
    const base = { category: 'quality' as const, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
    await putEntry({ id: '1', tag: 'a', ...base });
    await replaceAllEntries([{ id: '2', tag: 'b', ...base }]);
    expect((await listEntries()).map((x) => x.id)).toEqual(['2']);

    await setKV('workspace', { quality: [] });
    expect(await getKV('workspace')).toEqual({ quality: [] });
  });
});
