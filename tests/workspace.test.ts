import { describe, expect, it } from 'vitest';
import {
  BASE,
  MAX_CHARACTERS,
  emptyGroups,
  emptyWorkspace,
  normalizeWorkspace,
  workspaceReducer,
  type WorkspaceAction,
} from '../src/lib/workspace';
import { getKV, listEntries, putEntry, replaceAllEntries, setKV } from '../src/lib/db';
import type { Workspace } from '../src/types';

const run = (ws: Workspace, ...actions: WorkspaceAction[]) => actions.reduce(workspaceReducer, ws);

describe('workspaceReducer: ベースのタグ', () => {
  const add = (ws = emptyWorkspace(), tag = 'smile', weight?: number) =>
    workspaceReducer(ws, { type: 'add', target: BASE, category: 'appearance', tag, weight });

  it('追加・ON/OFF・重み・削除', () => {
    let ws = add(undefined, ' smile ', 1.2);
    const id = ws.base.appearance[0]!.id;
    expect(ws.base.appearance[0]).toMatchObject({ tag: 'smile', enabled: true, weight: 1.2 });

    ws = run(ws, { type: 'toggle', target: BASE, category: 'appearance', id });
    expect(ws.base.appearance[0]!.enabled).toBe(false);

    ws = run(ws, { type: 'setWeight', target: BASE, category: 'appearance', id, weight: 9 });
    expect(ws.base.appearance[0]!.weight).toBe(3);

    ws = run(ws, { type: 'setWeight', target: BASE, category: 'appearance', id, weight: -1 });
    expect(ws.base.appearance[0]!.weight).toBe(-1);

    ws = run(ws, { type: 'remove', target: BASE, category: 'appearance', id });
    expect(ws.base.appearance).toEqual([]);
  });

  it('同じタグの追加は重複させず ON に戻す', () => {
    let ws = add();
    ws = run(ws, { type: 'toggle', target: BASE, category: 'appearance', id: ws.base.appearance[0]!.id });
    ws = add(ws, 'Smile');
    expect(ws.base.appearance).toHaveLength(1);
    expect(ws.base.appearance[0]!.enabled).toBe(true);
  });

  it('空のタグは無視する', () => {
    const ws = emptyWorkspace();
    expect(add(ws, '  ')).toBe(ws);
  });

  it('並べ替えと一括 ON/OFF', () => {
    let ws = add(add(undefined, 'a'), 'b');
    const b = ws.base.appearance[1];
    ws = run(ws, { type: 'move', target: BASE, category: 'appearance', id: b!.id, delta: -1 });
    expect(ws.base.appearance.map((t) => t.tag)).toEqual(['b', 'a']);
    ws = run(ws, { type: 'move', target: BASE, category: 'appearance', id: b!.id, delta: -1 });
    expect(ws.base.appearance.map((t) => t.tag)).toEqual(['b', 'a']);
    ws = run(ws, { type: 'setAll', target: BASE, category: 'appearance', enabled: false });
    expect(ws.base.appearance.every((t) => !t.enabled)).toBe(true);
  });

  it('他のカテゴリとキャラクターは変えない', () => {
    const before = run(emptyWorkspace(), { type: 'addCharacter' });
    const after = add(before);
    expect(after.base.quality).toBe(before.base.quality);
    expect(after.characters).toBe(before.characters);
  });
});

describe('workspaceReducer: キャラクター', () => {
  it('追加・名前変更・ON/OFF・並べ替え・削除', () => {
    let ws = run(emptyWorkspace(), { type: 'addCharacter' }, { type: 'addCharacter' });
    expect(ws.characters.map((c) => c.name)).toEqual(['キャラ1', 'キャラ2']);
    const [c1, c2] = ws.characters;

    ws = run(
      ws,
      { type: 'renameCharacter', id: c1!.id, name: 'アリス' },
      { type: 'toggleCharacter', id: c2!.id },
      { type: 'moveCharacter', id: c2!.id, delta: -1 },
    );
    expect(ws.characters.map((c) => [c.name, c.enabled])).toEqual([
      ['キャラ2', false],
      ['アリス', true],
    ]);

    ws = run(ws, { type: 'removeCharacter', id: c2!.id });
    expect(ws.characters.map((c) => c.id)).toEqual([c1!.id]);
  });

  it(`上限は ${MAX_CHARACTERS} 人`, () => {
    const actions = Array.from({ length: MAX_CHARACTERS + 2 }, () => ({ type: 'addCharacter' }) as const);
    expect(run(emptyWorkspace(), ...actions).characters).toHaveLength(MAX_CHARACTERS);
  });

  it('タグ操作は指定したキャラクターだけに効く', () => {
    let ws = run(emptyWorkspace(), { type: 'addCharacter' }, { type: 'addCharacter' });
    const [c1, c2] = ws.characters;
    ws = run(ws, { type: 'add', target: c2!.id, category: 'subject', tag: 'girl' });
    expect(ws.characters[0]).toBe(c1);
    expect(ws.characters[1]!.tags.subject.map((t) => t.tag)).toEqual(['girl']);
    expect(ws.base.subject).toEqual([]);
  });

  it('存在しないキャラクターへの操作は無視する', () => {
    const ws = emptyWorkspace();
    expect(run(ws, { type: 'add', target: 'nope', category: 'subject', tag: 'x' })).toBe(ws);
    expect(run(ws, { type: 'renameCharacter', id: 'nope', name: 'x' })).toBe(ws);
  });
});

describe('normalizeWorkspace', () => {
  it('壊れた保存データを補正する', () => {
    const ws = normalizeWorkspace({
      base: {
        quality: [{ tag: 'a', enabled: false, weight: -99 }, { tag: '' }, 'x', null],
        unknown: [{ tag: 'b' }],
        pose: 'not array',
      },
      characters: [{ name: '', tags: { subject: [{ tag: 'girl' }] } }, 'bad'],
    });
    expect(ws.base.quality).toHaveLength(1);
    expect(ws.base.quality[0]).toMatchObject({ tag: 'a', enabled: false, weight: -3 });
    expect(ws.base.pose).toEqual([]);
    expect('unknown' in ws.base).toBe(false);
    expect(ws.characters).toHaveLength(1);
    expect(ws.characters[0]).toMatchObject({ name: 'キャラ1', enabled: true });
    expect(ws.characters[0]!.tags.subject[0]!.tag).toBe('girl');
    expect(normalizeWorkspace(null)).toEqual(emptyWorkspace());
  });

  it('キャラクター対応前の保存形式はベースとして読む', () => {
    const ws = normalizeWorkspace({ quality: [{ tag: 'masterpiece' }] });
    expect(ws.base.quality[0]!.tag).toBe('masterpiece');
    expect(ws.characters).toEqual([]);
    expect(Object.keys(ws.base)).toEqual(Object.keys(emptyGroups()));
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
