import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import {
  BASE,
  MAX_CHARACTERS,
  MAX_ENABLED_CHARACTERS,
  NEGATIVE,
  emptyGroups,
  emptyWorkspace,
  normalizeWorkspace,
  tagsFromText,
  workspaceReducer,
  type WorkspaceAction,
} from '../src/lib/workspace';
import { migrateNegative } from '../src/lib/backup';
import { buildPrompt } from '../src/lib/prompt';
import { DEFAULT_NEGATIVE } from '../src/lib/novelai';
import { getKV, listEntries, putEntry, replaceAllEntries, setKV } from '../src/lib/db';
import type { Workspace } from '../src/types';

const run = (ws: Workspace, ...actions: WorkspaceAction[]) => actions.reduce(workspaceReducer, ws);

describe('workspaceReducer: ベースのタグ', () => {
  const add = (ws = emptyWorkspace(), tag = 'smile', weight?: number) =>
    workspaceReducer(ws, { type: 'add', target: BASE, category: 'appearance', tag, weight });

  it('タグ名の編集はID・重み・ON/OFF・並び順を保持し、再読み込みでも残る', () => {
    const original = add(add(undefined, 'long hair', 1.3), 'blue eyes');
    const first = original.base.appearance[0]!;
    const before = run(original, { type: 'toggle', target: BASE, category: 'appearance', id: first.id });
    const after = run(before, { type: 'setTag', target: BASE, category: 'appearance', id: first.id, tag: ' short hair ' });
    expect(after.base.appearance[0]).toEqual({ ...before.base.appearance[0], tag: 'short hair' });
    expect(after.base.appearance[1]).toBe(before.base.appearance[1]);
    expect(before.base.appearance[0]?.tag).toBe('long hair');
    expect(normalizeWorkspace(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });

  it('pickOne はグループの1つだけを先頭に置き、ほかを外す', () => {
    const group = ['girl', 'boy', 'other'];
    const pick = (ws: Workspace, tag: string | null) =>
      workspaceReducer(ws, { type: 'pickOne', target: BASE, category: 'subject', group, tag });
    const base = workspaceReducer(emptyWorkspace(), { type: 'add', target: BASE, category: 'subject', tag: 'mature female' });
    const girl = pick(base, 'girl');
    expect(girl.base.subject.map((t) => t.tag)).toEqual(['girl', 'mature female']);
    const boy = pick(girl, 'boy');
    expect(boy.base.subject.map((t) => t.tag)).toEqual(['boy', 'mature female']);
    expect(pick(boy, null).base.subject.map((t) => t.tag)).toEqual(['mature female']);
  });

  it('空欄や同じカテゴリ内の重複タグへの変更は拒否する', () => {
    const before = add(add(undefined, 'long hair'), 'blue eyes');
    const id = before.base.appearance[0]!.id;
    expect(run(before, { type: 'setTag', target: BASE, category: 'appearance', id, tag: ' ' })).toBe(before);
    expect(run(before, { type: 'setTag', target: BASE, category: 'appearance', id, tag: 'BLUE_EYES' })).toBe(before);
  });

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
  it('キャラクターのタグ名を編集してもベース・別キャラクターは変えない', () => {
    let before = run(emptyWorkspace(), { type: 'addCharacter' }, { type: 'addCharacter' });
    const id = before.characters[1]!.id;
    before = run(before, { type: 'add', target: id, category: 'appearance', tag: 'long hair', weight: 0.8 });
    const original = before.characters[1]!.tags.appearance[0]!;
    const after = run(before, { type: 'setTag', target: id, category: 'appearance', id: original.id, tag: 'wavy hair' });
    expect(after.characters[1]!.tags.appearance[0]).toEqual({ ...original, tag: 'wavy hair' });
    expect(after.base).toBe(before.base);
    expect(after.characters[0]).toBe(before.characters[0]);
    expect(before.characters[1]!.tags.appearance[0]?.tag).toBe('long hair');
  });
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

  it('15人まで保存し、追加時は6人まで自動でONにする', () => {
    const actions = Array.from({ length: 16 }, () => ({ type: 'addCharacter' }) as const);
    const ws = run(emptyWorkspace(), ...actions);
    expect(ws.characters).toHaveLength(15);
    expect(ws.characters.filter((c) => c.enabled)).toHaveLength(6);
    expect(ws.characters.slice(6).every((c) => !c.enabled)).toBe(true);
  });

  it('6人がONのときは7人目をONにせず、チェックを外すと別の人をONにできる', () => {
    let ws = run(emptyWorkspace(), ...Array.from({ length: 7 }, () => ({ type: 'addCharacter' }) as const));
    const first = ws.characters[0]!;
    const seventh = ws.characters[6]!;
    expect(run(ws, { type: 'toggleCharacter', id: seventh.id })).toBe(ws);
    ws = run(ws, { type: 'toggleCharacter', id: first.id }, { type: 'toggleCharacter', id: seventh.id });
    expect(ws.characters[0]!.enabled).toBe(false);
    expect(ws.characters[6]!.enabled).toBe(true);
    expect(ws.characters.filter((c) => c.enabled)).toHaveLength(MAX_ENABLED_CHARACTERS);
    ws = run(ws, { type: 'removeCharacter', id: seventh.id }, { type: 'addCharacter' });
    expect(ws.characters.at(-1)?.enabled).toBe(true);
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
  it('着衣状態を衣装の後ろに統合し、ベースとキャラのタグ設定を引き継ぐ', () => {
    const jacket = { id: 'jacket', tag: 'jacket', enabled: true, weight: 1 };
    const open = { id: 'open', tag: 'open jacket', enabled: true, weight: 1.2 };
    const rolled = { id: 'rolled', tag: 'sleeves rolled up', enabled: false, weight: 0.9 };
    const groups = { outfit: [jacket], dress_state: [open, rolled] };
    const ws = normalizeWorkspace({ base: groups, characters: [{ tags: groups }] });

    expect(ws.base.outfit).toEqual([jacket, open, rolled]);
    expect(ws.characters[0]?.tags.outfit).toEqual(ws.base.outfit);
    expect(ws.base).not.toHaveProperty('dress_state');
    expect(buildPrompt(ws.base, 'numeric')).toBe('jacket, 1.2::open jacket::');
    expect(normalizeWorkspace(ws)).toEqual(ws);
  });

  it('読み込み・置き換えでも15人を保持してチェックは先頭の6人までにする', () => {
    const raw = {
      base: {},
      characters: Array.from({ length: 17 }, (_, i) => ({
        id: `character-${i}`, name: `キャラ${i}`, enabled: i !== 0,
        tags: { appearance: [{ tag: `tag-${i}` }] },
      })),
    };
    const ws = normalizeWorkspace(raw);
    expect(ws.characters).toHaveLength(15);
    expect(ws.characters.filter((c) => c.enabled).map((c) => c.id))
      .toEqual(Array.from({ length: 6 }, (_, i) => `character-${i + 1}`));
    expect(ws.characters[14]?.tags.appearance[0]?.tag).toBe('tag-14');
    const replaced = run(emptyWorkspace(), { type: 'replace', workspace: { ...ws, characters: ws.characters.map((c) => ({ ...c, enabled: true })) } });
    expect(replaced.characters.filter((c) => c.enabled)).toHaveLength(6);
    expect(replaced.characters).toHaveLength(15);
  });

  it('新カテゴリ追加前のデータを保持し、背景・天候に空の配列を補う', () => {
    const ws = normalizeWorkspace({
      base: { composition: [{ id: 'bg', tag: 'white background' }], effect: [{ id: 'rain', tag: 'rain' }] },
      characters: [{ id: 'character', tags: { appearance: [{ tag: 'smile' }] } }],
    });
    expect(ws.base.composition[0]?.tag).toBe('white background');
    expect(ws.base.effect[0]?.tag).toBe('rain');
    expect(ws.base.background).toEqual([]);
    expect(ws.base.weather).toEqual([]);
    expect(ws.characters[0]?.tags.background).toEqual([]);
    expect(ws.characters[0]?.tags.weather).toEqual([]);
    expect(ws.characters[0]?.tags.appearance[0]?.tag).toBe('smile');
  });

  it('背景・天候のタグを保存データから復元する', () => {
    const ws = run(emptyWorkspace(),
      { type: 'add', target: BASE, category: 'background', tag: 'forest' },
      { type: 'add', target: BASE, category: 'weather', tag: 'night' },
    );
    expect(normalizeWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

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
    const empty = normalizeWorkspace(null);
    expect(empty).toMatchObject({ base: emptyGroups(), characters: [] });
    expect(empty.negative.map((t) => t.tag)).toEqual(emptyWorkspace().negative.map((t) => t.tag));
  });

  it('空の ID は読み込み時に振り直す', () => {
    const ws = normalizeWorkspace({
      base: { quality: [{ id: '', tag: 'a' }, { id: '   ', tag: 'b' }, { id: 'keep', tag: 'c' }] },
      characters: [{ id: '', name: 'n', tags: { subject: [{ id: '', tag: 'girl' }] } }],
    });
    const ids = [
      ws.base.quality[0]!.id,
      ws.base.quality[1]!.id,
      ws.characters[0]!.id,
      ws.characters[0]!.tags.subject[0]!.id,
    ];
    expect(ws.base.quality[2]!.id).toBe('keep');
    expect(ids.every((id) => id.trim() !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('未分類から移すとき、移動先にある同じタグは重複させない', () => {
    const start = run(
      emptyWorkspace(),
      { type: 'add', target: BASE, category: 'outfit', tag: 'hat' },
      { type: 'add', target: BASE, category: 'unclassified', tag: 'Hat' },
      { type: 'add', target: BASE, category: 'unclassified', tag: 'scarf' },
    );
    const hat = start.base.unclassified[0]!;
    const scarf = start.base.unclassified[1]!;
    const moved = workspaceReducer(start, { type: 'moveFromUnclassified', target: BASE, id: hat.id, to: 'outfit' });
    expect(moved.base.outfit.map((t) => t.tag)).toEqual(['hat']);
    expect(moved.base.outfit[0]).toBe(start.base.outfit[0]);
    expect(moved.base.unclassified.map((t) => t.tag)).toEqual(['scarf']);
    const movedScarf = workspaceReducer(moved, { type: 'moveFromUnclassified', target: BASE, id: scarf.id, to: 'outfit' });
    expect(movedScarf.base.outfit.map((t) => t.tag)).toEqual(['hat', 'scarf']);
    expect(movedScarf.base.unclassified).toEqual([]);
  });

  it('キャラクター対応前の保存形式はベースとして読む', () => {
    const ws = normalizeWorkspace({ quality: [{ tag: 'masterpiece' }] });
    expect(ws.base.quality[0]!.tag).toBe('masterpiece');
    expect(ws.base.style).toEqual([]); // 画風カテゴリ追加前のデータ
    expect(ws.characters).toEqual([]);
    expect(Object.keys(ws.base)).toEqual(Object.keys(emptyGroups()));
  });
});

describe('db (IndexedDB)', () => {
  it('以前に保存された辞書の着衣状態を衣装として読み出す', async () => {
    await replaceAllEntries([]);
    const entry = {
      id: 'legacy', tag: 'open jacket', category: 'dress_state',
      alias: '前開き', default_weight: 1.2, sort_order: 4, updated_at: '2026-01-01',
    };
    const db = await openDB('nai-tagdeck', 1);
    try {
      await db.put('dictionary', entry);
      expect(await listEntries()).toEqual([{ ...entry, category: 'outfit' }]);
    } finally {
      db.close();
      await replaceAllEntries([]);
    }
  });

  it('辞書と KV を保存・置き換えできる', async () => {
    const base = { category: 'quality' as const, alias: '', default_weight: 1, sort_order: 0, updated_at: '' };
    await putEntry({ id: '1', tag: 'a', ...base });
    await replaceAllEntries([{ id: '2', tag: 'b', ...base }]);
    expect((await listEntries()).map((x) => x.id)).toEqual(['2']);

    await setKV('workspace', { quality: [] });
    expect(await getKV('workspace')).toEqual({ quality: [] });
  });
});

describe('ネガティブ', () => {
  const tags = (ws: Workspace) => ws.negative.map((t) => t.tag);

  it('空の状態には既定のネガティブ（heavy）が ON で入る', () => {
    const ws = emptyWorkspace();
    expect(tags(ws)).toEqual(tagsFromText(DEFAULT_NEGATIVE).map((t) => t.tag));
    expect(tags(ws)[0]).toBe('nsfw');
    expect(ws.negative.every((t) => t.enabled && t.weight === 1)).toBe(true);
  });

  it("category: 'negative' の操作はベースやキャラクターではなくネガティブを変える", () => {
    const ws = run(
      { ...emptyWorkspace(), negative: [] },
      { type: 'add', target: NEGATIVE, category: 'negative', tag: 'bad hands', weight: 1.2 },
      { type: 'add', target: NEGATIVE, category: 'negative', tag: 'blurry' },
    );
    expect(ws.negative.map((t) => [t.tag, t.weight])).toEqual([['bad hands', 1.2], ['blurry', 1]]);
    expect(ws.base).toEqual(emptyGroups());
    const off = run(ws, { type: 'toggle', target: NEGATIVE, category: 'negative', id: ws.negative[0]!.id });
    expect(off.negative[0]!.enabled).toBe(false);
  });

  it('ネガティブはベースのプロンプトに出力しない', () => {
    const ws = run(emptyWorkspace(), { type: 'add', target: BASE, category: 'quality', tag: 'masterpiece' });
    expect(buildPrompt(ws.base, 'numeric')).toBe('masterpiece');
    expect(Object.keys(ws.base)).not.toContain('negative');
  });

  it('保存済みのネガティブはそのまま読み、対応前のデータには代わりの値を入れる', () => {
    expect(tags(normalizeWorkspace({ base: {}, negative: [{ tag: 'lowres', enabled: false }] }))).toEqual(['lowres']);
    expect(normalizeWorkspace({ base: {}, negative: [] }).negative).toEqual([]);
    expect(tags(normalizeWorkspace({ base: {} }, tagsFromText('a, b')))).toEqual(['a', 'b']);
    expect(tags(normalizeWorkspace({ base: {} }))).toEqual(tags(emptyWorkspace()));
  });

  it('文字列からタグにするとき、重みを読み取り重複を除く', () => {
    expect(tagsFromText('lowres, {bad hands}, 1.5::blurry::, lowres').map((t) => [t.tag, t.weight])).toEqual([
      ['lowres', 1],
      ['bad hands', 1.05],
      ['blurry', 1.5],
    ]);
  });
});

describe('migrateNegative', () => {
  it('設定に残っていた文字列のネガティブをタグにして移す', () => {
    const ws = migrateNegative({ base: {} }, { negativePrompt: 'lowres, worst quality' });
    expect(ws.negative.map((t) => t.tag)).toEqual(['lowres', 'worst quality']);
  });
  it('空文字のネガティブは「なし」として移す', () => {
    expect(migrateNegative({ base: {} }, { negativePrompt: '' }).negative).toEqual([]);
  });
  it('設定にもなければ既定値、ワークスペースが持っていればそちらを使う', () => {
    expect(migrateNegative({ base: {} }, {}).negative.map((t) => t.tag)).toEqual(emptyWorkspace().negative.map((t) => t.tag));
    expect(migrateNegative({ base: {}, negative: [{ tag: 'x' }] }, { negativePrompt: 'y' }).negative.map((t) => t.tag)).toEqual(['x']);
  });
});
