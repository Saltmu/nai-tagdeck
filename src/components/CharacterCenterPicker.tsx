import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { CharacterCenter } from '../types';
import { normalizeCenter } from '../lib/workspace';

export interface PeerCharacterCenter {
  id: string;
  name: string;
  /** 未指定の場合は中央 (0.5, 0.5) に自動配置されるものとして表示する。 */
  center?: CharacterCenter;
}

interface Props {
  characterName: string;
  center: CharacterCenter;
  onChange: (center: CharacterCenter) => void;
  /** 現在の出力画像サイズ。比率とラベルの表示に使う。 */
  canvasSize: { width: number; height: number };
  /** 他の ON キャラクターの位置一覧。 */
  peers?: readonly PeerCharacterCenter[];
}

const GRID_AXIS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
const GRID_COLS = ['A', 'B', 'C', 'D', 'E'] as const;
const KEY_STEP = 0.05;
const KEY_FINE_STEP = 0.01;
const DEFAULT_CENTER: CharacterCenter = { x: 0.5, y: 0.5 };

function formatCoord(value: number): string {
  return value.toFixed(2);
}

/**
 * キャラクター位置（center: 0〜1）を 2D キャンバス／5×5 グリッドで視覚的に指定するピッカー。
 * - キャンバス上のクリック／ドラッグで自由な座標（0〜1、小数第2位丸め）を指定できる。
 * - 矢印キー（0.05 刻み、Shift 併用で 0.01 刻み）や Home（中央 0.5, 0.5）でも操作できる。
 * - NovelAI 公式 UI の 5×5 グリッド（A1〜E5）ボタンで定番位置へ素早くスナップできる。
 * - 他の ON キャラクターの位置もラベル付きで同時表示し、配置バランスや重なりを確認できる。
 */
export function CharacterCenterPicker({
  characterName,
  center,
  onChange,
  canvasSize,
  peers = [],
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    const next = normalizeCenter({ x: rawX, y: rawY });
    if (next) onChangeRef.current(next);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragCleanupRef.current?.();
    stageRef.current?.focus();
    setDragging(true);
    updateFromClientPoint(e.clientX, e.clientY);

    const onMove = (ev: PointerEvent) => {
      updateFromClientPoint(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      dragCleanupRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    const onEnd = () => {
      setDragging(false);
      cleanup();
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_FINE_STEP : KEY_STEP;
    let next: CharacterCenter | undefined;
    switch (e.key) {
      case 'ArrowLeft':
        next = normalizeCenter({ x: center.x - step, y: center.y });
        break;
      case 'ArrowRight':
        next = normalizeCenter({ x: center.x + step, y: center.y });
        break;
      case 'ArrowUp':
        next = normalizeCenter({ x: center.x, y: center.y - step });
        break;
      case 'ArrowDown':
        next = normalizeCenter({ x: center.x, y: center.y + step });
        break;
      case 'Home':
        next = DEFAULT_CENTER;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) onChange(next);
  };

  const aspect = canvasSize.width > 0 && canvasSize.height > 0
    ? `${canvasSize.width} / ${canvasSize.height}`
    : '832 / 1216';

  return (
    <div className="center-picker">
      <div className="center-picker-main">
        <div className="center-stage-wrap">
          <div
            ref={stageRef}
            className={`center-stage${dragging ? ' is-dragging' : ''}`}
            style={{ aspectRatio: aspect }}
            tabIndex={0}
            role="group"
            data-undo-merge=""
            aria-label={`${characterName} の位置ピッカー（現在 横 ${formatCoord(center.x)}, 縦 ${formatCoord(center.y)}。クリック・ドラッグまたは矢印キーで移動、Shift+矢印で0.01刻み、Homeで中央）`}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          >
            <div className="center-stage-grid" aria-hidden="true" />
            {peers.map((peer) => {
              const pos = peer.center ?? DEFAULT_CENTER;
              const isAuto = peer.center === undefined;
              return (
                <div
                  key={peer.id}
                  className={`center-marker center-marker-peer${isAuto ? ' is-auto' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  title={`${peer.name}: (${formatCoord(pos.x)}, ${formatCoord(pos.y)})${isAuto ? '（未指定・中央）' : ''}`}
                >
                  <span className="center-marker-dot" aria-hidden="true" />
                  <span className="center-marker-label">{peer.name}</span>
                </div>
              );
            })}
            <div
              className="center-marker center-marker-active"
              style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
              title={`${characterName}: (${formatCoord(center.x)}, ${formatCoord(center.y)})`}
            >
              <span className="center-marker-dot" aria-hidden="true" />
              <span className="center-marker-label">{characterName}</span>
            </div>
          </div>
          <span className="center-stage-caption">
            キャンバス比率 {canvasSize.width}×{canvasSize.height}
          </span>
        </div>

        <div className="center-preset-wrap">
          <span className="center-preset-title">5×5 グリッド（A1〜E5）</span>
          <div className="center-preset-grid" role="group" aria-label={`${characterName} の 5×5 グリッド位置選択`}>
            {GRID_AXIS.map((gy, rowIdx) =>
              GRID_AXIS.map((gx, colIdx) => {
                const cellName = `${GRID_COLS[colIdx]}${rowIdx + 1}`;
                const selected = center.x === gx && center.y === gy;
                return (
                  <button
                    key={cellName}
                    type="button"
                    className={`center-preset-cell${selected ? ' is-selected' : ''}`}
                    aria-label={`グリッド ${cellName}（横 ${gx}, 縦 ${gy}）`}
                    aria-pressed={selected}
                    title={`${cellName} (${gx}, ${gy})`}
                    onClick={() => onChange({ x: gx, y: gy })}
                  >
                    {cellName}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
