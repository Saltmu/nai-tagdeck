import type { DictEntry, Settings, Workspace } from '../types';
import { entriesFromData, stripBom } from './io';
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

const BACKUP_VERSION = 1;

export function toBackupJSON(data: Backup): string {
  return JSON.stringify(
    { app: 'nai-tagdeck', kind: 'backup', version: BACKUP_VERSION, exported_at: new Date().toISOString(), ...data },
    null,
    2,
  );
}

/** ネガティブ対応前のデータは、設定に文字列で持っていたネガティブをタグにして移す。 */
export function migrateNegative(rawWorkspace: unknown, rawSettings: unknown): Workspace {
  const legacy = legacyNegativePrompt(rawSettings);
  return normalizeWorkspace(rawWorkspace, legacy === null ? undefined : tagsFromText(legacy));
}

export type ParsedBackup =
  | { ok: true; data: Backup; warnings: string[]; dictionaryErrors: string[] }
  | { ok: false; error: string };

/** 確認ダイアログに出す辞書エラーの上限。残りは件数だけ知らせる。 */
const MAX_DICTIONARY_ERRORS_SHOWN = 10;

const MISSING_SECTION = {
  dictionary: 'dictionary がないため、空の辞書で補います',
  presets: 'presets がないため、空の一覧で補います',
  workspace: 'workspace がないため、空の作業状態で補います',
  settings: 'settings がないため、初期設定で補います',
  generation: 'generation がないため、初期の生成設定で補います',
} as const;

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (e) {
    return { ok: false, error: `JSON として読めません: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== 'backup') {
    return { ok: false, error: 'nai-tagdeck のバックアップファイルではありません（辞書だけのファイルは辞書画面で読み込んでください）' };
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== undefined && r.version !== BACKUP_VERSION) {
    return { ok: false, error: `このアプリが読めるバックアップは version ${BACKUP_VERSION} です（ファイルは version ${String(r.version)}）` };
  }
  const warnings: string[] = [];
  if (r.version === undefined) warnings.push(`version がないため、version ${BACKUP_VERSION} として読み込みます`);
  for (const key of Object.keys(MISSING_SECTION) as Array<keyof typeof MISSING_SECTION>) {
    if (!(key in r)) warnings.push(MISSING_SECTION[key]);
  }
  const dictionary = Array.isArray(r.dictionary) ? r.dictionary : [];
  if ('dictionary' in r && !Array.isArray(r.dictionary)) {
    warnings.push('dictionary の形式が不正なため、空の辞書で補います');
  }
  const dict = entriesFromData(dictionary);
  return {
    ok: true,
    data: {
      dictionary: dict.entries,
      presets: normalizePresets(r.presets),
      workspace: migrateNegative(r.workspace, r.settings),
      settings: normalizeSettings(r.settings),
      generation: normalizeGeneration(r.generation),
    },
    warnings,
    dictionaryErrors: dict.errors,
  };
}

/** 読み込み確認の本文。セクションの補完と、辞書の行スキップを分けて書く。 */
export function backupImportMessage(
  fileName: string,
  data: Pick<Backup, 'dictionary' | 'presets'>,
  warnings: readonly string[],
  dictionaryErrors: readonly string[],
): string {
  const lines = [
    `${fileName} を読み込みます。`,
    `・辞書 ${data.dictionary.length}件、プリセット ${data.presets.length}件を追加・上書きします`,
    '・作業中のタグと設定（ネガティブ・生成の設定）は置き換わります',
    ...warnings.map((warning) => `・${warning}`),
  ];
  if (dictionaryErrors.length > 0) {
    lines.push(`・辞書のうち ${dictionaryErrors.length}件は読めなかったためスキップします`);
    for (const error of dictionaryErrors.slice(0, MAX_DICTIONARY_ERRORS_SHOWN)) lines.push(`・${error}`);
    const rest = dictionaryErrors.length - MAX_DICTIONARY_ERRORS_SHOWN;
    if (rest > 0) lines.push(`・ほか ${rest}件`);
  }
  lines.push('', 'よろしいですか？');
  return lines.join('\n');
}
