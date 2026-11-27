import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearMaskHistory,
  DEFAULT_INPAINT_ADD_ORIGINAL_IMAGE,
  DEFAULT_INPAINT_BRUSH_RADIUS,
  DEFAULT_INPAINT_MASK_OPACITY,
  emptyMaskHistory,
  InpaintImageError,
  isMaskEmpty,
  normalizeBrushRadius,
  normalizeInpaintStrength,
  normalizeMaskOpacity,
  prepareInpaintSource,
  pushMaskStroke,
  redoMask as redoMaskHistory,
  undoMask as undoMaskHistory,
  type InpaintMaskColorKey,
  type MaskHistoryState,
  type MaskStroke,
} from '../lib/inpaint';
import { DEFAULT_INPAINT_STRENGTH } from '../lib/novelai';

export interface InpaintSession {
  /** 履歴から独立したベース画像 Blob。 */
  sourceBlob: Blob;
  /** このセッション専用の Object URL。差し替え・破棄・アンマウント時に必ず revoke する。 */
  sourceUrl: string;
  /** 正規化後の幅・高さ（64 の倍数・無料枠内）。 */
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
  /** 表示用ファイル名または由来ラベル。 */
  name: string;
  /** マスク描画履歴（ストローク列＋Undo/Redo 位置）。 */
  maskHistory: MaskHistoryState;
  /** インペイント強度（0.01〜1.0）。 */
  strength: number;
  /** `add_original_image` の送信値（既定 false）。 */
  addOriginalImage: boolean;
  /** ブラシ設定（画像座標系半径 px・マスク表示色・不透明度）。 */
  brushRadius: number;
  maskColor: InpaintMaskColorKey;
  maskOpacity: number;
  /** 確定済みで通常の「生成する」ボタンからインペイント実行する状態か（一時 OFF で通常生成へ切替可）。 */
  enabled: boolean;
}

export interface InpaintSessionStore {
  session: InpaintSession | null;
  /** 確定済みかつマスクが 1 箇所以上塗られており、通常の「生成する」ボタンでインペイント実行されるセッション。 */
  activeSession: InpaintSession | null;
  open: boolean;
  loading: boolean;
  error: string | null;
  startFromBlob: (
    blob: Blob,
    name: string,
    fallbackSize?: { width: number; height: number },
  ) => Promise<boolean>;
  startFromFile: (file: File) => Promise<boolean>;
  resume: () => void;
  /** マスクを確定し、有効状態でモーダルを閉じる。空マスクのときは何もしない。 */
  confirm: () => boolean;
  /** セッションを保持したままモーダルを閉じる（空マスクなら enabled を false に落とす）。 */
  close: () => void;
  /** セッションを保持したままインペイントの ON / 一時 OFF を切り替える。 */
  setEnabled: (enabled: boolean) => void;
  discard: () => void;
  pushStroke: (stroke: MaskStroke) => void;
  undoMask: () => void;
  redoMask: () => void;
  clearMask: () => void;
  setStrength: (strength: number) => void;
  setAddOriginalImage: (value: boolean) => void;
  setBrushRadius: (radius: number) => void;
  setMaskColor: (color: InpaintMaskColorKey) => void;
  setMaskOpacity: (opacity: number) => void;
  dismissError: () => void;
}

/**
 * インペイント用の一時保持セッション（メモリのみ、永続化・タブ同期・バックアップ対象外）。
 * モーダルでマスクを確定して閉じると、通常の「生成する」ボタンからインペイント生成できる。
 */
