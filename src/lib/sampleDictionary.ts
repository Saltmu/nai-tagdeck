import type { CategoryKey, DictEntry } from '../types';
import { newId } from './id';

// 動作確認用の最小限のサンプル。辞書が空のときだけ読み込みを提案する。
const SAMPLE: Array<[CategoryKey, string, string, number?]> = [
  ['quality', 'masterpiece', '傑作 けっさく'],
  ['quality', 'best quality', '最高品質 さいこうひんしつ'],
  ['quality', 'very aesthetic', '美的 びてき'],
  ['quality', 'absurdres', '高解像度 こうかいぞうど'],
  ['subject', '1girl', '女の子1人 おんなのこ ひとり'],
  ['subject', '1boy', '男の子1人 おとこのこ ひとり'],
  ['subject', 'solo', 'ソロ 一人 ひとり'],
  ['subject', '2girls', '女の子2人 おんなのこ ふたり'],
  ['appearance', 'long hair', 'ロングヘア 長髪 ちょうはつ'],
  ['appearance', 'short hair', 'ショートヘア 短髪 たんぱつ'],
  ['appearance', 'blonde hair', '金髪 きんぱつ'],
  ['appearance', 'black hair', '黒髪 くろかみ'],
  ['appearance', 'blue eyes', '青い目 あおいめ'],
  ['appearance', 'smile', '笑顔 えがお'],
  ['outfit', 'school uniform', '制服 せいふく'],
  ['outfit', 'dress', 'ドレス'],
  ['outfit', 'hoodie', 'パーカー'],
  ['outfit', 'maid', 'メイド'],
  ['dress_state', 'open jacket', '前開き まえあき'],
  ['dress_state', 'sleeves rolled up', '腕まくり うでまくり'],
  ['dress_state', 'barefoot', '裸足 はだし'],
  ['pose', 'standing', '立ち たち'],
  ['pose', 'sitting', '座り すわり'],
  ['pose', 'arms up', '腕を上げる うであげ'],
  ['pose', 'looking at viewer', 'カメラ目線 めせん'],
  ['effect', 'lens flare', 'レンズフレア'],
  ['effect', 'depth of field', '被写界深度 ひしゃかいしんど'],
  ['effect', 'sparkle', 'キラキラ'],
  ['composition', 'upper body', '上半身 じょうはんしん'],
  ['composition', 'full body', '全身 ぜんしん'],
  ['composition', 'from above', '俯瞰 ふかん'],
  ['composition', 'cowboy shot', '膝上 ひざうえ'],
];

export function sampleDictionary(): DictEntry[] {
  const now = new Date().toISOString();
  return SAMPLE.map(([category, tag, alias, weight], i) => ({
    id: newId(),
    tag,
    category,
    alias,
    default_weight: weight ?? 1,
    sort_order: i,
    updated_at: now,
  }));
}
