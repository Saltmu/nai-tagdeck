/** キャラ同士の動作に付ける接頭辞（V4 以降のキャラクタープロンプト）。 */
export const INTERACTIONS = [
  { value: 'source', label: 'する側' },
  { value: 'target', label: 'される側' },
  { value: 'mutual', label: 'お互い' },
] as const;

export type Interaction = (typeof INTERACTIONS)[number]['value'];

const PREFIX = /^\s*(source|target|mutual)\s*#\s*/i;

/** "source#hug" → { interaction: 'source', body: 'hug' }。接頭辞が無ければ interaction は null。 */
export function splitInteraction(text: string): { interaction: Interaction | null; body: string } {
  const m = PREFIX.exec(text);
  if (!m) return { interaction: null, body: text };
  return { interaction: m[1]!.toLowerCase() as Interaction, body: text.slice(m[0].length) };
}

/** タグに接頭辞を付ける。すでに別の接頭辞があれば付け替える。null なら何もしない。 */
export function withInteraction(tag: string, interaction: Interaction | null): string {
  if (!interaction) return tag;
  return `${interaction}#${splitInteraction(tag).body.trim()}`;
}
