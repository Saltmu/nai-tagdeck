/** 全角/半角・大小文字・カタカナ/ひらがな・アンダースコアの違いを吸収する。 */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tagWords(normalizedTag: string): string[] {
  return normalizedTag.split(/[ #]/).filter(Boolean);
}
