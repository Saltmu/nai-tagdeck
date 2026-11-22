import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { CharacterCenter } from '../types';
import { normalizeCenter } from '../lib/workspace';

export interface PeerCharacterCenter {
  id: string;
  name: string;
  /** 生成時に送信される座標。誰もが位置未指定（use_coords: false）のときは undefined。 */
  center?: CharacterCenter;
  /** 位置未指定のため他の座標指定キャラに合わせて中央 (0.5, 0.5) に自動配置されるか。 */
  autoCenter?: boolean;
}

interface Props {
  characterName: string;
  center: CharacterCenter;
  onChange: (center: CharacterCenter, mergeKey?: string) => void;
  /** 現在の出力画像サイズ。比率とラベルの表示に使う。 */
  canvasSize: { width: number; height: number };
  /** 他の ON キャラクターの位置一覧。 */
  peers?: readonly PeerCharacterCenter[];
}

const GRID_AXIS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
const GRID_COLS = ['A', 'B', 'C', 'D', 'E'] as const;
const GRID_SIZE = GRID_AXIS.length;
const GRID_TOTAL = GRID_SIZE * GRID_SIZE;
/** 中央 C3 (row=2, col=2) のインデックス。 */
const DEFAULT_GRID_INDEX = 12;
const KEY_STEP = 0.05;
const KEY_FINE_STEP = 0.01;
const DEFAULT_CENTER: CharacterCenter = { x: 0.5, y: 0.5 };
/** ステージの最大辺（px）。縦・横どちらの比率でもこの枠内に正確な縦横比で収める。 */
const STAGE_MAX_PX = 200;

function formatCoord(value: number): string {
  return value.toFixed(2);
}

/**
 * マーカーのラベルがキャンバスの左右端からはみ出さないよう、
 * 座標 x (0〜1) とステージ幅からラベルの最大幅と水平オフセットを算出する。
 */
function markerLabelStyle(x: number, stageWidthPx: number): CSSProperties {
  const maxWidth = Math.max(40, Math.min(104, stageWidthPx - 8));
  return {
    ['--marker-x' as string]: x,
    ['--label-max-width' as string]: `${maxWidth}px`,
  };
}

/**
 * キャラクター位置（center: 0〜1）を 2D キャンバス／5×5 グリッドで視覚的に指定するピッカー。
 * - キャンバス上のクリック／ドラッグで自由な座標（0〜1、小数第2位丸め）を指定できる。
 * - 矢印キー（0.05 刻み、Shift 併用で 0.01 刻み）や Home（中央 0.5, 0.5）でも操作できる。
 * - NovelAI 公式 UI の 5×5 グリッド（A1〜E5）ボタンで定番位置へ素早くスナップできる（roving tabIndex 対応）。
 * - 他の ON キャラクターの位置もマーカーおよび一覧で同時表示し、配置バランスや重なりを確認できる。
 */
