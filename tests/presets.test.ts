import { describe, expect, it } from 'vitest';
import {
  filterPresets,
  createPreset,
  isEmptyWorkspace,
  mergePresets,
  normalizePresets,
  overwritePreset,
  presetToWorkspace,
  renamePreset,
  sameWorkspace,
} from '../src/lib/presets';
import { parseBackup, toBackupJSON } from '../src/lib/backup';
import { BASE, NEGATIVE, emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import type { Workspace } from '../src/types';

const withTag = (ws: Workspace, tag: string) =>
  workspaceReducer(ws, { type: 'add', target: BASE, category: 'quality', tag });

describe('presets', () => {
  it('ケモノモードをバックアップで復元できる', () => {
    const generation = { ...DEFAULT_GENERATION, mode: 'furry' as const };
    const parsed = parseBackup(toBackupJSON({
      dictionary: [], presets: [], workspace: emptyWorkspace(), settings: DEFAULT_SETTINGS, generation,
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.generation).toEqual(generation);
  });

  it('15人と6人のチェック状態をプリセットとバックアップで保持する', () => {
    const ws = Array.from({ length: 15 }).reduce<Workspace>(
      (state) => workspaceReducer(state, { type: 'addCharacter' }), emptyWorkspace(),
    );
    const preset = createPreset('15人', ws);
    expect(preset.workspace.characters).toHaveLength(15);
    expect(preset.workspace.characters.filter((c) => c.enabled)).toHaveLength(6);
    const backup = parseBackup(toBackupJSON({
      dictionary: [], presets: [preset], workspace: ws, settings: DEFAULT_SETTINGS, generation: DEFAULT_GENERATION,
    }));
    expect(backup.ok).toBe(true);
    if (!backup.ok) throw new Error(backup.error);
    expect(backup.data.workspace).toEqual(ws);
    expect(backup.data.presets[0]?.workspace).toEqual(ws);
  });

  it('保存した内容は、その後の編集の影響を受けない', () => {
    const ws = withTag(emptyWorkspace(), 'masterpiece');
    const preset = createPreset('  基本  ', ws);
    expect(preset.name).toBe('基本');
    ws.base.quality.push({ id: 'x', tag: 'mutated', enabled: true, weight: 1 });
    expect(preset.workspace.base.quality.map((t) => t.tag)).toEqual(['masterpiece']);
  });

  it('上書き・名前変更（名前順に並ぶ）', () => {
    const a = createPreset('い', emptyWorkspace());
    const b = createPreset('あ', emptyWorkspace());
    let list = [a, b];
    list = overwritePreset(list, a.id, withTag(emptyWorkspace(), 'solo'));
    expect(list.find((p) => p.id === a.id)!.workspace.base.quality[0]!.tag).toBe('solo');
    list = renamePreset(list, a.id, 'う');
    expect(list.map((p) => p.name)).toEqual(['あ', 'う']);
    expect(renamePreset(list, a.id, '  ').map((p) => p.name)).toEqual(['あ', 'う']);
  });

  it('同じ id は取り込む側で上書きする', () => {
    const a = createPreset('a', emptyWorkspace());
    const b = createPreset('b', emptyWorkspace());
    const merged = mergePresets([a, b], [{ ...a, name: 'a2' }, createPreset('c', emptyWorkspace())]);
    expect(merged.map((p) => p.name)).toEqual(['a2', 'b', 'c']);
  });

  it('壊れた保存データを補正する', () => {
    const list = normalizePresets([{ name: 'ok', workspace: { quality: [{ tag: 'x' }] } }, { name: '' }, 'bad']);
    expect(list).toHaveLength(1);
    expect(list[0]!.workspace.base.quality[0]!.tag).toBe('x');
    expect(normalizePresets(null)).toEqual([]);
    expect(normalizePresets([{ name: 'ok', id: '  kept  ', workspace: {} }])[0]!.id).toBe('kept');
    expect(normalizePresets([{ name: 'ok', id: '   ', workspace: {} }])[0]!.id.trim()).not.toBe('');
  });

  it('sameWorkspace はタグの id を無視し、ON/OFF・重み・順番・キャラ情報を比べる', () => {
    const a = withTag(emptyWorkspace(), 'masterpiece');
    const b = withTag(emptyWorkspace(), 'masterpiece');
    expect(a.base.quality[0]!.id).not.toBe(b.base.quality[0]!.id);
    expect(sameWorkspace(a, b)).toBe(true);
    expect(sameWorkspace(a, a)).toBe(true);
    const toggled = workspaceReducer(b, { type: 'toggle', target: BASE, category: 'quality', id: b.base.quality[0]!.id });
    expect(sameWorkspace(a, toggled)).toBe(false);
    const weighted = workspaceReducer(b, { type: 'setWeight', target: BASE, category: 'quality', id: b.base.quality[0]!.id, weight: 1.5 });
    expect(sameWorkspace(a, weighted)).toBe(false);

    const charA = workspaceReducer(a, { type: 'addCharacter' });
    const charB = workspaceReducer(b, { type: 'addCharacter' });
    expect(sameWorkspace(charA, a)).toBe(false);
    expect(sameWorkspace(charA, charB)).toBe(true);
    const renamed = workspaceReducer(charB, { type: 'renameCharacter', id: charB.characters[0]!.id, name: '別名' });
    expect(sameWorkspace(charA, renamed)).toBe(false);
    const disabled = workspaceReducer(charB, { type: 'toggleCharacter', id: charB.characters[0]!.id });
    expect(sameWorkspace(charA, disabled)).toBe(false);
    const charTagged = workspaceReducer(charB, { type: 'add', target: charB.characters[0]!.id, category: 'pose', tag: 'standing' });
    expect(sameWorkspace(charA, charTagged)).toBe(false);
  });

  it('isEmptyWorkspace', () => {
    expect(isEmptyWorkspace(emptyWorkspace())).toBe(true);
    expect(isEmptyWorkspace(withTag(emptyWorkspace(), 'a'))).toBe(false);
    expect(isEmptyWorkspace(workspaceReducer(emptyWorkspace(), { type: 'addCharacter' }))).toBe(false);
  });
});

describe('backup', () => {
  const data = {
    dictionary: [
      { id: '1', tag: 'smile', category: 'appearance' as const, alias: '笑顔', default_weight: 1, sort_order: 0, updated_at: 't' },
    ],
    presets: [createPreset('基本', withTag(emptyWorkspace(), 'masterpiece'))],
    workspace: withTag(emptyWorkspace(), 'solo'),
    settings: { ...DEFAULT_SETTINGS, characterNegativePrompt: 'lowres' },
    generation: { ...DEFAULT_GENERATION, seed: 5 },
  };

  it('書き出した内容を読み戻せる', () => {
    const parsed = parseBackup(toBackupJSON(data));
    expect(parsed).toEqual({ ok: true, data, warnings: [] });
  });

  it('トークンは含めない', () => {
    expect(toBackupJSON(data)).not.toMatch(/token/i);
  });

  it('辞書だけのファイルや壊れたファイルは拒否する', () => {
    expect(parseBackup('{"app":"nai-tagdeck","version":1,"entries":[]}')).toMatchObject({ ok: false });
    expect(parseBackup('{')).toMatchObject({ ok: false });
  });

  it('欠けた項目は既定値で補い、警告する', () => {
    const parsed = parseBackup('{"kind":"backup"}');
    expect(parsed).toMatchObject({
      ok: true,
      data: { dictionary: [], presets: [], settings: DEFAULT_SETTINGS, generation: DEFAULT_GENERATION },
    });
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.warnings).toEqual([
      'version がないため、version 1 として読み込みます',
      'dictionary がないため、空の辞書で補います',
      'presets がないため、空の一覧で補います',
      'workspace がないため、空の作業状態で補います',
      'settings がないため、初期設定で補います',
      'generation がないため、初期の生成設定で補います',
    ]);
    expect(parsed.data.workspace.negative.map((t) => t.tag)).toEqual(emptyWorkspace().negative.map((t) => t.tag));
  });

  it('先頭の BOM を除き、未対応の version は拒否する', () => {
    expect(parseBackup(`\uFEFF${toBackupJSON(data)}`)).toEqual({ ok: true, data, warnings: [] });
    expect(parseBackup(toBackupJSON(data).replace('"version": 1', '"version": 2'))).toMatchObject({
      ok: false,
      error: 'このアプリが読めるバックアップは version 1 です（ファイルは version 2）',
    });
  });

  it('辞書の不正な行は警告にし、JSON へ往復せず読む', () => {
    const parsed = parseBackup(JSON.stringify({
      kind: 'backup',
      version: 1,
      dictionary: [{ tag: '', category: 'quality' }, { tag: 'smile', category: 'appearance' }],
      presets: [],
      workspace: {},
      settings: {},
      generation: {},
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.dictionary.map((entry) => entry.tag)).toEqual(['smile']);
    expect(parsed.warnings).toEqual(['1件目: tag が空です']);
  });

  it('dictionary が配列でなければ空にして警告する', () => {
    const parsed = parseBackup(JSON.stringify({
      kind: 'backup',
      version: 1,
      dictionary: { entries: [] },
      presets: [],
      workspace: {},
      settings: {},
      generation: {},
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.dictionary).toEqual([]);
    expect(parsed.warnings).toEqual(['dictionary の形式が不正なため、空の辞書で補います']);
  });
});

describe('filterPresets', () => {
  const ws = emptyWorkspace();
  const list = [createPreset('海辺の少女', ws), createPreset('Night City', ws), createPreset('カフェ', ws)];

  it('returns every preset for an empty query', () => {
    expect(filterPresets(list, '  ')).toHaveLength(3);
  });

  it('matches a part of the name, ignoring case, width and kana type', () => {
    expect(filterPresets(list, '少女').map((p) => p.name)).toEqual(['海辺の少女']);
    expect(filterPresets(list, 'ｃｉｔｙ').map((p) => p.name)).toEqual(['Night City']);
    expect(filterPresets(list, 'かふぇ').map((p) => p.name)).toEqual(['カフェ']);
    expect(filterPresets(list, 'xyz')).toEqual([]);
  });
});

describe('プリセットのネガティブ', () => {
  const withNegative = (ws: Workspace, tag: string) =>
    workspaceReducer(ws, { type: 'add', target: NEGATIVE, category: 'negative', tag });

  it('ネガティブも保存して読み込む', () => {
    const saved = createPreset('a', withNegative(emptyWorkspace(), 'bad hands'));
    const [restored] = normalizePresets(JSON.parse(JSON.stringify([saved])));
    const loaded = presetToWorkspace(restored!.workspace, { ...emptyWorkspace(), negative: [] });
    expect(loaded.negative.map((t) => t.tag)).toContain('bad hands');
  });

  it('ネガティブ対応前のプリセットは、読み込んでも作業中のネガティブを残す', () => {
    const { negative: _omit, ...old } = withTag(emptyWorkspace(), 'masterpiece');
    const [restored] = normalizePresets([{ id: 'p', name: '古い', workspace: old, updated_at: 't' }]);
    expect(restored!.workspace.negative).toBeUndefined();
    const current = { ...emptyWorkspace(), negative: [{ id: 'n', tag: 'mine', enabled: true, weight: 1 }] };
    const loaded = presetToWorkspace(restored!.workspace, current);
    expect(loaded.negative.map((t) => t.tag)).toEqual(['mine']);
    expect(loaded.base.quality.map((t) => t.tag)).toEqual(['masterpiece']);
    // 古いプリセットとはネガティブを比べない
    expect(sameWorkspace(restored!.workspace, withNegative(loaded, 'other'))).toBe(true);
  });

  it('どちらもネガティブを持つときは違いを検出する', () => {
    const ws = emptyWorkspace();
    expect(sameWorkspace(ws, withNegative(ws, 'other'))).toBe(false);
    expect(isEmptyWorkspace(withNegative(ws, 'other'))).toBe(true);
  });
});
