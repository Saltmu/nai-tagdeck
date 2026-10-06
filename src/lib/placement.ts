export type Placement = 'below' | 'above';

export interface PlacementInput {
  /** 入力欄の上端・下端（ビューポート座標）。 */
  anchorTop: number;
  anchorBottom: number;
  /** 見えている範囲（ビューポート座標）。 */
  boundsTop: number;
  boundsBottom: number;
  /** 候補リストを全部出したときの高さ（上限で切った値）。 */
  desired: number;
  /** 入力欄とリストの間隔。 */
  gap: number;
}

/**
 * 候補リストを入力欄の下に出すか上に出すかを決める。
 * 下に収まるなら下、収まらず上のほうが広ければ上に出し、出す側の空きに合わせて高さを詰める。
 */
export function choosePlacement({ anchorTop, anchorBottom, boundsTop, boundsBottom, desired, gap }: PlacementInput): {
  placement: Placement;
  maxHeight: number;
} {
  const below = Math.max(0, boundsBottom - anchorBottom - gap);
  const above = Math.max(0, anchorTop - boundsTop - gap);
  const placement: Placement = below >= desired || below >= above ? 'below' : 'above';
  const space = placement === 'below' ? below : above;
  return { placement, maxHeight: Math.floor(Math.min(desired, space)) };
}
