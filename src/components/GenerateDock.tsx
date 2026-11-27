import { type ComponentProps, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { copyText } from '../lib/browser';
import { HistoryControls } from './HistoryControls';
import { CheckIcon, ChevronUpIcon, CopyIcon } from './icons';

export type DockTab = 'prompt' | 'generate' | 'reference';

export interface DockTabSignal {
  tab: DockTab;
  seq: number;
}

interface Props {
  /** 値が変わるたびにドックを閉じる（画像エリアのクリック用）。 */
  collapseSignal: number;
  /** seq が変わるたびに指定タブへ切り替えてドックを開く（ギャラリー等の導線用）。 */
  openTabSignal?: DockTabSignal;
  /** 精密参照が ON（有効かつ画像あり）のとき true。 */
  referenceActive?: boolean;
  /** 有効な精密参照の枚数。 */
  referenceCount?: number;
  /** ワークスペース共通の操作履歴（Undo / Redo）。 */
  history?: ComponentProps<typeof HistoryControls>;
  error: string | null;
  onDismissError: () => void;
  promptPanel: ReactNode;
  generatePanel: ReactNode;
  referencePanel?: ReactNode;
}

/**
 * 画像の下に浮かべる「プロンプト / 生成 / 参照画像」のドック。
 * 閉じた状態ではタブのバーだけを見せ、画像を広く使う。スマホでは編集・生成タブ共通で下からせり上がるシートになり、PC では画像一覧の下に固定される。
 */
export function GenerateDock({
  collapseSignal,
  openTabSignal,
  referenceActive = false,
  referenceCount,
  history,
  error,
  onDismissError,
  promptPanel,
  generatePanel,
  referencePanel,
}: Props) {
  const id = useId();
  const dockRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<DockTab, HTMLButtonElement | null>>({
    prompt: null,
    generate: null,
    reference: null,
  });
  const [tab, setTab] = useState<DockTab>('prompt');
  const [open, setOpen] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const latestErrorRef = useRef(error);
  latestErrorRef.current = error;
  const activeReferenceCount = referenceCount ?? (referenceActive ? 1 : 0);

  useEffect(() => {
    setErrorCopied(false);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [error]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      swallowCleanupRef.current?.();
      swallowCleanupRef.current = null;
    };
  }, []);

  const copyError = async () => {
    const targetError = error;
    if (!targetError) return;
    const ok = await copyText(targetError);
    if (!ok || !mountedRef.current || latestErrorRef.current !== targetError) return;
    setErrorCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setErrorCopied(false);
      copyTimerRef.current = null;
    }, 1500);
  };

  // 狭い画面ではドックが下端に固定される。全体の高さは通知の持ち上げに、バーの高さは編集・生成ペインの下余白に使う。
  useEffect(() => {
    const el = dockRef.current;
    const barEl = barRef.current;
    if (!el) return;
    const media = window.matchMedia?.('(max-width: 1099px)');
    const publish = () => {
      const isNarrow = !!media?.matches;
      const height = isNarrow ? Math.ceil(el.getBoundingClientRect().height) : 0;
      const barHeight = isNarrow && barEl ? Math.ceil(barEl.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--dock-offset', `${height}px`);
      document.documentElement.style.setProperty('--dock-bar-height', `${barHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    if (barEl) observer.observe(barEl);
    media?.addEventListener('change', publish);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', publish);
      document.documentElement.style.removeProperty('--dock-offset');
      document.documentElement.style.removeProperty('--dock-bar-height');
    };
  }, [open, error]);

  const [seenSignal, setSeenSignal] = useState(collapseSignal);
  if (seenSignal !== collapseSignal) {
    setSeenSignal(collapseSignal);
    setOpen(false);
  }
  const [seenOpenSeq, setSeenOpenSeq] = useState(openTabSignal?.seq ?? 0);
  if (openTabSignal && seenOpenSeq !== openTabSignal.seq) {
    setSeenOpenSeq(openTabSignal.seq);
    setTab(openTabSignal.tab);
    setOpen(true);
  }

  // ドックを開いているとき、ドック外の画面上部などをタップしたらドックを閉じるだけにし、
  // 裏にある要素のイベント（クリック・フォーカス等）を起動させない。
  useEffect(() => {
    if (!open) return;
    const onOutsidePointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (dockRef.current?.contains(target)) return;
      if (target.closest('.generate-bar, .viewer, .inpaint-dialog, .app-dialog, .thumb-menu-wrap')) return;
      e.preventDefault();
      e.stopPropagation();
      swallowCleanupRef.current?.();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        document.removeEventListener('click', swallowClick, true);
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (swallowCleanupRef.current === cleanup) swallowCleanupRef.current = null;
      };
      const swallowClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
      };
      document.addEventListener('click', swallowClick, true);
      timer = setTimeout(cleanup, 400);
      swallowCleanupRef.current = cleanup;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    };
  }, [open]);

  const dragStart = useRef<number | null>(null);

  // バーの空いた所のタップ・上スワイプで開き、下スワイプで閉じる
  const onBarPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
  };
  const onBarPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    if (dy < -24) setOpen(true);
    else if (dy > 24) setOpen(false);
    else if (Math.abs(dy) < 8 && !open && !(e.target as Element).closest('button')) setOpen(true);
  };

  const select = (next: DockTab) => {
    if (next === tab) setOpen((value) => !value);
    else {
      setTab(next);
      setOpen(true);
    }
  };

  const tabs: Array<{ key: DockTab; label: string }> = [
    { key: 'prompt', label: 'プロンプト' },
    { key: 'generate', label: '生成' },
    { key: 'reference', label: '参照画像' },
  ];

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.key === tab);
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextKey = tabs[nextIndex]!.key;
    setTab(nextKey);
    setOpen(true);
    tabRefs.current[nextKey]?.focus();
  };

  return (
    <section ref={dockRef} className={`dock${open ? ' is-open' : ''}`} aria-label="プロンプト・生成設定・参照画像">
      {/* 閉じていてもエラーは見えるようにする */}
      {error && (
        <div className="gen-error" role="alert">
          <p>{error}</p>
          <div className="gen-error-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={errorCopied ? 'エラーをコピー済み' : 'エラーをコピー'}
              title={errorCopied ? 'コピー済み' : 'エラーをコピー'}
              onClick={() => void copyError()}
            >
              {errorCopied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button type="button" className="icon-btn" aria-label="エラーを閉じる" onClick={onDismissError}>
              ✕
            </button>
          </div>
        </div>
      )}
      <div
        ref={barRef}
        className="dock-bar"
        onPointerDown={onBarPointerDown}
        onPointerUp={onBarPointerUp}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        <div className="dock-tabs" role="tablist" aria-label="ドックの切り替え" onKeyDown={onTabKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => { tabRefs.current[t.key] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              aria-selected={open && tab === t.key}
              aria-controls={`${id}-panel-${t.key}`}
              className="dock-tab"
              onClick={() => select(t.key)}
            >
              {t.label}
              {t.key === 'reference' && activeReferenceCount > 0 && (
                <>
                  <span className="dock-tab-badge" aria-hidden="true">{activeReferenceCount}</span>
                  <span className="visually-hidden">（精密参照 {activeReferenceCount}枚 ON）</span>
                </>
              )}
            </button>
          ))}
        </div>
        {history && <HistoryControls {...history} />}
        <button
          type="button"
          className="icon-btn dock-toggle"
          aria-expanded={open}
          aria-label={open ? 'パネルを閉じる' : 'パネルを開く'}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronUpIcon />
        </button>
      </div>
      <div className="dock-body" inert={!open}>
        <div className="dock-clip">
          <div className="dock-scroll">
            {tabs.map((t) => (
              <div
                key={t.key}
                role="tabpanel"
                id={`${id}-panel-${t.key}`}
                aria-labelledby={`${id}-tab-${t.key}`}
                hidden={tab !== t.key}
              >
                {t.key === 'prompt' ? promptPanel : t.key === 'generate' ? generatePanel : referencePanel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
