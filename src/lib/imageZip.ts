import { zipSync } from 'fflate';

/** PNG などは既に圧縮されているため、再圧縮せず格納する。 */
const STORE: 0 = 0;

export interface ImageZipFile {
  /** 個別ダウンロードと同じファイル名。重複するときだけ末尾に -2, -3 を付ける */
  name: string;
  data: Uint8Array;
}

function uniqueEntryName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** 渡した順で ZIP にする。先頭のファイル名は個別ダウンロード名のまま残す。 */
export function buildImageZip(files: readonly ImageZipFile[]): Uint8Array {
  const used = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[uniqueEntryName(file.name, used)] = file.data;
  }
  return zipSync(entries, { level: STORE });
}

export function imageZipBlob(files: readonly ImageZipFile[]): Blob {
  const zipped = buildImageZip(files);
  // fflate の戻り値は通常の ArrayBuffer 上の Uint8Array。型定義だけ共有バッファを含むため、コピーせずに渡す。
  const bytes = new Uint8Array(zipped.buffer, zipped.byteOffset, zipped.byteLength);
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}
