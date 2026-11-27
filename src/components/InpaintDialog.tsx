import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AnlasState } from '../hooks/useAnlas';
import type { Generator } from '../hooks/useGenerator';
import type { InpaintSession } from '../hooks/useInpaintSession';
import { estimateAnlasCost } from '../lib/anlasEstimate';
import type { GenerationSettings } from '../lib/generation';
import {
  activeMaskStrokes,
  canRedoMask,
  canUndoMask,
  createInpaintMaskBase64,
  INPAINT_BRUSH_MAX,
  INPAINT_BRUSH_MIN,
  INPAINT_BRUSH_STEP,
  INPAINT_MASK_COLORS,
  INPAINT_MASK_OPACITY_MAX,
  INPAINT_MASK_OPACITY_MIN,
  INPAINT_MASK_OPACITY_STEP,
  InpaintImageError,
  isMaskEmpty,
  maskColorHex,
  prepareInpaintBaseImageBase64,
  renderMaskOverlay,
  type InpaintMaskColorKey,
  type InpaintTool,
  type MaskStroke,
} from '../lib/inpaint';
import {
  INPAINT_STRENGTH_MAX,
  INPAINT_STRENGTH_MIN,
  INPAINT_STRENGTH_STEP,
  isFreeGeneration,
  type InpaintInput,
} from '../lib/novelai';
import { prefixFurryDataset, type buildCharacterPrompts } from '../lib/prompt';
import { AnlasLine } from './AnlasBalance';
import { useDialogs } from './Dialogs';
import { RedoIcon, UndoIcon } from './icons';

const INPAINT_HISTORY_STATE = 'naiTagdeckInpaint';
const isInpaintHistoryState = (state: unknown) =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[INPAINT_HISTORY_STATE] === true;

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;

interface ViewState {
  scale: number;
  x: number;
  y: number;
}

const FIT_VIEW: ViewState = { scale: 1, x: 0, y: 0 };

const TOOLS: ReadonlyArray<{ value: InpaintTool; label: string }> = [
  { value: 'brush', label: 'ブラシ' },
  { value: 'eraser', label: '消しゴム' },
  { value: 'pan', label: '移動・ズーム' },
];

function clampView(view: ViewState, stageW: number, stageH: number): ViewState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  if (stageW <= 0 || stageH <= 0 || scale <= 1) {
    return { scale, x: 0, y: 0 };
  }
  const maxX = ((scale - 1) * stageW) / 2;
  const maxY = ((scale - 1) * stageH) / 2;
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  };
}

export interface InpaintDialogProps {
  session: InpaintSession;
  token: string | null;
  basePrompt: string;
  characterPrompts: ReturnType<typeof buildCharacterPrompts>;
  negativePrompt: string;
  generation: GenerationSettings;
  generator: Generator;
  anlas: AnlasState;
  onClose: () => void;
  onEditTags: () => void;
  onDiscard: () => void;
  onPushStroke: (stroke: MaskStroke) => void;
  onUndoMask: () => void;
  onRedoMask: () => void;
  onClearMask: () => void;
  onStrengthChange: (strength: number) => void;
  onAddOriginalImageChange: (value: boolean) => void;
  onBrushRadiusChange: (radius: number) => void;
  onMaskColorChange: (color: InpaintMaskColorKey) => void;
  onMaskOpacityChange: (opacity: number) => void;
  onExecute: (input: InpaintInput) => Promise<boolean>;
}