export function CharacterCenterPicker({
  characterName,
  center,
  onChange,
  canvasSize,
  peers = [],
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dragging, setDragging] = useState(false);
  const [focusedCellIndex, setFocusedCellIndex] = useState<number | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const updateFromClientPoint = (clientX: number, clientY: number, mergeKey: string) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    const next = normalizeCenter({ x: rawX, y: rawY });
    if (next) onChangeRef.current(next, mergeKey);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // すでにドラッグ中の指がある間は、2本目の指の pointerdown を無視して最初のポインターの操作を維持する
    if (activePointerIdRef.current !== null) return;
    e.preventDefault();
    stageRef.current?.focus();
    const pointerId = e.pointerId;
    activePointerIdRef.current = pointerId;
    dragSeqRef.current += 1;
    const mergeKey = `drag-${dragSeqRef.current}`;
    setDragging(true);
    updateFromClientPoint(e.clientX, e.clientY, mergeKey);

    const cleanup = () => {
      dragCleanupRef.current = null;
      activePointerIdRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onBlur);
    };
    const stopDrag = () => {
      setDragging(false);
      cleanup();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // ウィンドウ外でマウスボタンを離したまま戻ってきた場合はドラッグを終了する
      if ((ev.pointerType === 'mouse' || !ev.pointerType) && typeof ev.buttons === 'number' && (ev.buttons & 1) === 0) {
        stopDrag();
        return;
      }
      updateFromClientPoint(ev.clientX, ev.clientY, mergeKey);
    };
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stopDrag();
    };
    const onBlur = () => {
      stopDrag();
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onBlur);
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
    if (next) onChange(next, 'key');
  };

  const selectedCellIndex = (() => {
    const colIdx = GRID_AXIS.findIndex((gx) => gx === center.x);
    const rowIdx = GRID_AXIS.findIndex((gy) => gy === center.y);
    return colIdx >= 0 && rowIdx >= 0 ? rowIdx * GRID_SIZE + colIdx : -1;
  })();

  const activeTabStopIndex =
    focusedCellIndex !== null
      ? focusedCellIndex
      : selectedCellIndex >= 0
        ? selectedCellIndex
        : DEFAULT_GRID_INDEX;

  const handleGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = activeTabStopIndex;
    const row = Math.floor(current / GRID_SIZE);
    const col = current % GRID_SIZE;
    let nextIndex: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
        nextIndex = (current + 1) % GRID_TOTAL;
        break;
      case 'ArrowLeft':
        nextIndex = (current - 1 + GRID_TOTAL) % GRID_TOTAL;
        break;
      case 'ArrowDown':
        nextIndex = ((row + 1) % GRID_SIZE) * GRID_SIZE + col;
        break;
      case 'ArrowUp':
        nextIndex = ((row - 1 + GRID_SIZE) % GRID_SIZE) * GRID_SIZE + col;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = GRID_TOTAL - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setFocusedCellIndex(nextIndex);
    cellRefs.current[nextIndex]?.focus();
  };

  const validSize = canvasSize.width > 0 && canvasSize.height > 0
    ? canvasSize
    : { width: 832, height: 1216 };
  const scale = STAGE_MAX_PX / Math.max(validSize.width, validSize.height);
  const stageWidthPx = Math.round(validSize.width * scale);
  const aspect = `${validSize.width} / ${validSize.height}`;

  const positionedPeers = peers.filter(
    (peer): peer is PeerCharacterCenter & { center: CharacterCenter } => peer.center !== undefined,
  );
  const activeNearBottom = center.y > 0.78;

  return (
    <div className="center-picker">
      <div className="center-picker-main">
        <div className="center-stage-wrap">
          <div
            ref={stageRef}
            className={`center-stage${dragging ? ' is-dragging' : ''}`}
            style={{ aspectRatio: aspect, maxWidth: `${stageWidthPx}px` }}
            tabIndex={0}
            role="group"
            data-undo-merge=""
            aria-label={`${characterName} の位置ピッカー（現在 横 ${formatCoord(center.x)}, 縦 ${formatCoord(center.y)}。クリック・ドラッグまたは矢印キーで移動、Shift+矢印で0.01刻み、Homeで中央）`}
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
          >
            <div className="center-stage-grid" aria-hidden="true" />
            {positionedPeers.map((peer) => {
              const pos = peer.center;
              const isAuto = peer.autoCenter === true;
              const nearBottom = pos.y > 0.78;
              return (
                <div
                  key={peer.id}
                  className={`center-marker center-marker-peer${isAuto ? ' is-auto' : ''}${nearBottom ? ' is-above' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  title={`${peer.name}: (${formatCoord(pos.x)}, ${formatCoord(pos.y)})${isAuto ? '（未指定・中央）' : ''}`}
                >
                  <span className="center-marker-dot" aria-hidden="true" />
                  <span className="center-marker-label" style={markerLabelStyle(pos.x, stageWidthPx)}>
                    {peer.name}
                  </span>
                </div>
              );
            })}
            <div
              className={`center-marker center-marker-active${activeNearBottom ? ' is-above' : ''}`}
              style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
              title={`${characterName}: (${formatCoord(center.x)}, ${formatCoord(center.y)})`}
            >
              <span className="center-marker-dot" aria-hidden="true" />
              <span className="center-marker-label" style={markerLabelStyle(center.x, stageWidthPx)}>
                {characterName}
              </span>
            </div>
          </div>
          <span className="center-stage-caption">
            キャンバス比率 {validSize.width}×{validSize.height}
          </span>
        </div>

        <div className="center-preset-wrap">
          <span className="center-preset-title">5×5 グリッド（A1〜E5）</span>
          <div
            className="center-preset-grid"
            role="group"
            aria-label={`${characterName} の 5×5 グリッド位置選択`}
            onKeyDown={handleGridKeyDown}
          >
            {GRID_AXIS.map((gy, rowIdx) =>
              GRID_AXIS.map((gx, colIdx) => {
                const cellIndex = rowIdx * GRID_SIZE + colIdx;
                const cellName = `${GRID_COLS[colIdx]}${rowIdx + 1}`;
                const selected = center.x === gx && center.y === gy;
                return (
                  <button
                    key={cellName}
                    ref={(el) => {
                      cellRefs.current[cellIndex] = el;
                    }}
                    type="button"
                    tabIndex={cellIndex === activeTabStopIndex ? 0 : -1}
                    className={`center-preset-cell${selected ? ' is-selected' : ''}`}
                    aria-label={`グリッド ${cellName}（横 ${gx}, 縦 ${gy}）`}
                    aria-pressed={selected}
                    title={`${cellName} (${gx}, ${gy})`}
                    onFocus={() => setFocusedCellIndex(cellIndex)}
                    onBlur={() => setFocusedCellIndex((prev) => (prev === cellIndex ? null : prev))}
                    onClick={() => {
                      setFocusedCellIndex(cellIndex);
                      onChange({ x: gx, y: gy });
                    }}
                  >
                    {cellName}
                  </button>
                );
              }),
            )}
          </div>
        </div>
      </div>

      <ul className="center-legend" aria-label="キャラクター位置一覧">
        <li className="center-legend-item is-active">
          <span className="center-legend-dot" aria-hidden="true" />
          <span className="center-legend-name">{characterName}</span>
          <span className="center-legend-coord">
            ({formatCoord(center.x)}, {formatCoord(center.y)})
          </span>
        </li>
        {peers.map((peer) => {
          const isAuto = peer.autoCenter === true;
          const isUnpositioned = peer.center === undefined;
          return (
            <li
              key={peer.id}
              className={`center-legend-item${isAuto ? ' is-auto' : ''}${isUnpositioned ? ' is-unpositioned' : ''}`}
            >
              <span className="center-legend-dot" aria-hidden="true" />
              <span className="center-legend-name">{peer.name}</span>
              <span className="center-legend-coord">
                {peer.center
                  ? `(${formatCoord(peer.center.x)}, ${formatCoord(peer.center.y)})${isAuto ? ' 中央自動' : ''}`
                  : '位置指定なし'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
