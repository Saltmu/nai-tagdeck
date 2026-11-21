import type { DictEntry } from '../types';
import { categoryIndex, parseCategory } from './categories';
import { normalizeId } from './id';
import { clampWeight } from './prompt';
import { normalize } from './suggest';

/** Excel 向け CSV の先頭に付ける UTF-8 BOM。 */
export const UTF8_BOM = '\uFEFF';

export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

export const CSV_COLUMNS = [
  'id',
  'tag',
  'category',
  'alias',
  'default_weight',
  'sort_order',
  'updated_at',
] as const;

export interface ImportResult {
  entries: DictEntry[];
  errors: string[];
}

export function sortEntries(entries: readonly DictEntry[]): DictEntry[] {
  return [...entries].sort(
    (a, b) =>
      categoryIndex(a.category) - categoryIndex(b.category) ||
      a.sort_order - b.sort_order ||
      a.tag.localeCompare(b.tag),
  );
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}

/** 1件を検証して DictEntry にする。失敗したらエラー文を返す。 */
export function coerceEntry(raw: Record<string, unknown>, where: string): DictEntry | string {
  const tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
  if (!tag) return `${where}: tag が空です`;
  const category = parseCategory(String(raw.category ?? ''));
  if (!category) return `${where}: category「${String(raw.category ?? '')}」は不明です`;
  const id = normalizeId(raw.id);
  const updatedAt =
    typeof raw.updated_at === 'string' && raw.updated_at.trim()
      ? raw.updated_at.trim()
      : new Date().toISOString();
  return {
    id,
    tag,
    category,
    alias: typeof raw.alias === 'string' ? raw.alias.trim() : '',
    default_weight: clampWeight(toNumber(raw.default_weight, 1)),
    sort_order: Math.trunc(toNumber(raw.sort_order, 0)),
    updated_at: updatedAt,
  };
}

function collect(rows: Array<{ raw: Record<string, unknown>; where: string }>): ImportResult {
  const entries: DictEntry[] = [];
  const errors: string[] = [];
  for (const { raw, where } of rows) {
    const result = coerceEntry(raw, where);
    if (typeof result === 'string') errors.push(result);
    else entries.push(result);
  }
  return { entries, errors };
}

// ---- JSON ----

export function toJSON(entries: readonly DictEntry[]): string {
  return JSON.stringify(
    { app: 'nai-tagdeck', version: 1, exported_at: new Date().toISOString(), entries: sortEntries(entries) },
    null,
    2,
  );
}

/** 配列、または `{ entries }` の中の辞書を検証する。 */
export function entriesFromData(data: unknown): ImportResult {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)
      ? (data as { entries: unknown[] }).entries
      : null;
  if (!list) return { entries: [], errors: ['entries 配列が見つかりません'] };
  return collect(
    list.map((item, i) => ({
      raw: item && typeof item === 'object' ? (item as Record<string, unknown>) : {},
      where: `${i + 1}件目`,
    })),
  );
}

export function fromJSON(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(text));
  } catch (e) {
    return { entries: [], errors: [`JSON として読めません: ${(e as Error).message}`] };
  }
  return entriesFromData(data);
}

// ---- CSV ----

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(entries: readonly DictEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of sortEntries(entries)) {
    lines.push(CSV_COLUMNS.map((col) => csvCell(e[col])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

interface CsvRecord {
  /** ファイル上の開始行（1 始まり）。引用符内の改行や空行を飛ばした番号にはしない。 */
  line: number;
  cells: string[];
}

function isBlankRow(cells: readonly string[]): boolean {
  return !cells.some((cell) => cell.trim() !== '');
}

/** RFC 4180 形式（ダブルクォート・改行入りセル対応）の CSV を、空行を残した行の配列にする。 */
function parseCSVRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const src = stripBom(text);

  const pushRecord = () => {
    row.push(cell);
    records.push({ line: recordLine, cells: row });
    row = [];
    cell = '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
        if (ch === '\n' || ch === '\r') {
          // CRLF は 1 行として数える。セルの値からは LF を落とさない。
          line++;
          if (ch === '\r' && src[i + 1] === '\n') {
            cell += src[i + 1];
            i++;
          }
        }
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      pushRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    pushRecord();
  }
  return records;
}

/** RFC 4180 形式（ダブルクォート・改行入りセル対応）の CSV を行の配列にする。空行も残す。 */
export function parseCSVRows(text: string): string[][] {
  return parseCSVRecords(text).map((record) => record.cells);
}

export function fromCSV(text: string): ImportResult {
  const records = parseCSVRecords(text);
  const headerIndex = records.findIndex((record) => !isBlankRow(record.cells));
  const header = records[headerIndex]?.cells.map((h) => h.trim().toLowerCase());
  if (headerIndex < 0 || !header || !header.includes('tag') || !header.includes('category')) {
    return { entries: [], errors: ['1行目に tag と category を含む見出しが必要です'] };
  }
  return collect(
    records.slice(headerIndex + 1).flatMap((record) => {
      if (isBlankRow(record.cells)) return [];
      return [{
        raw: Object.fromEntries(header.map((h, j) => [h, record.cells[j] ?? ''])),
        where: `${record.line}行目`,
      }];
    }),
  );
}

export function parseImportFile(name: string, text: string): ImportResult {
  return /\.csv$/i.test(name) ? fromCSV(text) : fromJSON(text);
}

// ---- 取り込み ----

export type ImportMode = 'merge' | 'replace';

function entryKey(e: Pick<DictEntry, 'tag' | 'category'>): string {
  return `${e.category}\u0000${normalize(e.tag)}`;
}

/**
 * merge: id か「カテゴリ＋タグ」が一致するものは上書きし、それ以外は追加する。
 * replace: 取り込んだ内容だけにする（同じ「カテゴリ＋タグ」は後勝ち）。
 */
export function mergeEntries(
  existing: readonly DictEntry[],
  incoming: readonly DictEntry[],
  mode: ImportMode,
): DictEntry[] {
  const result = new Map<string, DictEntry>();
  const idToKey = new Map<string, string>();
  if (mode === 'merge') {
    for (const e of existing) {
      result.set(entryKey(e), e);
      idToKey.set(e.id, entryKey(e));
    }
  }
  for (const e of incoming) {
    const byId = idToKey.get(e.id);
    if (byId) {
      result.delete(byId);
      idToKey.delete(e.id);
    }
    const key = entryKey(e);
    const prev = result.get(key);
    const merged = prev ? { ...e, id: prev.id } : e;
    result.set(key, merged);
    idToKey.set(merged.id, key);
  }
  return sortEntries([...result.values()]);
}

export function findDuplicate(
  entries: readonly DictEntry[],
  candidate: Pick<DictEntry, 'id' | 'tag' | 'category'>,
): DictEntry | undefined {
  const key = entryKey(candidate);
  return entries.find((e) => e.id !== candidate.id && entryKey(e) === key);
}
