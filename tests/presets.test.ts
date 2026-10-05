import { describe, expect, it } from 'vitest';
import {
  createPreset,
  isEmptyWorkspace,
  mergePresets,
  normalizePresets,
  overwritePreset,
  renamePreset,
  sameWorkspace,
} from '../src/lib/presets';
import { parseBackup, toBackupJSON } from '../src/lib/backup';
import { BASE, emptyWorkspace, workspaceReducer } from '../src/lib/workspace';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import type { Workspace } from '../src/types';

const withTag = (ws: Workspace, tag: string) =>
  workspaceReducer(ws, { type: 'add', target: BASE, category: 'quality', tag });

describe('presets', () => {
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
  });

  it('sameWorkspace はタグの id を無視し、ON/OFF・重み・順番を比べる', () => {
    const a = withTag(emptyWorkspace(), 'masterpiece');
    const b = withTag(emptyWorkspace(), 'masterpiece');
    expect(a.base.quality[0]!.id).not.toBe(b.base.quality[0]!.id);
    expect(sameWorkspace(a, b)).toBe(true);
    const toggled = workspaceReducer(b, { type: 'toggle', target: BASE, category: 'quality', id: b.base.quality[0]!.id });
    expect(sameWorkspace(a, toggled)).toBe(false);
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
    settings: { ...DEFAULT_SETTINGS, negativePrompt: 'lowres' },
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

  it('欠けた項目は既定値で補う', () => {
    const parsed = parseBackup('{"kind":"backup"}');
    expect(parsed).toEqual({
      ok: true,
      data: { dictionary: [], presets: [], workspace: emptyWorkspace(), settings: DEFAULT_SETTINGS, generation: DEFAULT_GENERATION },
      warnings: [],
    });
  });
});