export function useInpaintSession(): InpaintSessionStore {
  const [session, setSession] = useState<InpaintSession | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<InpaintSession | null>(null);
  const mountedRef = useRef(true);
  const epochRef = useRef(0);
  const inFlightCountRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      if (sessionRef.current) {
        URL.revokeObjectURL(sessionRef.current.sourceUrl);
        sessionRef.current = null;
      }
    };
  }, []);

  const beginLoading = useCallback(() => {
    inFlightCountRef.current += 1;
    setLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
    if (mountedRef.current) {
      setLoading(inFlightCountRef.current > 0);
    }
  }, []);

  const startFromBlob = useCallback(
    async (
      blob: Blob,
      name: string,
      fallbackSize?: { width: number; height: number },
    ): Promise<boolean> => {
      const startEpoch = ++epochRef.current;
      beginLoading();
      setError(null);
      try {
        const prepared = await prepareInpaintSource(blob, fallbackSize);
        if (!mountedRef.current || startEpoch !== epochRef.current) return false;
        const sourceUrl = URL.createObjectURL(prepared.blob);
        const prev = sessionRef.current;
        const next: InpaintSession = {
          sourceBlob: prepared.blob,
          sourceUrl,
          width: prepared.width,
          height: prepared.height,
          originalWidth: prepared.originalWidth,
          originalHeight: prepared.originalHeight,
          resized: prepared.resized,
          name: name.trim() || 'インペイント画像',
          maskHistory: emptyMaskHistory(),
          strength: DEFAULT_INPAINT_STRENGTH,
          addOriginalImage: DEFAULT_INPAINT_ADD_ORIGINAL_IMAGE,
          brushRadius: prev?.brushRadius ?? DEFAULT_INPAINT_BRUSH_RADIUS,
          maskColor: prev?.maskColor ?? 'red',
          maskOpacity: prev?.maskOpacity ?? DEFAULT_INPAINT_MASK_OPACITY,
          enabled: false,
        };
        sessionRef.current = next;
        setSession(next);
        setOpen(true);
        if (prev) {
          URL.revokeObjectURL(prev.sourceUrl);
        }
        return true;
      } catch (err) {
        if (!mountedRef.current || startEpoch !== epochRef.current) return false;
        const message =
          err instanceof InpaintImageError ? err.message : 'インペイント用の画像を読み込めませんでした';
        setError(message);
        return false;
      } finally {
        endLoading();
      }
    },
    [beginLoading, endLoading],
  );

  const startFromFile = useCallback(
    (file: File): Promise<boolean> => startFromBlob(file, file.name || 'インペイント画像'),
    [startFromBlob],
  );

  const resume = useCallback(() => {
    if (!sessionRef.current) return;
    setError(null);
    setOpen(true);
  }, []);

  const updateSession = useCallback((updater: (current: InpaintSession) => InpaintSession) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    sessionRef.current = next;
    setSession(next);
  }, []);

  const confirm = useCallback((): boolean => {
    const current = sessionRef.current;
    if (!current) return false;
    if (isMaskEmpty(current.maskHistory, current.width, current.height)) return false;
    if (!current.enabled) {
      const next = { ...current, enabled: true };
      sessionRef.current = next;
      setSession(next);
    }
    setOpen(false);
    return true;
  }, []);

  const close = useCallback(() => {
    const current = sessionRef.current;
    if (current?.enabled && isMaskEmpty(current.maskHistory, current.width, current.height)) {
      const next = { ...current, enabled: false };
      sessionRef.current = next;
      setSession(next);
    }
    setOpen(false);
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      updateSession((current) => {
        if (enabled && isMaskEmpty(current.maskHistory, current.width, current.height)) {
          return current;
        }
        return current.enabled === enabled ? current : { ...current, enabled };
      });
    },
    [updateSession],
  );

  const discard = useCallback(() => {
    epochRef.current += 1;
    setOpen(false);
    setError(null);
    const prev = sessionRef.current;
    if (!prev) return;
    sessionRef.current = null;
    setSession(null);
    URL.revokeObjectURL(prev.sourceUrl);
  }, []);

  const pushStroke = useCallback(
    (stroke: MaskStroke) => {
      updateSession((current) => {
        const maskHistory = pushMaskStroke(current.maskHistory, stroke);
        return maskHistory === current.maskHistory ? current : { ...current, maskHistory };
      });
    },
    [updateSession],
  );

  const undoMask = useCallback(() => {
    updateSession((current) => {
      const maskHistory = undoMaskHistory(current.maskHistory);
      return maskHistory === current.maskHistory ? current : { ...current, maskHistory };
    });
  }, [updateSession]);

  const redoMask = useCallback(() => {
    updateSession((current) => {
      const maskHistory = redoMaskHistory(current.maskHistory);
      return maskHistory === current.maskHistory ? current : { ...current, maskHistory };
    });
  }, [updateSession]);

  const clearMask = useCallback(() => {
    updateSession((current) => {
      const maskHistory = clearMaskHistory(current.maskHistory);
      return maskHistory === current.maskHistory ? current : { ...current, maskHistory };
    });
  }, [updateSession]);

  const setStrength = useCallback(
    (strength: number) => {
      const normalized = normalizeInpaintStrength(strength);
      updateSession((current) => (current.strength === normalized ? current : { ...current, strength: normalized }));
    },
    [updateSession],
  );

  const setAddOriginalImage = useCallback(
    (value: boolean) => {
      updateSession((current) => (current.addOriginalImage === value ? current : { ...current, addOriginalImage: value }));
    },
    [updateSession],
  );

  const setBrushRadius = useCallback(
    (radius: number) => {
      const normalized = normalizeBrushRadius(radius);
      updateSession((current) => (current.brushRadius === normalized ? current : { ...current, brushRadius: normalized }));
    },
    [updateSession],
  );

  const setMaskColor = useCallback(
    (color: InpaintMaskColorKey) => {
      updateSession((current) => (current.maskColor === color ? current : { ...current, maskColor: color }));
    },
    [updateSession],
  );

  const setMaskOpacity = useCallback(
    (opacity: number) => {
      const normalized = normalizeMaskOpacity(opacity);
      updateSession((current) => (current.maskOpacity === normalized ? current : { ...current, maskOpacity: normalized }));
    },
    [updateSession],
  );

  const dismissError = useCallback(() => setError(null), []);

  const activeSession = useMemo(() => {
    if (!session?.enabled) return null;
    return isMaskEmpty(session.maskHistory, session.width, session.height) ? null : session;
  }, [session]);

  return {
    session,
    activeSession,
    open,
    loading,
    error,
    startFromBlob,
    startFromFile,
    resume,
    confirm,
    close,
    setEnabled,
    discard,
    pushStroke,
    undoMask,
    redoMask,
    clearMask,
    setStrength,
    setAddOriginalImage,
    setBrushRadius,
    setMaskColor,
    setMaskOpacity,
    dismissError,
  };
}