export function InpaintDialog({
  session,
  token,
  basePrompt,
  characterPrompts,
  negativePrompt,
  generation,
  generator,
  anlas,
  onClose,
  onEditTags,
  onDiscard,
  onPushStroke,
  onUndoMask,
  onRedoMask,
  onClearMask,
  onStrengthChange,
  onAddOriginalImageChange,
  onBrushRadiusChange,
  onMaskColorChange,
  onMaskOpacityChange,
  onExecute,
}: InpaintDialogProps) {
  const dialogs = useDialogs();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  const [tool, setTool] = useState<InpaintTool>('brush');
  const [view, setView] = useState<ViewState>(FIT_VIEW);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const toolRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const colorRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const viewRef = useRef(view);
  viewRef.current = view;
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const generatingRef = useRef(generator.generating);
  generatingRef.current = generator.generating;
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const draftStrokeRef = useRef<MaskStroke | null>(null);
  const pinchCanceledRef = useRef(false);
  const activeHistoryRef = useRef(false);

  const committedStrokes = useMemo(() => activeMaskStrokes(session.maskHistory), [session.maskHistory]);
  const maskEmpty = useMemo(
    () => isMaskEmpty(committedStrokes, session.width, session.height),
    [committedStrokes, session.width, session.height],
  );
  const canUndo = canUndoMask(session.maskHistory);
  const canRedo = canRedoMask(session.maskHistory);

  const effectiveBasePrompt = useMemo(
    () => (generation.mode === 'furry' ? prefixFurryDataset(basePrompt) : basePrompt),
    [basePrompt, generation.mode],
  );
  const missingPrompt = !basePrompt && !(generation.mode === 'furry' && characterPrompts.length > 0);
  const executeBlocker = !token
    ? 'トークンが未設定です（設定タブで入力してください）'
    : missingPrompt
      ? 'ベースに ON のタグがありません'
      : maskEmpty
        ? '描き直す部分をマスクで塗ってください'
        : null;

  const inpaintEstimate = useMemo(
    () =>
      estimateAnlasCost({
        subscription: anlas.status === 'ready' ? anlas.subscription : null,
        baseIsFree: isFreeGeneration({ width: session.width, height: session.height, steps: generation.steps }),
        referenceCount: 0,
      }),
    [anlas.status, anlas.subscription, session.width, session.height, generation.steps],
  );

  const drawMaskPreview = useCallback(
    (draft: MaskStroke | null) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const s = sessionRef.current;
      const strokes = activeMaskStrokes(s.maskHistory);
      const list = draft ? [...strokes, draft] : strokes;
      renderMaskOverlay(ctx, list, s.width, s.height, maskColorHex(s.maskColor), s.maskOpacity);
    },
    [],
  );

  // マスク履歴・色・不透明度が変わったらキャンバスを再描画する
  useEffect(() => {
    drawMaskPreview(draftStrokeRef.current);
  }, [drawMaskPreview, session.maskHistory, session.maskColor, session.maskOpacity, session.width, session.height]);

  // モーダルを開く
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  // ブラウザの「戻る」ボタンではセッションを破棄せず一時保持して閉じる
  useEffect(() => {
    activeHistoryRef.current = true;
    if (!isInpaintHistoryState(window.history.state)) {
      window.history.pushState({ [INPAINT_HISTORY_STATE]: true }, '');
    }
    const onPopState = () => {
      if (!isInpaintHistoryState(window.history.state)) {
        onCloseRef.current();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      activeHistoryRef.current = false;
      window.removeEventListener('popstate', onPopState);
      queueMicrotask(() => {
        if (!activeHistoryRef.current && isInpaintHistoryState(window.history.state)) {
          window.history.back();
        }
      });
    };
  }, []);

  // ステージの描画サイズを監視して画像フィット寸法を計算する
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setStageSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      setView((prev) => clampView(prev, w, h));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoomAt = useCallback((nextScale: number, cx: number, cy: number) => {
    const el = stageRef.current;
    const w = el?.clientWidth ?? stageSizeRef.current.width;
    const h = el?.clientHeight ?? stageSizeRef.current.height;
    setView((prev) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const factor = scale / prev.scale;
      return clampView(
        {
          scale,
          x: cx - (cx - prev.x) * factor,
          y: cy - (cy - prev.y) * factor,
        },
        w,
        h,
      );
    });
  }, []);

  // ホイールによる拡大縮小
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      zoomAt(viewRef.current.scale * Math.exp(-e.deltaY * 0.0015), cx, cy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const toImagePoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * sessionRef.current.width,
      y: ((clientY - rect.top) / rect.height) * sessionRef.current.height,
    };
  };

  const stageCenterOffset = (clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 既に離されたポインタ等は無視
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2) {
      // 2 本指ピンチ時は進行中のストロークを破棄してズーム／パンへ切り替える
      if (draftStrokeRef.current) {
        draftStrokeRef.current = null;
        drawMaskPreview(null);
      }
      pinchCanceledRef.current = true;
      return;
    }

    pinchCanceledRef.current = false;
    const currentTool = toolRef.current;
    if (currentTool === 'pan' || generatingRef.current || submittingRef.current) return;

    const pt = toImagePoint(e.clientX, e.clientY);
    if (!pt) return;
    const draft: MaskStroke = {
      tool: currentTool,
      radius: sessionRef.current.brushRadius,
      points: [pt],
    };
    draftStrokeRef.current = draft;
    drawMaskPreview(draft);
  };

  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') {
      const el = stageRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }

    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointersRef.current.size === 1) {
      if (draftStrokeRef.current && !pinchCanceledRef.current) {
        const pt = toImagePoint(e.clientX, e.clientY);
        if (pt) {
          const pts = draftStrokeRef.current.points;
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 1) {
            const updated: MaskStroke = {
              ...draftStrokeRef.current,
              points: [...pts, pt],
            };
            draftStrokeRef.current = updated;
            drawMaskPreview(updated);
          }
        }
      } else if (toolRef.current === 'pan' && !pinchCanceledRef.current) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const w = stageRef.current?.clientWidth ?? stageSizeRef.current.width;
        const h = stageRef.current?.clientHeight ?? stageSizeRef.current.height;
        setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, w, h));
      }
    } else if (pointersRef.current.size === 2) {
      const otherEntry = [...pointersRef.current.entries()].find(([pid]) => pid !== e.pointerId);
      if (otherEntry) {
        const other = otherEntry[1];
        const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const nextDist = Math.hypot(next.x - other.x, next.y - other.y);
        const prevMidX = (prev.x + other.x) / 2;
        const prevMidY = (prev.y + other.y) / 2;
        const nextMidX = (next.x + other.x) / 2;
        const nextMidY = (next.y + other.y) / 2;
        const panDx = nextMidX - prevMidX;
        const panDy = nextMidY - prevMidY;
        const center = stageCenterOffset(nextMidX, nextMidY);
        const w = stageRef.current?.clientWidth ?? stageSizeRef.current.width;
        const h = stageRef.current?.clientHeight ?? stageSizeRef.current.height;
        setView((v) => {
          const scale =
            prevDist > 0 ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (nextDist / prevDist))) : v.scale;
          const factor = scale / v.scale;
          return clampView(
            {
              scale,
              x: center.x - (center.x - (v.x + panDx)) * factor,
              y: center.y - (center.y - (v.y + panDy)) * factor,
            },
            w,
            h,
          );
        });
      }
    }

    pointersRef.current.set(e.pointerId, next);
  };

  const onStagePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(e.pointerId)) return;
    if (draftStrokeRef.current) {
      const finished = draftStrokeRef.current;
      draftStrokeRef.current = null;
      if (e.type === 'pointerup' && !pinchCanceledRef.current) {
        onPushStroke(finished);
      } else {
        drawMaskPreview(null);
      }
    }
    if (pointersRef.current.size === 0) {
      pinchCanceledRef.current = false;
    }
  };

  const onToolKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = TOOLS.findIndex((t) => t.value === tool);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % TOOLS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + TOOLS.length) % TOOLS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TOOLS.length - 1;
    if (next === null) return;
    e.preventDefault();
    setTool(TOOLS[next]!.value);
    toolRefs.current[next]?.focus();
  };

  const onColorKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const idx = INPAINT_MASK_COLORS.findIndex((c) => c.key === session.maskColor);
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % INPAINT_MASK_COLORS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (idx - 1 + INPAINT_MASK_COLORS.length) % INPAINT_MASK_COLORS.length;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = INPAINT_MASK_COLORS.length - 1;
    if (next === null) return;
    e.preventDefault();
    onMaskColorChange(INPAINT_MASK_COLORS[next]!.key);
    colorRefs.current[next]?.focus();
  };

  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      if (canUndo && !generator.generating) {
        e.preventDefault();
        onUndoMask();
      }
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      if (canRedo && !generator.generating) {
        e.preventDefault();
        onRedoMask();
      }
    }
  };

  const handleDiscardClick = async () => {
    if (generator.generating || submitting) return;
    const ok = await dialogs.confirm(
      'インペイントの一時保持データ（ベース画像とマスク）を完全に破棄しますか？',
      { okLabel: '破棄', danger: true },
    );
    if (ok) onDiscard();
  };

  const handleExecute = async () => {
    if (executeBlocker !== null || generator.generating || submitting) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const imageBase64 = await prepareInpaintBaseImageBase64(session.sourceBlob, session.width, session.height);
      const maskBase64 = createInpaintMaskBase64(committedStrokes, session.width, session.height);
      const succeeded = await onExecute({
        imageBase64,
        maskBase64,
        width: session.width,
        height: session.height,
        strength: session.strength,
        addOriginalImage: session.addOriginalImage,
      });
      if (succeeded) {
        onClose();
      }
    } catch (err) {
      setLocalError(err instanceof InpaintImageError ? err.message : 'インペイント用の画像を準備できませんでした');
    } finally {
      setSubmitting(false);
    }
  };

  const fitScale =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width / session.width, stageSize.height / session.height)
      : 0;
  const wrapStyle: CSSProperties =
    fitScale > 0
      ? {
          width: `${session.width * fitScale}px`,
          height: `${session.height * fitScale}px`,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }
      : {
          aspectRatio: `${session.width} / ${session.height}`,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        };
  const cursorDiameter = fitScale > 0 ? Math.max(6, session.brushRadius * 2 * fitScale * view.scale) : 0;
  const activeError = localError ?? generator.error;

  return (
    <dialog
      ref={dialogRef}
      className="inpaint-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        // マスク描画中・生成中は Escape で閉じない。それ以外は破棄せず一時保持して閉じる。
        e.preventDefault();
        if (draftStrokeRef.current || generator.generating || submitting) return;
        onClose();
      }}
      onKeyDown={onDialogKeyDown}
    >
      <div className="inpaint-shell">
        <header className="inpaint-header">
          <div className="inpaint-header-info">
            <h2 id={`${id}-title`} className="inpaint-title">
              インペイント
            </h2>
            <span className="inpaint-meta" title={session.name}>
              {session.name} · {session.width}×{session.height}
            </span>
            {session.resized && (
              <span className="chip inpaint-resize-badge">
                {session.originalWidth}×{session.originalHeight} → {session.width}×{session.height} に調整
              </span>
            )}
          </div>
          <div className="inpaint-header-actions">
            <button type="button" className="btn btn-small" onClick={onClose}>
              一時保持して閉じる
            </button>
            <button
              type="button"
              className="btn btn-small btn-danger"
              disabled={generator.generating || submitting}
              onClick={() => void handleDiscardClick()}
            >
              破棄
            </button>
          </div>
        </header>

        <div className="inpaint-body">
          <div className="inpaint-workspace">
            <div className="inpaint-toolbar" role="toolbar" aria-label="マスク編集ツール">
              <div
                className="inpaint-tool-group"
                role="radiogroup"
                aria-label="描画ツール"
                onKeyDown={onToolKeyDown}
              >
                {TOOLS.map((item, idx) => {
                  const selected = tool === item.value;
                  return (
                    <button
                      key={item.value}
                      ref={(el) => {
                        toolRefs.current[idx] = el;
                      }}
                      type="button"
                      role="radio"
                      tabIndex={selected ? 0 : -1}
                      aria-checked={selected}
                      className="inpaint-tool-btn"
                      onClick={() => setTool(item.value)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="inpaint-slider-group">
                <label htmlFor={`${id}-brush-size`} className="inpaint-toolbar-label">
                  サイズ
                </label>
                <input
                  id={`${id}-brush-size`}
                  type="range"
                  min={INPAINT_BRUSH_MIN}
                  max={INPAINT_BRUSH_MAX}
                  step={INPAINT_BRUSH_STEP}
                  value={session.brushRadius}
                  onChange={(e) => onBrushRadiusChange(Number(e.target.value))}
                />
                <output htmlFor={`${id}-brush-size`} className="inpaint-toolbar-output">
                  {session.brushRadius * 2}px
                </output>
              </div>

              <div
                className="inpaint-color-group"
                role="radiogroup"
                aria-label="マスク表示色"
                onKeyDown={onColorKeyDown}
              >
                {INPAINT_MASK_COLORS.map((c, idx) => {
                  const selected = session.maskColor === c.key;
                  return (
                    <button
                      key={c.key}
                      ref={(el) => {
                        colorRefs.current[idx] = el;
                      }}
                      type="button"
                      role="radio"
                      tabIndex={selected ? 0 : -1}
                      aria-checked={selected}
                      aria-label={`マスク色: ${c.label}`}
                      title={`マスク色: ${c.label}`}
                      className="inpaint-color-btn"
                      onClick={() => onMaskColorChange(c.key)}
                    >
                      <span
                        className="inpaint-color-swatch"
                        style={{ backgroundColor: c.hex }}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>

              <div className="inpaint-slider-group">
                <label htmlFor={`${id}-mask-opacity`} className="inpaint-toolbar-label">
                  不透明度
                </label>
                <input
                  id={`${id}-mask-opacity`}
                  type="range"
                  min={INPAINT_MASK_OPACITY_MIN}
                  max={INPAINT_MASK_OPACITY_MAX}
                  step={INPAINT_MASK_OPACITY_STEP}
                  value={session.maskOpacity}
                  onChange={(e) => onMaskOpacityChange(Number(e.target.value))}
                />
                <output htmlFor={`${id}-mask-opacity`} className="inpaint-toolbar-output">
                  {Math.round(session.maskOpacity * 100)}%
                </output>
              </div>

              <div className="inpaint-history-group">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!canUndo || generator.generating}
                  aria-label="元に戻す"
                  title="元に戻す (Ctrl+Z)"
                  onClick={onUndoMask}
                >
                  <UndoIcon />
                  <span>元に戻す</span>
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!canRedo || generator.generating}
                  aria-label="やり直す"
                  title="やり直す (Ctrl+Y)"
                  onClick={onRedoMask}
                >
                  <RedoIcon />
                  <span>やり直す</span>
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={maskEmpty || generator.generating}
                  onClick={onClearMask}
                >
                  マスクを全消去
                </button>
              </div>

              <div className="inpaint-zoom-group" role="group" aria-label="拡大縮小">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={view.scale <= MIN_SCALE}
                  aria-label="縮小"
                  title="縮小"
                  onClick={() => zoomAt(view.scale / ZOOM_STEP, 0, 0)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn btn-small inpaint-zoom-reset"
                  aria-label="拡大率を 100% に戻す"
                  title="100% に戻す"
                  onClick={() => setView(FIT_VIEW)}
                >
                  {Math.round(view.scale * 100)}%
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={view.scale >= MAX_SCALE}
                  aria-label="拡大"
                  title="拡大"
                  onClick={() => zoomAt(view.scale * ZOOM_STEP, 0, 0)}
                >
                  +
                </button>
              </div>
            </div>

            <div
              ref={stageRef}
              className={`inpaint-stage${tool === 'pan' ? ' is-pan' : ''}`}
              onPointerDown={onStagePointerDown}
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
              onPointerLeave={() => setCursorPos(null)}
            >
              <div className="inpaint-canvas-wrap" style={wrapStyle}>
                <img
                  src={session.sourceUrl}
                  alt={`ベース画像: ${session.name}`}
                  className="inpaint-base-img"
                  draggable={false}
                />
                <canvas
                  ref={maskCanvasRef}
                  width={session.width}
                  height={session.height}
                  className="inpaint-mask-canvas"
                  aria-label="マスク描画キャンバス"
                />
              </div>
              {cursorPos && tool !== 'pan' && cursorDiameter > 0 && (
                <span
                  className={`inpaint-brush-cursor${tool === 'eraser' ? ' is-eraser' : ''}`}
                  aria-hidden="true"
                  style={{
                    width: `${cursorDiameter}px`,
                    height: `${cursorDiameter}px`,
                    transform: `translate(${cursorPos.x - cursorDiameter / 2}px, ${cursorPos.y - cursorDiameter / 2}px)`,
                  }}
                />
              )}
            </div>
          </div>

          <aside className="inpaint-side" aria-label="インペイント生成設定">
            {activeError && (
              <div className="gen-error" role="alert">
                <p>{activeError}</p>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="エラーを閉じる"
                  onClick={() => {
                    setLocalError(null);
                    generator.dismissError();
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor={`${id}-strength`}>
                強さ（{INPAINT_STRENGTH_MIN.toFixed(2)}〜{INPAINT_STRENGTH_MAX.toFixed(2)}）
              </label>
              <div className="fader-row">
                <input
                  id={`${id}-strength`}
                  type="range"
                  min={INPAINT_STRENGTH_MIN}
                  max={INPAINT_STRENGTH_MAX}
                  step={INPAINT_STRENGTH_STEP}
                  value={session.strength}
                  onChange={(e) => onStrengthChange(Number(e.target.value))}
                />
                <output htmlFor={`${id}-strength`}>{session.strength.toFixed(2)}</output>
              </div>
              <p className="hint inpaint-field-hint">
                値が大きいほどマスク内を強く描き直します（1.00 で全面描き直し）。
              </p>
            </div>

            <label className="check-line inpaint-check-line" htmlFor={`${id}-add-original`}>
              <input
                id={`${id}-add-original`}
                type="checkbox"
                checked={session.addOriginalImage}
                onChange={(e) => onAddOriginalImageChange(e.target.checked)}
              />
              <span>元画像を加える（add_original_image）</span>
            </label>

            <details className="inpaint-prompt-details">
              <summary>現在のプロンプトを確認</summary>
              <dl className="inpaint-prompt-list">
                <div>
                  <dt>ベース</dt>
                  <dd>{effectiveBasePrompt || '（なし）'}</dd>
                </div>
                {characterPrompts.map((ch, idx) => (
                  <div key={`${ch.name}-${idx}`}>
                    <dt>キャラ {idx + 1}: {ch.name}</dt>
                    <dd>{ch.prompt || '（なし）'}</dd>
                  </div>
                ))}
                <div>
                  <dt>ネガティブ</dt>
                  <dd>{negativePrompt || '（なし）'}</dd>
                </div>
              </dl>
            </details>

            <button type="button" className="btn btn-small inpaint-edit-tags-btn" onClick={onEditTags}>
              タグを編集（一時保存して閉じる）
            </button>

            <div className="inpaint-exec-footer">
              <AnlasLine anlas={anlas} estimate={inpaintEstimate} />
              {executeBlocker && (
                <p className="hint inpaint-blocker" role="status">
                  {executeBlocker}
                </p>
              )}
              <div className="inpaint-exec-actions">
                {generator.generating && (
                  <button type="button" className="btn" onClick={generator.cancel}>
                    中止
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-large"
                  disabled={executeBlocker !== null || generator.generating || submitting}
                  title={executeBlocker ?? undefined}
                  onClick={() => void handleExecute()}
                >
                  {generator.generating || submitting ? '生成中…' : 'インペイントを実行'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
