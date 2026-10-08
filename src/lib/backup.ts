import type { DictEntry, Settings, Workspace } from '../types';
import { fromJSON } from './io';
import { normalizePresets, type Preset } from './presets';
import { legacyNegativePrompt, normalizeSettings } from './settings';
import { normalizeGeneration, type GenerationSettings } from './generation';
import { normalizeWorkspace, tagsFromText } from './workspace';

/**
 * 端末間でデータを移すためのバックアップ。辞書・プリセット・作業中のタグ・設定を1つの JSON にまとめる。
 * トークンは含めない。
 */
export interface Backup {
  dictionary: DictEntry[];
  presets: Preset[];
  workspace: Workspace;
  settings: Settings;
  generation: GenerationSettings;
}

export function toBackupJSON(data: Backup): string {
  return JSON.stringify(
    { app: 'nai-tagdeck', kind: 'backup', version: 1, exported_at: new Date().toISOString(), ...data },
    null,
    2,
  );
}

/** ネガティブ対応前のデータは、設定に文字列で持っていたネガティブをタグにして移す。 */
export function migrateNegative(rawWorkspace: unknown, rawSettings: unknown): Workspace {
  const legacy = legacyNegativePrompt(rawSettings);
  return normalizeWorkspace(rawWorkspace, legacy === null ? undefined : tagsFromText(legacy));
}

export type ParsedBackup = { ok: true; data: Backup; warnings: string[] } | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, error: `JSON として読めません: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'backup') {
    return { ok: false, error: 'nai-tagdeck のバックアップファイルではありません（辞書だけのファイルは辞書画面で読み込んでください）' };
  }
  const r = raw as Record<string, unknown>;
  const dict = fromJSON(JSON.stringify({ entries: Array.isArray(r.dictionary) ? r.dictionary : [] }));
  return {
    ok: true,
    data: {
      dictionary: dict.entries,
      presets: normalizePresets(r.presets),
      workspace: migrateNegative(r.workspace, r.settings),
      settings: normalizeSettings(r.settings),
      generation: normalizeGeneration(r.generation),
    },
    warnings: dict.errors,
  };
}
